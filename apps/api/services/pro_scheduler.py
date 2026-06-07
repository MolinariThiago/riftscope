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
from db.models.demo import Demo
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
# Default bumped from 900 (15 min) to 1800 (30 min) — the user noted
# the scraper felt too chatty for the actual freshness need. New
# matches on HLTV /results stay on the page for hours; 30 min is
# plenty and halves the proxy hits for the discovery step.
SYNC_INTERVAL_SECONDS   = _env_int("PRO_SYNC_INTERVAL_SECONDS",  1800)
IMPORT_GAP_SECONDS      = _env_int("PRO_IMPORT_GAP_SECONDS",     60)
MAX_IMPORTS_PER_TICK    = _env_int("PRO_MAX_IMPORTS_PER_TICK",   5)
TICK_INTERVAL_SECONDS   = 30  # how often the loop wakes up
# Skip the sync step when the import backlog is already this big.
# No point scraping more matches when we can't even import what we
# already have queued up. Set to 0 to disable the backlog gate.
SYNC_SKIP_BACKLOG       = _env_int("PRO_SYNC_SKIP_BACKLOG",      50)
# Serialise downloads behind parsing: after queueing a demo for the
# worker, wait until every Demo linked to that ProMatch reaches a
# terminal state (completed / failed) before scraping the next
# candidate.  Stops parallel parses from competing for the 512 MB
# Hobby budget and getting SIGKILL'd mid-parse (the "stuck at 90 %"
# symptom on /pro).  Defaults ON; flip to "0" to restore the old
# fire-and-forget behaviour.
WAIT_FOR_PARSE          = _env_bool("PRO_WAIT_FOR_PARSE",        True)
# Max time to spend waiting on a single match's parse before giving
# up and moving on (Bo3 can be ~30 min; 60 min is a safe cap).
PARSE_WAIT_TIMEOUT      = _env_int("PRO_PARSE_WAIT_TIMEOUT",     60 * 60)
# Poll interval for the parse-status wait. 15 s keeps the DB hit
# rate trivial while still feeling responsive.
PARSE_POLL_SECONDS      = _env_int("PRO_PARSE_POLL_SECONDS",     15)
# Daily download budget — caps the bytes the scheduler will pull
# from HLTV in a single UTC day. The point is the residential proxy
# pool: each IP has a monthly bandwidth quota and burning through
# it in 4 days kills the auto-importer for the rest of the month.
# 10 GB / day = ~300 GB / month which is the typical Webshare
# Static Residential allowance for a small pool. Set to 0 to
# disable the cap entirely.
DAILY_DOWNLOAD_LIMIT_GB = _env_int("PRO_DAILY_DOWNLOAD_LIMIT_GB", 10)


# Tier priority for candidate ordering. Lower number = higher
# priority. We always prefer S+ over S over A over B over C —
# guarantees the budget gets spent on the most important matches
# first instead of N random low-tier scrims squeezing out the Major
# final because they happened to land in the same tick.  Matches
# with NULL tier sit at the bottom so they only get picked up after
# every classified match in the allowed set is done.
_TIER_PRIORITY: dict[str | None, int] = {
    "S+": 0,
    "S": 1,
    "A": 2,
    "B": 3,
    "C": 4,
    None: 99,
}

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
    "last_sync_skip": None,      # {"reason": "...", "at": "..."} when we skipped a sync window
    "last_import_count": 0,      # imports queued in the last tick
    "last_import_errors": 0,
    "last_import_status": None,  # {"queued": int, "rar": int, "fail": int, ...}
    "reimport_queue": 0,         # matches with demo_id NULL but import_completed_at IS NOT NULL
}


