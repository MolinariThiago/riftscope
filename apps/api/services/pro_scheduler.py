"""
Background scheduler for the pro-match auto-import flow.

Runs as a single ``asyncio.Task`` started from FastAPI's lifespan.
Every tick it does two things:

  1. ``_sync_step()`` — pulls fresh matches from every demo source
     (Liquipedia today) and upserts them into ``pro_matches``. Runs
     at most every ``SYNC_INTERVAL_SECONDS``.

  2. ``_import_step()`` — finds completed matches that have a
     ``demo_url`` but no ``demo_id`` yet, and auto-imports up to
     ``MAX_IMPORTS_PER_TICK`` of them, sleeping ``IMPORT_GAP_SECONDS``
     between each call to be polite to HLTV's Cloudflare.

The task is cancellable: ``stop_scheduler()`` sets the shutdown event
and the loop exits as soon as it can. Restarting the API restarts the
task — there's no persisted scheduler state, only the DB itself.

Tunable via env (defaults are safe for indie dev):

  PRO_SCHEDULER_ENABLED         — set to "0" to disable entirely
  PRO_SYNC_INTERVAL_SECONDS     — default 900 (15 min)
  PRO_IMPORT_GAP_SECONDS        — default 60   (1 min between imports)
  PRO_MAX_IMPORTS_PER_TICK      — default 5
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any

from db.database import SessionLocal
from db.models.pro_match import ProMatch
from services.demo_sources import get_sources
from core.settings import get_settings
from services.hltv_proxy_pool import get_proxy_pool
from services.pro_import import (
    claim_match,
    get_pro_cutoff,
    import_match_demo,
    pro_cutoff_naive,
    release_match,
)
from services.demo_sources.hltv import HltvSource
from services.demo_sources.liquipedia import LiquipediaSource  # noqa: F401
from services.rar_runtime import rar_runtime_status

logger = logging.getLogger("riftscope.scheduler.pro")

# ---------------------------------------------------------------------------
# Config (env-tunable, with sane defaults)
# ---------------------------------------------------------------------------
def _env_int(key: str, default: int) -> int:
    try:
        return int(os.getenv(key, "").strip() or default)
    except ValueError:
        return default


def _env_bool(key: str, default: bool) -> bool:
    v = (os.getenv(key, "") or "").strip().lower()
    if v in ("1", "true", "yes", "on"):
        return True
    if v in ("0", "false", "no", "off"):
        return False
    return default


ENABLED                 = _env_bool("PRO_SCHEDULER_ENABLED",     True)
SYNC_INTERVAL_SECONDS   = _env_int("PRO_SYNC_INTERVAL_SECONDS",  900)
IMPORT_GAP_SECONDS      = _env_int("PRO_IMPORT_GAP_SECONDS",     60)
MAX_IMPORTS_PER_TICK    = _env_int("PRO_MAX_IMPORTS_PER_TICK",   5)
TICK_INTERVAL_SECONDS   = 30  # how often the loop wakes up

# Initial 15 s grace so the API finishes booting + the DB
# auto-migration in main.py runs first.
STARTUP_DELAY_SECONDS = 15


# ---------------------------------------------------------------------------
# Module-level state — tiny so the status endpoint can inspect it.
# ---------------------------------------------------------------------------
_task: asyncio.Task | None = None
_shutdown: asyncio.Event | None = None
_state: dict[str, Any] = {
    "running": False,
    "last_tick_at": None,
    "last_sync_at": None,
    "last_sync_result": None,    # {"inserted": int, "updated": int, "errors": int}
    "last_import_count": 0,      # imports queued in the last tick
    "last_import_errors": 0,
    "last_import_status": None,  # {"queued": int, "rar": int, "fail": int, ...}
}


def scheduler_status() -> dict[str, Any]:
    """Snapshot the current scheduler state for the status endpoint."""
    return {
        "enabled": ENABLED,
        "interval_seconds": SYNC_INTERVAL_SECONDS,
        "import_gap_seconds": IMPORT_GAP_SECONDS,
        "max_imports_per_tick": MAX_IMPORTS_PER_TICK,
        "index_from": get_pro_cutoff().isoformat(),
        # RAR extraction state — surfaces whether unrar is available
        # so the UI can warn the operator if HLTV's .rar demos are
        # being silently skipped. Without unrar, ~95 % of pro demos
        # can't be auto-imported.
        "rar_extraction": rar_runtime_status(),
        # HLTV proxy pool health (how many IPs are healthy vs parked).
        # When ``healthy == 0`` and ``configured > 0`` every IP is on
        # cooldown — the UI uses that to nudge the operator to either
        # bump the pool size or shrink the cooldown.
        "hltv_proxy_pool": get_proxy_pool().snapshot(),
        # HLTV source cooldown — if non-zero, we hit a rate-limit on
        # the /results scrape recently and are waiting it out. The UI
        # surfaces this so the user knows why the page isn't filling up.
        "hltv_source_cooldown_seconds": round(
            HltvSource.cooldown_remaining_seconds(),
        ),
        # Legacy key kept for backward-compat with the frontend until it
        # is updated to read the new one. Same data — the active source
        # is now HLTV.
        "liquipedia_cooldown_seconds": round(
            HltvSource.cooldown_remaining_seconds(),
        ),
        **_state,
    }


# ---------------------------------------------------------------------------
# Lifecycle — called from main.py lifespan
# ---------------------------------------------------------------------------
async def start_scheduler() -> None:
    """Spawn the background loop. No-op if disabled or already running."""
    global _task, _shutdown
    if not ENABLED:
        logger.info("pro auto-import scheduler is DISABLED (env)")
        return
    if _task is not None and not _task.done():
        return
    _shutdown = asyncio.Event()
    _task = asyncio.create_task(_run_loop(), name="pro-scheduler")
    logger.info(
        "pro auto-import scheduler started "
        "(sync every %ds, max %d imports per tick, %ds between imports)",
        SYNC_INTERVAL_SECONDS, MAX_IMPORTS_PER_TICK, IMPORT_GAP_SECONDS,
    )


async def stop_scheduler() -> None:
    """Signal the loop to exit + wait briefly for it to finish."""
    global _task, _shutdown
    if _task is None:
        return
    if _shutdown is not None:
        _shutdown.set()
    try:
        await asyncio.wait_for(_task, timeout=5)
    except asyncio.TimeoutError:
        _task.cancel()
    except asyncio.CancelledError:
        pass
    _task = None
    _shutdown = None
    logger.info("pro auto-import scheduler stopped")


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------
async def _wait_or_shutdown(seconds: float) -> bool:
    """Sleep for ``seconds`` OR return True early if shutdown was signalled."""
    if _shutdown is None:
        await asyncio.sleep(seconds)
        return False
    try:
        await asyncio.wait_for(_shutdown.wait(), timeout=seconds)
        return True
    except asyncio.TimeoutError:
        return False


async def _run_loop() -> None:
    _state["running"] = True
    try:
        # Initial grace so we don't hit the network before the API is
        # fully ready (and before _ensure_steam_columns + create_all
        # have run).
        if await _wait_or_shutdown(STARTUP_DELAY_SECONDS):
            return

        last_sync_monotonic = 0.0
        first_run = True

        while True:
            tick_started = asyncio.get_event_loop().time()
            _state["last_tick_at"] = datetime.now(timezone.utc).isoformat()

            # SYNC step — Liquipedia pull. First run always syncs so
            # the user sees something quickly after a cold start.
            if (
                first_run
                or (tick_started - last_sync_monotonic) >= SYNC_INTERVAL_SECONDS
            ):
                try:
                    await _sync_step()
                except Exception:
                    logger.exception("scheduler sync step failed")
                last_sync_monotonic = tick_started

            # IMPORT step — drain the backlog of completed matches
            # that have a demo_url but no demo_id.
            try:
                await _import_step()
            except Exception:
                logger.exception("scheduler import step failed")

            first_run = False

            # Sleep until next tick (or until shutdown).
            if await _wait_or_shutdown(TICK_INTERVAL_SECONDS):
                return
    finally:
        _state["running"] = False


# ---------------------------------------------------------------------------
# Sync step — mirrors the /pro/sync HTTP handler's logic in-process.
# ---------------------------------------------------------------------------
async def _sync_step() -> None:
    cutoff = pro_cutoff_naive()
    since = datetime.now(timezone.utc) - timedelta(days=14)
    inserted = 0
    updated = 0
    errors = 0
    db = SessionLocal()
    try:
        for source in get_sources():
            try:
                matches = await source.list_recent_matches(since=since, limit=100)
            except Exception:
                logger.exception("scheduler: source %s failed", source.name)
                errors += 1
                continue
            for m in matches:
                played_at_naive = (
                    m.played_at.astimezone(timezone.utc).replace(tzinfo=None)
                    if m.played_at is not None
                    else None
                )
                # Cutoff filter — same rule as the manual /pro/sync
                # endpoint. We drop anything before the configured
                # PRO_INDEX_FROM (defaults to today) so the DB stays
                # focused on the snapshot the operator opted into.
                if played_at_naive is None or played_at_naive < cutoff:
                    continue
                existing = (
                    db.query(ProMatch)
                    .filter(
                        ProMatch.source == m.source,
                        ProMatch.source_match_id == m.source_match_id,
                    )
                    .first()
                )
                if existing:
                    changed = False
                    if m.score_a is not None and existing.score_a != m.score_a:
                        existing.score_a = m.score_a
                        changed = True
                    if m.score_b is not None and existing.score_b != m.score_b:
                        existing.score_b = m.score_b
                        changed = True
                    if played_at_naive and not existing.played_at:
                        existing.played_at = played_at_naive
                        changed = True
                    if m.demo_url and not existing.demo_url:
                        existing.demo_url = m.demo_url
                        changed = True
                    if changed:
                        updated += 1
                    continue
                db.add(
                    ProMatch(
                        source=m.source,
                        source_match_id=m.source_match_id,
                        team_a=m.team_a,
                        team_b=m.team_b,
                        score_a=m.score_a,
                        score_b=m.score_b,
                        map_name=m.map,
                        event_name=m.event_name,
                        played_at=played_at_naive,
                        demo_url=m.demo_url,
                    )
                )
                inserted += 1
        db.commit()
    finally:
        db.close()

    _state["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    _state["last_sync_result"] = {
        "inserted": inserted,
        "updated": updated,
        "errors": errors,
    }
    if inserted or updated:
        logger.info(
            "scheduler sync: +%d new, ~%d updated, %d errors",
            inserted, updated, errors,
        )


# ---------------------------------------------------------------------------
# Import step — fire up to MAX_IMPORTS_PER_TICK imports, rate-limited.
# ---------------------------------------------------------------------------
async def _import_step() -> None:
    cutoff = pro_cutoff_naive()
    db = SessionLocal()
    try:
        # Candidates: completed matches with demo_url + no demo_id, on or
        # after the cutoff date, AND inside the operator's allowed tier
        # buckets (``PRO_AUTO_TIERS`` env — default S+/S/A/B). This stops
        # the proxy budget from being burned on C-tier scrims and FACEIT
        # cups that nobody asked for; admins can still trigger a manual
        # import for those from the UI.
        # The env value is a plain string ("S+,S,A,B") so we split here —
        # see the comment in core/settings.py for why it's not List[str].
        raw_tiers = get_settings().pro_auto_tiers or ""
        allowed_tiers = [t.strip() for t in raw_tiers.split(",") if t.strip()]
        q = (
            db.query(ProMatch)
            .filter(ProMatch.played_at >= cutoff)
            .filter(ProMatch.demo_id == None)  # noqa: E711
            .filter(ProMatch.demo_url.isnot(None))
            .filter(ProMatch.score_a.isnot(None))
            .filter(ProMatch.score_b.isnot(None))
        )
        if allowed_tiers:
            q = q.filter(ProMatch.tier.in_(allowed_tiers))
        candidates: list[ProMatch] = (
            q.order_by(ProMatch.played_at.desc().nullslast())
            .limit(MAX_IMPORTS_PER_TICK * 3)
            .all()
        )
        # Filter to actually-completed matches (BO total >= 2). This
        # avoids importing in-progress 1-0 matches that aren't done.
        candidates = [
            m for m in candidates
            if (m.score_a or 0) + (m.score_b or 0) >= 2
        ][:MAX_IMPORTS_PER_TICK]

        if not candidates:
            _state["last_import_count"] = 0
            _state["last_import_errors"] = 0
            _state["last_import_status"] = {}
            return

        status_counts: dict[str, int] = {}
        errors = 0
        queued = 0

        for i, match in enumerate(candidates):
            if _shutdown is not None and _shutdown.is_set():
                break
            # Skip rows that a manual /pro/matches/{id}/import is already
            # working on — same dedupe gate the HTTP handler uses, so the
            # auto tick and the click can't pile two downloads on the same
            # demo.
            if not await claim_match(match.id):
                logger.info(
                    "scheduler: skipping match %s — import already in flight",
                    match.id,
                )
                continue
            try:
                result = await import_match_demo(db, match)
            except Exception:
                logger.exception(
                    "scheduler auto-import failed for match %s", match.id,
                )
                errors += 1
                await release_match(match.id)
                continue
            else:
                await release_match(match.id)
            status_counts[result.status] = status_counts.get(result.status, 0) + 1
            if result.status == "queued":
                queued += 1
                logger.info(
                    "auto-imported match %s (%s vs %s) → demo_id=%s",
                    match.id, match.team_a, match.team_b, result.demo_id,
                )
            elif result.status == "download_failed":
                errors += 1
            # Rate-limit: wait BETWEEN imports, not after the last one.
            if i < len(candidates) - 1:
                if await _wait_or_shutdown(IMPORT_GAP_SECONDS):
                    break

        _state["last_import_count"] = queued
        _state["last_import_errors"] = errors
        _state["last_import_status"] = status_counts
    finally:
        db.close()