def scheduler_status() -> dict[str, Any]:
    """Snapshot the current scheduler state for the status endpoint."""
    return {
        "enabled": ENABLED,
        "interval_seconds": SYNC_INTERVAL_SECONDS,
        "import_gap_seconds": IMPORT_GAP_SECONDS,
        "max_imports_per_tick": MAX_IMPORTS_PER_TICK,
        "wait_for_parse": WAIT_FOR_PARSE,
        "parse_wait_timeout_seconds": PARSE_WAIT_TIMEOUT,
        "daily_budget": _budget_snapshot(),
        "sync_skip_backlog": SYNC_SKIP_BACKLOG,
        # Live count so the chip stays current even between ticks
        # (the per-tick ``reimport_queue`` only updates when
        # _import_step actually runs).
        "reimport_queue_size": _reimport_queue_size(),
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

        # ONE-SHOT BACKFILL: mark legacy ProMatches that lack
        # source_match_id as permanently failed so they stop hammering
        # the import queue. These rows were inserted by Liquipedia or
        # an older HLTV scraper that didn't set source_match_id; the
        # current import path can't construct a download URL without
        # it. Marking them once here avoids the per-tick churn we saw
        # with 37 dead matches all returning "no source_match_id".
        try:
            db_init = SessionLocal()
            from sqlalchemy import or_ as _or
            legacy_dead = (
                db_init.query(ProMatch)
                .filter(ProMatch.demo_id.is_(None))
                .filter(_or(
                    ProMatch.source_match_id.is_(None),
                    ProMatch.source_match_id == "",
                ))
                .filter(_or(
                    ProMatch.import_status.is_(None),
                    ProMatch.import_status != "failed",
                ))
                .all()
            )
            for m in legacy_dead:
                m.import_status = "failed"
                m.import_error = (
                    "no source_match_id (legacy match — cannot resolve demo URL)"
                )
            if legacy_dead:
                db_init.commit()
                logger.info(
                    "scheduler startup: marked %d legacy match(es) without "
                    "source_match_id as permanently failed",
                    len(legacy_dead),
                )
            db_init.close()
        except Exception:
            logger.exception("scheduler startup backfill failed (non-fatal)")

        last_sync_monotonic = 0.0
        first_run = True

        while True:
            tick_started = asyncio.get_event_loop().time()
            _state["last_tick_at"] = datetime.now(timezone.utc).isoformat()

            # SYNC step — HLTV pull. First run always syncs so the
            # user sees something quickly after a cold start.
            # Otherwise wait for the interval AND verify there's a
            # reason to scrape (budget left + backlog isn't already
            # buried). Each skip saves one HLTV /results hit.
            if (
                first_run
                or (tick_started - last_sync_monotonic) >= SYNC_INTERVAL_SECONDS
            ):
                skip_reason = _sync_skip_reason() if not first_run else None
                if skip_reason:
                    logger.info(
                        "scheduler: skipping sync (%s) — next attempt in %ds",
                        skip_reason, SYNC_INTERVAL_SECONDS,
                    )
                    _state["last_sync_skip"] = {
                        "reason": skip_reason,
                        "at": datetime.now(timezone.utc).isoformat(),
                    }
                else:
                    try:
                        await _sync_step()
                    except Exception:
                        logger.exception("scheduler sync step failed")
                    _state["last_sync_skip"] = None
                last_sync_monotonic = tick_started

            # SELF-HEAL — reset demos stuck in "processing" before the
            # import step runs. A stuck demo with WAIT_FOR_PARSE=True
            # blocks the entire import queue indefinitely. Auto-reset
            # after 60 min so the queue never needs manual intervention.
            try:
                _auto_reset_stuck_demos(older_than_minutes=60)
            except Exception:
                logger.exception("scheduler auto-reset stuck demos failed")

            # AUTO-RETRY — re-queue failed demos that have retryable
            # errors and haven't exceeded the retry cap. Runs every tick
            # but the cooldown window prevents hammering.
            try:
                _auto_retry_failed_demos()
            except Exception:
                logger.exception("scheduler auto-retry failed demos failed")

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
# Self-heal — auto-reset demos stuck in "processing"
# ---------------------------------------------------------------------------
def _auto_reset_stuck_demos(older_than_minutes: int = 60) -> None:
    """Reset demos that have been stuck in ``processing`` for too long.

    When a Railway container is OOM-killed mid-parse, the Demo row stays
    at ``status="processing"`` forever because the exception handler
    never runs. With ``WAIT_FOR_PARSE=True`` that single stuck demo
    blocks ALL future imports. This function runs every scheduler tick
    and self-heals without requiring manual admin action.

    Also resets orphan ProMatches stuck in ``importing`` with no linked
    Demo — these arise when the download died before creating the Demo
    row (network timeout, proxy ban, etc.).
    """
    from db.models.demo import Demo
    from db.models.pro_match import ProMatch

    cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(minutes=max(1, older_than_minutes))
    db = SessionLocal()
    try:
        # --- Stuck demos ---
        stuck = (
            db.query(Demo)
            .filter(Demo.status == "processing")
            .filter(Demo.uploaded_at < cutoff)
            .all()
        )

        pro_match_ids: set[int] = set()
        if stuck:
            pro_match_ids = {d.pro_match_id for d in stuck if d.pro_match_id}
            for d in stuck:
                d.status = "failed"
                d.error_message = (
                    "Auto-reset: parsing exceeded time limit "
                    f"({older_than_minutes}min). Worker was likely OOM-killed."
                )

            if pro_match_ids:
                matches = (
                    db.query(ProMatch)
                    .filter(ProMatch.id.in_(pro_match_ids))
                    .filter(ProMatch.import_status == "importing")
                    .all()
                )
                for m in matches:
                    m.import_status = "failed"

            logger.info(
                "auto-reset: marked %d stuck demo(s) as failed, unblocked %d match(es)",
                len(stuck), len(pro_match_ids),
            )

        # --- Orphan ProMatches stuck in "importing" with no Demo ---
        # These never appear in the stuck-demos query because there IS
        # no Demo row to find. The download died before creating one.
        orphan_importing = (
            db.query(ProMatch)
            .filter(ProMatch.import_status == "importing")
            .filter(ProMatch.demo_id.is_(None))
            .filter(ProMatch.played_at < cutoff)
            .all()
        )
        if orphan_importing:
            for m in orphan_importing:
                m.import_status = None  # reset to pending so scheduler retries
            logger.info(
                "auto-reset: cleared import_status on %d orphan match(es) stuck in 'importing'",
                len(orphan_importing),
            )

        db.commit()
    finally:
        db.close()


# Max retry attempts for failed demos before giving up permanently.
def _safe_env_int(key: str, default: int) -> int:
    """Parse an int env var with a sensible default on malformed input."""
    raw = os.getenv(key, "").strip()
    if not raw:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        logger.warning("env var %s=%r is not a valid int — using default %d", key, raw, default)
        return default


_FAILED_RETRY_MAX = _safe_env_int("PRO_FAILED_RETRY_MAX", 3)
# Only retry demos that failed at least this many minutes ago (avoids
# hammering a demo that fails instantly every tick).
_FAILED_RETRY_COOLDOWN_MIN = _safe_env_int("PRO_FAILED_RETRY_COOLDOWN_MIN", 30)


# Patterns in error_message that mark a failure as PERMANENT — no retry
# will succeed because the issue is structural (the file is malformed,
# the archive is unsupported, the demo failed the quality gate, etc.).
#
# IMPORTANT: "HLTV todavía no subió el archivo" is NOT here — that's
# RETRYABLE because HLTV uploads Major demos with days/weeks of delay.
# Each retry might find the demo now-available.
_NON_RETRYABLE_ERROR_PATTERNS = (
    "quality check",
    "unrecognised file format",
    "unrecognized file format",
    "unsupported",
    "no .dem files",
    "no unrar binary",
    "no source_match_id",
    "demoparser2 rejected every prop",
    "truncated or from an unsupported cs2 build",
    # File-lost markers — re-spawning process_demo will fail with
    # FileNotFoundError forever because the file is genuinely gone
    # from both local FS and S3.
    "file not found locally",
    "s3 fallback is unavailable",
    "file lost",
)


def _is_non_retryable(error_message: str | None) -> bool:
    err = (error_message or "").lower()
    return any(pat in err for pat in _NON_RETRYABLE_ERROR_PATTERNS)


def _retry_count_from_message(error_message: str | None) -> int:
    """Pull the current retry index out of the error_message marker."""
    if not error_message or "[retry " not in error_message:
        return 0
    import re as _re
    m = _re.search(r"\[retry (\d+)/", error_message)
    return int(m.group(1)) if m else 0


def _auto_retry_failed_demos() -> int:
    """Re-trigger parsing for demos that failed with a transient error.

    Two scenarios are handled:

    1. **Demo.status = 'failed'** with a retryable error_message
       (worker OOM, S3 download glitch, parser transient failure):
       reset to ``queued`` AND spawn ``process_demo`` so the parser
       actually runs again. The old version only flipped status — the
       demo then sat in ``queued`` forever because nothing polls for
       queued demos. This is the critical bug fix.

    2. **ProMatch.import_status = 'failed'** with no Demo row
       (download itself failed — Cloudflare ban, proxy timeout, HLTV
       didn't have the .dem URL yet): clear ``import_status`` so the
       next ``_import_step`` tick re-attempts the download.

    Returns the number of demos/matches re-queued.
    """
    cooldown_cutoff = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(
        minutes=max(1, _FAILED_RETRY_COOLDOWN_MIN)
    )

    requeued_demos: list[tuple[int, str]] = []  # (demo_id, storage_filename)
    requeued_matches = 0

    db = SessionLocal()
    try:
        # ---- Case 1: failed Demo rows ----------------------------------
        failed_demos = (
            db.query(Demo)
            .filter(Demo.status == "failed")
            .filter(Demo.pro_match_id.isnot(None))
            .filter(Demo.uploaded_at < cooldown_cutoff)
            .all()
        )
        for d in failed_demos:
            if _is_non_retryable(d.error_message):
                continue
            retry_count = _retry_count_from_message(d.error_message)
            if retry_count >= _FAILED_RETRY_MAX:
                continue
            old_error = d.error_message or "unknown"
            d.status = "queued"
            d.error_message = (
                f"[retry {retry_count + 1}/{_FAILED_RETRY_MAX}] previous: {old_error}"
            )
            d.processing_progress = 0
            if d.storage_filename:
                requeued_demos.append((d.id, d.storage_filename))

        # ---- Case 2: ProMatches whose DOWNLOAD failed (no Demo row) ----
        # Those can only be detected at the ProMatch level (Demo never
        # got created). They get retried by simply clearing
        # ``import_status`` so the import step picks them up again.
        # We track retry count in ``import_error`` the same way.
        failed_dl_matches = (
            db.query(ProMatch)
            .filter(ProMatch.import_status == "failed")
            .filter(ProMatch.demo_id.is_(None))
            .all()
        )
        for m in failed_dl_matches:
            if _is_non_retryable(m.import_error):
                continue
            retry_count = _retry_count_from_message(m.import_error)
            if retry_count >= _FAILED_RETRY_MAX:
                continue
            old_error = m.import_error or "unknown"
            m.import_status = None  # eligible for re-import next tick
            m.import_error = (
                f"[retry {retry_count + 1}/{_FAILED_RETRY_MAX}] previous: {old_error}"
            )
            requeued_matches += 1

        if requeued_demos or requeued_matches:
            db.commit()
            logger.info(
                "auto-retry: re-spawned %d failed demo parse(s), unblocked %d failed download(s)",
                len(requeued_demos), requeued_matches,
            )
    except Exception:
        logger.exception("auto-retry failed")
        db.rollback()
        return 0
    finally:
        db.close()

    # ---- Verify file availability BEFORE spawning a re-parse ---------
    # The previous version blindly spawned process_demo, which failed
    # instantly with FileNotFoundError when neither the local file nor
    # the S3 object existed. That hammered the queue with useless
    # retries. Now we check first: if the file is gone, we clear the
    # match's demo_id + import_status so the scheduler RE-DOWNLOADS
    # from HLTV instead of re-parsing a phantom file.
    actually_reparsable: list[tuple[int, str]] = []
    lost_demos: list[int] = []
    if requeued_demos:
        from services.storage import UPLOAD_DIR, get_storage
        storage = get_storage()
        for demo_id, storage_filename in requeued_demos:
            local_exists = (UPLOAD_DIR / storage_filename).exists()
            remote_exists = False
            if not local_exists and hasattr(storage, "object_exists"):
                try:
                    remote_exists = storage.object_exists(storage_filename)
                except Exception:
                    remote_exists = False
            if local_exists or remote_exists:
                actually_reparsable.append((demo_id, storage_filename))
            else:
                lost_demos.append(demo_id)

    # ---- Handle lost demos: clear match.demo_id for re-download ------
    if lost_demos:
        db = SessionLocal()
        try:
            for demo_id in lost_demos:
                d = db.query(Demo).filter(Demo.id == demo_id).first()
                if not d:
                    continue
                # Mark the dead Demo row as permanently lost. The
                # "file lost" marker is in _NON_RETRYABLE_ERROR_PATTERNS
                # so this row won't bounce back into the retry loop.
                d.status = "failed"
                d.error_message = (
                    f"File lost (not in local FS or remote storage). "
                    f"Original: {d.error_message or 'unknown'}"
                )
                # Free up the parent match so it can be re-imported by
                # the normal import step. The demo will be re-downloaded
                # from HLTV from scratch.
                if d.pro_match_id:
                    match = db.query(ProMatch).filter(ProMatch.id == d.pro_match_id).first()
                    if match:
                        match.demo_id = None
                        match.import_status = None
                        match.import_error = None
            db.commit()
            logger.warning(
                "auto-retry: %d demo(s) had no recoverable file — "
                "marked as lost, cleared match.demo_id for fresh re-download",
                len(lost_demos),
            )
        except Exception:
            logger.exception("auto-retry lost-file handler failed")
            db.rollback()
        finally:
            db.close()

    # ---- Spawn the parser tasks for files we found -------------------
    if actually_reparsable:
        from core.bg import spawn
        from services.storage import UPLOAD_DIR
        from workers.demo_worker import process_demo

        for demo_id, storage_filename in actually_reparsable:
            file_path = str(UPLOAD_DIR / storage_filename)
            spawn(process_demo(demo_id, file_path), name=f"retry-demo-{demo_id}")

    return len(actually_reparsable) + requeued_matches


# ---------------------------------------------------------------------------
# Sync step — mirrors the /pro/sync HTTP handler's logic in-process.
# ---------------------------------------------------------------------------
async def _sync_step() -> None:
    cutoff = pro_cutoff_naive()
    since = datetime.now(timezone.utc) - timedelta(days=14)
    inserted = 0
    updated = 0
    skipped_tier = 0
    skipped_cutoff = 0
    skipped_existing = 0
    seen = 0
    errors = 0

    # Tier filter — same set the import step uses. Applied to NEW
    # inserts only; existing rows still receive score / logo / tier
    # updates so we don't lose metadata on rows already in the DB.
    raw_tiers = get_settings().pro_auto_tiers or ""
    allowed_tiers = {t.strip() for t in raw_tiers.split(",") if t.strip()}

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
                seen += 1
                if played_at_naive is None or played_at_naive < cutoff:
                    skipped_cutoff += 1
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
                    # Backfill tier on rows that were inserted before the
                    # source started emitting it (or by a different source).
                    # Don't OVERWRITE an existing tier — operators may have
                    # adjusted it manually via /admin.
                    if m.tier and not existing.tier:
                        existing.tier = m.tier
                        changed = True
                    # Backfill team logos. Same "only if missing" rule
                    # as tier so manual admin overrides aren't clobbered.
                    if m.team_a_logo_url and not existing.team_a_logo_url:
                        existing.team_a_logo_url = m.team_a_logo_url
                        changed = True
                    if m.team_b_logo_url and not existing.team_b_logo_url:
                        existing.team_b_logo_url = m.team_b_logo_url
                        changed = True
                    if changed:
                        updated += 1
                    else:
                        skipped_existing += 1
                    continue
                # Tier gate — skip NEW matches outside the allowed set.
                if allowed_tiers and m.tier is not None and m.tier not in allowed_tiers:
                    skipped_tier += 1
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
                        tier=m.tier,
                        team_a_logo_url=m.team_a_logo_url,
                        team_b_logo_url=m.team_b_logo_url,
                    )
                )
                inserted += 1
        db.commit()
    finally:
        db.close()

    _state["last_sync_at"] = datetime.now(timezone.utc).isoformat()
    _state["last_sync_result"] = {
        "seen": seen,
        "inserted": inserted,
        "updated": updated,
        "skipped_cutoff": skipped_cutoff,
        "skipped_existing": skipped_existing,
        "skipped_tier": skipped_tier,
        "errors": errors,
        "allowed_tiers": sorted(allowed_tiers) if allowed_tiers else [],
        "cutoff_date": cutoff.date().isoformat(),
    }
    logger.info(
        "scheduler sync breakdown: seen=%d cutoff(%s)=%d existing=%d "
        "tier_blocked=%d -> inserted=%d updated=%d errors=%d allowed_tiers=%s",
        seen, cutoff.date().isoformat(), skipped_cutoff, skipped_existing,
        skipped_tier, inserted, updated, errors, sorted(allowed_tiers) or "ALL",
    )


# ---------------------------------------------------------------------------
# Daily download budget — sum bytes pulled from HLTV today (UTC)
# ---------------------------------------------------------------------------
def _utc_day_start() -> datetime:
    """First instant of the current UTC day, naive (matches the DB stamp)."""
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    return datetime(now.year, now.month, now.day)


def _bytes_downloaded_today() -> int:
    """Sum of ``import_bytes`` for downloads completed in this UTC day."""
    from sqlalchemy import func as _f

    day_start = _utc_day_start()
    db = SessionLocal()
    try:
        total = (
            db.query(_f.coalesce(_f.sum(ProMatch.import_bytes), 0))
            .filter(ProMatch.import_completed_at >= day_start)
            .scalar()
        )
        return int(total or 0)
    finally:
        db.close()


def _reimport_queue_size() -> int:
    """Count of matches the scheduler will treat as re-import priority.

    These are matches that already had ``import_bytes`` /
    ``import_completed_at`` stamped (so we paid the budget at least
    once) but currently have ``demo_id IS NULL`` — meaning the demo
    was either purged for missing bytes, deleted manually, or never
    successfully parsed.  Surfaced in scheduler_status so the /pro
    chip can show the operator "X re-imports waiting" between ticks.
    """
    cutoff = pro_cutoff_naive()
    db = SessionLocal()
    try:
        return (
            db.query(ProMatch.id)
            .filter(ProMatch.played_at >= cutoff)
            .filter(ProMatch.demo_id == None)  # noqa: E711
            .filter(ProMatch.import_completed_at.isnot(None))
            .count()
        )
    finally:
        db.close()


def _import_backlog_size() -> int:
    """Count of matches that are eligible for auto-import but not yet
    imported. Same filters the import step applies, so this number is
    the actual queue depth the scheduler would draw from."""
    cutoff = pro_cutoff_naive()
    raw_tiers = get_settings().pro_auto_tiers or ""
    allowed_tiers = [t.strip() for t in raw_tiers.split(",") if t.strip()]
    db = SessionLocal()
    try:
        q = (
            db.query(ProMatch.id)
            .filter(ProMatch.played_at >= cutoff)
            .filter(ProMatch.demo_id == None)  # noqa: E711
            .filter(ProMatch.score_a.isnot(None))
            .filter(ProMatch.score_b.isnot(None))
        )
        if allowed_tiers:
            from sqlalchemy import or_
            q = q.filter(
                or_(ProMatch.tier.in_(allowed_tiers), ProMatch.tier.is_(None))
            )
        return q.count()
    finally:
        db.close()


def _sync_skip_reason() -> str | None:
    """Return a one-line reason to SKIP the next sync, or None to proceed.

    Only ONE reason now — a huge import backlog. We intentionally
    DO NOT skip sync when the download budget is exhausted: the sync
    step is a single HLTV /results scrape (cheap, no demo download)
    and its value is keeping the DB current with scores, logos and
    new match entries. Skipping it when budget is gone means the
    feed goes stale for the rest of the UTC day even though the
    discovery traffic costs almost nothing.

    The IMPORT step already has its own budget gate that prevents
    downloads when the cap is reached — that's the right place to
    enforce the budget, not here in sync.
    """
    if SYNC_SKIP_BACKLOG > 0:
        try:
            backlog = _import_backlog_size()
        except Exception:  # pragma: no cover — defensive
            backlog = 0
        if backlog >= SYNC_SKIP_BACKLOG:
            return f"backlog_full ({backlog})"
    return None


def _budget_snapshot() -> dict[str, Any]:
    """Public view of today's download spend (for scheduler_status)."""
    used = _bytes_downloaded_today()
    limit_bytes = DAILY_DOWNLOAD_LIMIT_GB * (1024 ** 3) if DAILY_DOWNLOAD_LIMIT_GB > 0 else 0
    return {
        "limit_gb": DAILY_DOWNLOAD_LIMIT_GB,
        "used_bytes": used,
        "used_gb": round(used / (1024 ** 3), 2),
        "remaining_bytes": max(0, limit_bytes - used) if limit_bytes else None,
        "remaining_gb": (
            round(max(0, limit_bytes - used) / (1024 ** 3), 2) if limit_bytes else None
        ),
        "exhausted": bool(limit_bytes and used >= limit_bytes),
        "day_start_utc": _utc_day_start().isoformat(),
    }


# ---------------------------------------------------------------------------
# Parse-status wait — block scraping until the queued demo finishes
# ---------------------------------------------------------------------------
async def _wait_for_match_parsed(match_id: int, timeout_s: int) -> str:
    """Poll Demo rows linked to ``match_id`` until every one reaches a
    terminal status (``completed`` / ``failed``) or the timeout fires.

    Returns:
      "done"      — every linked Demo finished (any mix of completed
                    and failed counts as done).
      "timeout"   — at least one Demo was still ``processing`` /
                    ``queued`` / ``uploaded`` when the deadline hit.
      "no_demos"  — no Demo rows are linked to the match yet (the
                    importer probably failed before persisting; we
                    don't want to spin here).
      "shutdown"  — the scheduler was asked to exit while waiting.
    """
    deadline = asyncio.get_event_loop().time() + max(60, timeout_s)
    terminal = {"completed", "failed"}
    last_logged: tuple | None = None

    while True:
        if _shutdown is not None and _shutdown.is_set():
            return "shutdown"

        db = SessionLocal()
        try:
            rows = (
                db.query(Demo.id, Demo.status, Demo.processing_progress)
                .filter(Demo.pro_match_id == match_id)
                .all()
            )
        finally:
            db.close()

        if not rows:
            # No demos linked yet — either the import failed before
            # writing any Demo row, or the link hasn't landed yet.
            # Give it one short retry window; if it's still empty,
            # bail so we don't block the scheduler indefinitely.
            await asyncio.sleep(min(10, PARSE_POLL_SECONDS))
            db2 = SessionLocal()
            try:
                rows = (
                    db2.query(Demo.id, Demo.status, Demo.processing_progress)
                    .filter(Demo.pro_match_id == match_id)
                    .all()
                )
            finally:
                db2.close()
            if not rows:
                return "no_demos"

        statuses = [(r.id, r.status, r.processing_progress) for r in rows]
        non_terminal = [s for s in statuses if s[1] not in terminal]
        # Log progress only when something CHANGED, so a 30-minute
        # wait doesn't spam the logs every 15 s.
        snapshot = tuple(sorted((s[0], s[1], s[2] or 0) for s in statuses))
        if snapshot != last_logged:
            logger.info(
                "scheduler waiting on match %s parse: %s",
                match_id,
                ", ".join(f"demo {sid}={st}@{pp}%" for sid, st, pp in statuses),
            )
            last_logged = snapshot

        if not non_terminal:
            return "done"

        if asyncio.get_event_loop().time() >= deadline:
            return "timeout"

        if await _wait_or_shutdown(PARSE_POLL_SECONDS):
            return "shutdown"


# ---------------------------------------------------------------------------
# Import step — fire up to MAX_IMPORTS_PER_TICK imports, rate-limited.
# ---------------------------------------------------------------------------
async def _import_step() -> None:
    cutoff = pro_cutoff_naive()

    # ---- Daily download budget gate ---------------------------------
    # Burn-rate check before we even open the candidate query: if
    # we've already pulled DAILY_DOWNLOAD_LIMIT_GB worth of demos in
    # the current UTC day, skip this tick entirely. The proxy quota
    # is what we're protecting — going over means the pool burns its
    # monthly allowance and the auto-importer goes dark for the
    # remainder of the month.
    if DAILY_DOWNLOAD_LIMIT_GB > 0:
        used_bytes = _bytes_downloaded_today()
        limit_bytes = DAILY_DOWNLOAD_LIMIT_GB * (1024 ** 3)
        if used_bytes >= limit_bytes:
            logger.info(
                "scheduler: daily download budget reached (%.2f / %d GB) — "
                "skipping import tick until 00:00 UTC",
                used_bytes / (1024 ** 3), DAILY_DOWNLOAD_LIMIT_GB,
            )
            _state["last_import_count"] = 0
            _state["last_import_errors"] = 0
            _state["last_import_status"] = {"budget_exhausted": 1}
            return

    db = SessionLocal()
    try:
        # Candidates: completed matches with no demo_id yet, on or after
        # the cutoff date, AND inside the operator's allowed tier buckets
        # (``PRO_AUTO_TIERS`` env — default S+/S/A/B). This stops the
        # proxy budget from being burned on C-tier scrims and FACEIT
        # cups that nobody asked for; admins can still trigger a manual
        # import for those from the UI.
        # The env value is a plain string ("S+,S,A,B") so we split here —
        # see the comment in core/settings.py for why it's not List[str].
        #
        # NOTE: we DO NOT require ``demo_url IS NOT NULL`` here anymore.
        # HltvSource intentionally leaves demo_url null at sync time
        # (visiting every match page would double proxy traffic). The
        # import worker scrapes the match page on demand and resolves the
        # download link before grabbing the bytes, so a null demo_url is
        # fine for auto-import.
        raw_tiers = get_settings().pro_auto_tiers or ""
        allowed_tiers = [t.strip() for t in raw_tiers.split(",") if t.strip()]
        from sqlalchemy import or_

        # Base query — NO score filter. Re-imports draw from this directly
        # (we already downloaded them once, so scores being NULL — e.g. the
        # score regex failed on an older scrape — shouldn't block getting
        # the demo back). Fresh candidates add the score filter below.
        #
        # IMPORTANT: exclude matches with import_status='failed'. Those
        # have already been tried and produced a permanent / transient
        # error. The auto-retry logic (`_auto_retry_failed_demos`) is
        # the ONLY thing that should bring them back, and it does so by
        # explicitly clearing import_status. Without this filter, the
        # candidate query keeps picking the same dead matches every
        # tick — exactly what we saw with 37 "fresh eligible" matches
        # all lacking source_match_id.
        q_base = (
            db.query(ProMatch)
            .filter(ProMatch.played_at >= cutoff)
            .filter(ProMatch.demo_id == None)  # noqa: E711
            .filter(or_(
                ProMatch.import_status.is_(None),
                ProMatch.import_status != "failed",
            ))
        )
        if allowed_tiers:
            # Allow NULL-tier matches through: SQL NULL IN (...) evaluates
            # to NULL (falsy), so tier.in_() alone silently excludes every
            # unclassified match. We want to download those too — if the
            # HLTV star regex failed, the match is still worth importing.
            q_base = q_base.filter(
                or_(ProMatch.tier.in_(allowed_tiers), ProMatch.tier.is_(None))
            )

        # Fresh-candidate query. We DO NOT require non-null scores:
        # HltvSource only lists matches from /results, which by definition
        # are ALREADY PLAYED (completed) and have a demo link. A NULL score
        # on those rows is a score-regex parse miss, not a "still live"
        # signal — blocking on it left the entire Major backlog stuck
        # (52 no-demo matches with null scores). The import worker visits
        # the match page and resolves the demo on demand; if there's
        # genuinely no demo yet it just reports download_failed and we
        # retry next tick, which is cheap.
        q = q_base

        # ---- Two-bucket fetch: re-imports first, then fresh -----------
        # A "re-import" is a match the operator explicitly asked us to
        # try again — either via the purge-missing workflow (bytes gone
        # from S3, the demo row was deleted and ProMatch.demo_id
        # cleared) or a manual reset. The signal we use is:
        #
        #   demo_id IS NULL AND import_completed_at IS NOT NULL
        #
        # That means "we already downloaded this once, the budget is
        # already spent on it, and the operator wants it back". These
        # should always beat fresh candidates regardless of tier — if
        # you downloaded a B-tier scrim yesterday and lost it, you
        # probably still want it back before today's brand-new C-tier.
        #
        # We fetch them as a separate, unlimited query so a big batch
        # of re-imports doesn't get squeezed out of a date-ordered
        # pool of 50.  Typical re-import burst is 10-30 matches; even
        # 200 wouldn't be expensive.
        reimport_candidates: list[ProMatch] = (
            q_base.filter(ProMatch.import_completed_at.isnot(None))
            .order_by(ProMatch.played_at.desc().nullslast())
            .all()
        )

        # Fresh candidates: never been downloaded. Big pool so the
        # tier-priority sort has room to choose — order_by(played_at)
        # alone with LIMIT N would let recent C-tier scrims push out
        # yesterday's Major final because they're newer.
        pool_size = max(MAX_IMPORTS_PER_TICK * 10, 50)
        fresh_candidates: list[ProMatch] = (
            q.filter(ProMatch.import_completed_at.is_(None))
            .order_by(ProMatch.played_at.desc().nullslast())
            .limit(pool_size)
            .all()
        )

        candidates: list[ProMatch] = reimport_candidates + fresh_candidates

        # Surface the re-import queue depth so the /pro chip can show
        # "X re-imports priorizados" — gives the operator confidence
        # that the matches they purged earlier are actually next in
        # line, not stuck at the bottom of the candidate pool.
        _state["reimport_queue"] = len(reimport_candidates)
        # Completeness filter. We only DROP a candidate when it has a
        # score that proves it's still in progress (total == 1, i.e. a
        # live 1-0). Matches with NO score at all are trusted: HltvSource
        # only lists completed /results matches, and re-imports were
        # already downloaded once. This keeps the Major backlog (null
        # scores from a regex miss) eligible instead of silently dropped.
        def _is_complete_enough(m: ProMatch) -> bool:
            if m.score_a is None and m.score_b is None:
                return True  # trust the source (HLTV /results = played)
            return (m.score_a or 0) + (m.score_b or 0) >= 2
        candidates = [m for m in candidates if _is_complete_enough(m)]

        # Three-level priority sort:
        #   1. Re-imports first (operator-requested retries beat
        #      everything else regardless of tier).
        #   2. Within each bucket, S+ → S → A → B → C → NULL.
        #   3. Within each tier, newer matches win.
        #
        # The two-bucket fetch above guarantees the right candidates
        # are present in ``candidates``; the sort below decides the
        # actual order they get processed in this tick.
        def _candidate_priority(m: ProMatch) -> tuple:
            is_reimport = (
                m.import_completed_at is not None and m.demo_id is None
            )
            reimport_bucket = 0 if is_reimport else 1
            tier_p = _TIER_PRIORITY.get(m.tier, _TIER_PRIORITY[None])
            played_ts = (
                -m.played_at.timestamp() if m.played_at else 0
            )
            return (reimport_bucket, tier_p, played_ts)

        candidates.sort(key=_candidate_priority)
        total_before_limit = len(candidates)
        candidates = candidates[:MAX_IMPORTS_PER_TICK]

        logger.info(
            "import step: reimport=%d fresh=%d eligible=%d -> taking %d this tick "
            "(allowed_tiers=%s, cutoff=%s)",
            len(reimport_candidates), len(fresh_candidates), total_before_limit,
            len(candidates), allowed_tiers or "ALL", cutoff.date().isoformat(),
        )

        # One-shot DB-state breakdown so we can see WHERE matches sit when
        # eligible=0: total since cutoff, how many already have a demo, how
        # many lack a demo, and of those, why they're excluded (no score /
        # tier blocked). Cheap counts, logged every tick.
        try:
            from sqlalchemy import func as _f
            total_since = (
                db.query(_f.count(ProMatch.id))
                .filter(ProMatch.played_at >= cutoff).scalar() or 0
            )
            with_demo = (
                db.query(_f.count(ProMatch.id))
                .filter(ProMatch.played_at >= cutoff)
                .filter(ProMatch.demo_id.isnot(None)).scalar() or 0
            )
            no_demo = (
                db.query(_f.count(ProMatch.id))
                .filter(ProMatch.played_at >= cutoff)
                .filter(ProMatch.demo_id.is_(None)).scalar() or 0
            )
            no_demo_no_score = (
                db.query(_f.count(ProMatch.id))
                .filter(ProMatch.played_at >= cutoff)
                .filter(ProMatch.demo_id.is_(None))
                .filter(or_(ProMatch.score_a.is_(None), ProMatch.score_b.is_(None)))
                .scalar() or 0
            )
            no_demo_tier_blocked = 0
            if allowed_tiers:
                no_demo_tier_blocked = (
                    db.query(_f.count(ProMatch.id))
                    .filter(ProMatch.played_at >= cutoff)
                    .filter(ProMatch.demo_id.is_(None))
                    .filter(ProMatch.tier.isnot(None))
                    .filter(ProMatch.tier.notin_(allowed_tiers))
                    .scalar() or 0
                )
            logger.info(
                "import DB state (since %s): total=%d with_demo=%d no_demo=%d "
                "(no_demo & null_score=%d, no_demo & tier_blocked=%d)",
                cutoff.date().isoformat(), total_since, with_demo, no_demo,
                no_demo_no_score, no_demo_tier_blocked,
            )
        except Exception:
            logger.exception("import DB-state diagnostic failed")

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
            # Re-check the daily budget BEFORE each new download.
            # A single Bo3 .rar can be 800 MB-1.5 GB, so even after we
            # passed the initial gate at the start of the tick, one
            # successful download mid-loop can push us over.  We stop
            # as soon as the budget is gone — accepting that we might
            # cross the line by a fraction of one demo, which is fine
            # for a soft cap.
            if DAILY_DOWNLOAD_LIMIT_GB > 0:
                used_now = _bytes_downloaded_today()
                limit_bytes = DAILY_DOWNLOAD_LIMIT_GB * (1024 ** 3)
                if used_now >= limit_bytes:
                    logger.info(
                        "scheduler: hit daily budget mid-tick (%.2f / %d GB) "
                        "— stopping after %d/%d candidates",
                        used_now / (1024 ** 3), DAILY_DOWNLOAD_LIMIT_GB,
                        i, len(candidates),
                    )
                    status_counts["budget_exhausted"] = (
                        status_counts.get("budget_exhausted", 0)
                        + (len(candidates) - i)
                    )
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
            except Exception as exc:
                logger.exception(
                    "scheduler auto-import failed for match %s", match.id,
                )
                # Even on exception, mark the match as failed so the
                # candidate query stops re-picking it every tick.
                try:
                    match.import_status = "failed"
                    match.import_error = f"{exc.__class__.__name__}: {exc}"
                    db.commit()
                except Exception:
                    logger.exception("failed to persist import error")
                    db.rollback()
                errors += 1
                await release_match(match.id)
                continue
            else:
                await release_match(match.id)
            status_counts[result.status] = status_counts.get(result.status, 0) + 1

            # CRITICAL: persist the import_status to the DB. Without this
            # the candidates query keeps picking up the same failed
            # matches every tick, hammering the queue with the same
            # "no source_match_id" / "no_demo_url" matches forever.
            # Mirrors what import_match_in_background does on the HTTP
            # import path.
            try:
                if result.status in ("queued", "existing"):
                    match.import_status = None
                    match.import_error = None
                else:
                    match.import_status = "failed"
                    match.import_error = result.message
                db.commit()
            except Exception:
                logger.exception(
                    "failed to persist import_status for match %s", match.id,
                )
                db.rollback()

            if result.status == "queued":
                queued += 1
                logger.info(
                    "auto-imported match %s (%s vs %s) → demo_id=%s",
                    match.id, match.team_a, match.team_b, result.demo_id,
                )
            elif result.status == "download_failed":
                errors += 1

            # Serialise behind parsing when enabled: don't scrape the
            # next candidate until the demo we just queued is fully
            # parsed (completed or failed). This stops two parses
            # from running in parallel and competing for RAM on the
            # 512 MB Hobby worker — the OOM was the root cause of
            # demos getting SIGKILL'd at 50-90 % and stuck in
            # ``processing`` forever.
            #
            # Only meaningful when the import actually queued
            # something for parsing. ``existing`` / ``invalid`` /
            # ``download_failed`` results have nothing to wait on,
            # so we fall through to the regular gap.
            if WAIT_FOR_PARSE and result.status == "queued":
                logger.info(
                    "scheduler: blocking on match %s parse before next scrape "
                    "(timeout=%ds)",
                    match.id, PARSE_WAIT_TIMEOUT,
                )
                outcome = await _wait_for_match_parsed(match.id, PARSE_WAIT_TIMEOUT)
                logger.info(
                    "scheduler: match %s wait → %s", match.id, outcome,
                )
                if outcome == "shutdown":
                    break
                # Tiny courtesy delay before the next HLTV hit even
                # when we just waited 10+ min for parsing — keeps the
                # proxy pool from looking burst-y to Cloudflare.
                if i < len(candidates) - 1:
                    if await _wait_or_shutdown(min(15, IMPORT_GAP_SECONDS)):
                        break
            else:
                # Legacy fire-and-forget path — wait BETWEEN imports.
                if i < len(candidates) - 1:
                    if await _wait_or_shutdown(IMPORT_GAP_SECONDS):
                        break

        _state["last_import_count"] = queued
        _state["last_import_errors"] = errors
        _state["last_import_status"] = status_counts
    finally:
        db.close()
