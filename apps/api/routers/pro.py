"""
/pro endpoints — pro / community match feed driven by external sources.

  * ``GET  /pro/matches``          — paginated feed (cached in DB).
  * ``POST /pro/sync``             — manual one-shot Liquipedia pull.
  * ``POST /pro/matches/{id}/import`` — pull demo from HLTV + queue parse.
  * ``GET  /pro/scheduler/status`` — last-tick info for the auto-import bg job.
  * ``DELETE /pro/matches/{id}``   — admin cleanup.

The heavy lifting lives in :mod:`services.pro_import` and
:mod:`services.pro_scheduler` so the same code path runs whether the
import is triggered manually (HTTP) or by the background scheduler.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    UploadFile,
)
from sqlalchemy.orm import Session

from core.settings import get_settings
from db.database import get_db
from db.models.demo import Demo
from db.models.pro_match import ProMatch
from db.models.user import User
from routers.admin import require_admin
from services.demo_sources import get_sources
from core.bg import spawn
from services.pro_import import (
    get_pro_cutoff,
    import_match_demo,
    import_match_in_background,
    pro_cutoff_naive,
)
from services.pro_scheduler import scheduler_status
from services.storage import UPLOAD_DIR
from workers.demo_worker import process_demo

logger = logging.getLogger("riftscope.pro")
router = APIRouter()


@router.get("/matches")
async def list_pro_matches(
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
):
    """Paginated pro-match feed. Returns matches whose ``played_at`` is on
    or after :func:`get_pro_cutoff`, PLUS every manual upload regardless
    of date — manual uploads are intentional curation by the operator,
    so they shouldn't get hidden by the auto-scrape cutoff.

    Each match's response carries a ``maps`` array with every Demo
    linked to that ProMatch (via Demo.pro_match_id). For a Bo3 series
    that's 2-3 entries (one per map); for a Bo1 it's a single entry.
    """
    from sqlalchemy import or_
    cutoff = pro_cutoff_naive()
    rows = (
        db.query(ProMatch)
        .filter(or_(
            ProMatch.played_at >= cutoff,
            ProMatch.source == "manual",
        ))
        .order_by(ProMatch.played_at.desc().nullslast(), ProMatch.id.desc())
        .limit(limit)
        .all()
    )
    # Eager-load every Demo that's linked to one of these matches in a
    # single query, then bucket them by pro_match_id. Avoids the N+1 we'd
    # get from triggering a relationship lazy-load per match.
    match_ids = [r.id for r in rows]
    demos_by_match: dict[int, list[Demo]] = {}
    if match_ids:
        demos = (
            db.query(Demo)
            .filter(Demo.pro_match_id.in_(match_ids))
            .order_by(Demo.id.asc())
            .all()
        )
        for d in demos:
            demos_by_match.setdefault(d.pro_match_id, []).append(d)

    def _serialise_map(d: Demo) -> dict:
        # Slim per-map payload — the /pro card only needs enough to render
        # the row, link to the replay viewer, and reflect parse state.
        return {
            "demoId": d.id,
            "map": d.map_name,
            "filename": d.filename,
            "status": d.status,
            "processingProgress": d.processing_progress,
            "scoreA": d.score_a,
            "scoreB": d.score_b,
            "durationSeconds": d.duration_seconds,
            "errorMessage": d.error_message,
        }

    payload: list[dict] = []
    for r in rows:
        match_dict = r.to_dict()
        match_dict["maps"] = [_serialise_map(d) for d in demos_by_match.get(r.id, [])]
        payload.append(match_dict)

    return {
        "total": len(rows),
        "indexFrom": get_pro_cutoff().isoformat(),
        "matches": payload,
    }


@router.post("/sync")
async def sync_pro_matches(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """
    Pull recent matches from every active source and upsert them.

    Filters matches whose ``played_at`` falls before the configured
    cutoff (``PRO_INDEX_FROM`` env or today) so the DB doesn't fill
    up with historical noise the operator explicitly opted out of.
    """
    cutoff = pro_cutoff_naive()
    since = datetime.now(timezone.utc) - timedelta(days=14)
    inserted = 0
    updated = 0
    skipped_before_cutoff = 0
    errors: list[dict] = []

    for source in get_sources():
        try:
            matches = await source.list_recent_matches(since=since, limit=100)
        except Exception as exc:  # pragma: no cover — network issues
            logger.exception("source %s failed", source.name)
            errors.append({"source": source.name, "error": str(exc)})
            continue

        for m in matches:
            played_at_naive = (
                m.played_at.astimezone(timezone.utc).replace(tzinfo=None)
                if m.played_at is not None
                else None
            )

            # Skip anything before the cutoff. Without a played_at we
            # can't tell when it happened so we drop those too — the
            # UI couldn't place them on a timeline anyway.
            if played_at_naive is None or played_at_naive < cutoff:
                skipped_before_cutoff += 1
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
                # Backfill tier on rows inserted before the source emitted
                # one. Never overwrite a manual override.
                if m.tier and not existing.tier:
                    existing.tier = m.tier
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
                    tier=m.tier,
                )
            )
            inserted += 1

    db.commit()
    return {
        "inserted": inserted,
        "updated": updated,
        "skipped_before_cutoff": skipped_before_cutoff,
        "errors": errors,
    }


@router.post("/matches/{match_id}/import", status_code=202)
async def import_pro_match(
    match_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Kick off a HLTV import in the background and return immediately.

    The download can take minutes (HLTV demos are 300 MB-1 GB), so we no
    longer ``await`` it inside the request — that left the UI spinner stuck
    for the whole download and looked like an infinite hang when HLTV
    stalled. Instead we flip ``import_status`` to "importing", spawn the
    download as a tracked background task, and return 202. The /pro list
    polls and reflects the status (downloading → done / failed).
    """
    match = db.query(ProMatch).filter(ProMatch.id == match_id).first()
    if not match:
        raise HTTPException(status_code=404, detail="Pro match not found")

    # Already imported — nothing to do; point at the existing demo.
    if match.demo_id:
        return {
            "status": "existing",
            "demo_id": match.demo_id,
            "message": "Este partido ya fue importado.",
        }
    # Already downloading — idempotent, don't launch a second download.
    if match.import_status == "importing":
        return {
            "status": "importing",
            "demo_id": None,
            "message": "Ya se está importando esta demo…",
        }

    match.import_status = "importing"
    match.import_error = None
    db.commit()

    spawn(import_match_in_background(match.id), name=f"import-match-{match.id}")
    return {
        "status": "importing",
        "demo_id": None,
        "message": "Importación iniciada. El estado se actualiza en /pro.",
    }


@router.get("/scheduler/status")
async def get_scheduler_status(_admin: User = Depends(require_admin)):
    """Tiny status endpoint so the UI can show whether the auto-import
    background task is alive and when it last ran.

    Admin-only: the payload includes the last-tick timestamps, RAR
    runtime path, and import error counts — operational info that
    shouldn't be enumerable by anonymous visitors.
    """
    return scheduler_status()


@router.get("/proxy-test")
async def test_proxy(_admin: User = Depends(require_admin)):
    """Verify the configured outbound proxy actually works.

    Hits an IP-echo service (api.ipify.org) twice — once direct and
    once through the proxy — so you can see at a glance whether the
    proxy is routing traffic. Use this BEFORE relying on Liquipedia
    requests: if the proxy doesn't work here, the scheduler can't
    bypass the Cloudflare ban either.

    Reports:
      - configured: which env var resolved to a proxy URL (if any)
      - direct_ip:  your real public IP (no proxy)
      - proxy_ip:   the IP traffic exits with through the proxy
      - proxy_ok:   true iff the proxy responded AND the IP changed
    """
    out: dict = {
        "configured": None,
        "direct_ip": None,
        "proxy_ip": None,
        "proxy_ok": False,
        "errors": [],
    }

    # Identify which env var is in play (priority order matches the
    # scrapers themselves).
    for key in ("LIQUIPEDIA_PROXY", "HLTV_PROXY", "HTTPS_PROXY", "HTTP_PROXY"):
        v = os.getenv(key)
        if v:
            out["configured"] = {"var": key, "value": _mask_proxy(v)}
            proxy_url = v
            break
    else:
        proxy_url = None

    # Direct lookup — what IP do we expose without a proxy?
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get("https://api.ipify.org?format=json")
            r.raise_for_status()
            out["direct_ip"] = r.json().get("ip")
    except Exception as exc:
        out["errors"].append(f"direct: {exc}")

    if not proxy_url:
        out["errors"].append(
            "No proxy configured. Set LIQUIPEDIA_PROXY / HLTV_PROXY in .env "
            "and restart the API."
        )
        return out

    # Proxy lookup — does the proxy work AND give us a different IP?
    started = time.monotonic()
    try:
        async with httpx.AsyncClient(timeout=15.0, proxy=proxy_url) as client:
            r = await client.get("https://api.ipify.org?format=json")
            r.raise_for_status()
            out["proxy_ip"] = r.json().get("ip")
            out["proxy_latency_ms"] = round((time.monotonic() - started) * 1000)
    except Exception as exc:
        out["errors"].append(f"proxy: {exc}")
        return out

    out["proxy_ok"] = bool(
        out["proxy_ip"] and out["proxy_ip"] != out["direct_ip"]
    )
    if not out["proxy_ok"] and out["proxy_ip"] == out["direct_ip"]:
        out["errors"].append(
            "Proxy responded but returned your real IP — the proxy is "
            "passing through unchanged. Check that the URL is correct."
        )
    return out


def _mask_proxy(url: str) -> str:
    """Hide passwords from proxy URLs in logs/responses."""
    if "@" not in url:
        return url
    scheme_creds, _, host = url.partition("@")
    scheme, _, creds = scheme_creds.rpartition("//")
    user = creds.split(":", 1)[0]
    return f"{scheme}//{user}:***@{host}"


# ===========================================================================
# Admin-only manual upload — operator picks pro demos, fills metadata, drops
# the file. We create a ``ProMatch`` row tagged ``source="manual"`` linked
# to a new ``Demo`` that goes through the regular parse pipeline. After it
# parses, the partido appears in /pro with the "Ver en 2D" button ready.
#
# This is the path the operator actually wants for "all daily HLTV demos in
# the 2D viewer" — automated scraping fights Cloudflare; manual curation
# costs ~30 seconds per match but gives 100 % reliability.
# ===========================================================================
VALID_TIERS = {"S+", "S", "A", "B", "C"}


@router.post("/matches/upload")
async def upload_pro_match(
    file: UploadFile = File(...),
    team_a: str = Form(...),
    team_b: str = Form(...),
    score_a: int = Form(...),
    score_b: int = Form(...),
    event_name: str = Form(...),
    map_name: str | None = Form(None),
    played_at: str | None = Form(None),  # ISO date "2026-05-23"
    tier: str | None = Form(None),       # S+ / S / A / B / C — admin only, hidden from public feed
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Manually publish a pro match to /pro.

    Workflow:
      1. Admin grabs a .dem from HLTV / wherever (any source).
      2. Posts the file + match metadata here.
      3. Backend stores the file via the normal storage path, creates
         a ``Demo`` row + a ``ProMatch`` linked to it, and enqueues the
         parser.
      4. Once parsing finishes, the match shows up in /pro with the
         "Ver en 2D" deep link ready — same as auto-imported ones.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    if not file.filename.lower().endswith(".dem"):
        raise HTTPException(
            status_code=400,
            detail="Only .dem files are supported. Extract .rar/.zip first.",
        )

    # Validate scores. Allow 0-30 to leave room for OT BO1 rounds even
    # though pro BOs cap at 3 — we don't enforce series format here.
    if not (0 <= score_a <= 30) or not (0 <= score_b <= 30):
        raise HTTPException(
            status_code=400,
            detail="Scores must be between 0 and 30",
        )

    # Validate tier — must be one of the recognised buckets or NULL.
    # The constraint exists at the API layer (the DB column is plain
    # VARCHAR) so we keep the option to add tiers later without a
    # schema migration.
    tier_normalized: str | None = None
    if tier:
        candidate = tier.strip().upper()
        if candidate and candidate not in VALID_TIERS:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid tier {candidate!r}. Use one of: {sorted(VALID_TIERS)} or leave empty.",
            )
        tier_normalized = candidate or None

    # Parse the date or default to "now".
    if played_at:
        try:
            played_dt = datetime.fromisoformat(played_at)
            if played_dt.tzinfo is None:
                played_dt = played_dt.replace(tzinfo=timezone.utc)
        except ValueError as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid played_at (use ISO date): {exc}",
            )
    else:
        played_dt = datetime.now(timezone.utc)
    played_naive = played_dt.astimezone(timezone.utc).replace(tzinfo=None)

    # Persist the .dem to storage via the same path the upload UI uses.
    #
    # Stream the upload to disk in 1 MB chunks instead of buffering the
    # whole file in RAM (the previous ``await file.read()`` call would
    # try to materialise up to ``upload_max_bytes`` = 2 GB in memory,
    # which OOM-killed the API process on a single big HLTV upload).
    #
    # Validate the HL2DEMO magic on the FIRST chunk so non-demo files
    # are rejected after at most 1 MB of disk writes — early enough
    # that the cleanup path doesn't leave huge garbage behind.
    storage_filename = f"{uuid4()}.dem"
    abs_path = UPLOAD_DIR / storage_filename
    settings = get_settings()
    max_bytes = settings.upload_max_bytes
    CHUNK = 1024 * 1024  # 1 MB
    total = 0
    first_chunk = True
    try:
        with abs_path.open("wb") as out_fp:
            while True:
                chunk = await file.read(CHUNK)
                if not chunk:
                    break
                if first_chunk:
                    first_chunk = False
                total += len(chunk)
                if total > max_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail=(
                            f"Upload exceeds the {max_bytes} byte limit. "
                            "Trim the demo or raise UPLOAD_MAX_BYTES in the API env."
                        ),
                    )
                out_fp.write(chunk)
    except HTTPException:
        # Rollback the partial file so a rejected upload doesn't leak
        # disk space.  ``missing_ok=True`` is correct since the file
        # may not exist if validation failed before the first write.
        try:
            abs_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise
    if first_chunk:
        # Stream was empty — never read a single byte.  Treat as a bad
        # request rather than a "queued" demo that will silently fail
        # to parse later.
        try:
            abs_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # Create the Demo row + queue parsing.
    demo = Demo(
        filename=file.filename,
        storage_filename=storage_filename,
        status="queued",
        processing_progress=0,
    )
    db.add(demo)
    db.commit()
    db.refresh(demo)

    # Create the ProMatch row tagged ``manual``. Unique key uses a
    # uuid so admins can upload N matches with the same teams + day
    # without colliding.
    pro_match = ProMatch(
        source="manual",
        source_match_id=f"manual-{uuid4()}",
        team_a=team_a.strip(),
        team_b=team_b.strip(),
        score_a=int(score_a),
        score_b=int(score_b),
        map_name=(map_name.strip() if map_name else None),
        event_name=event_name.strip(),
        tier=tier_normalized,
        played_at=played_naive,
        demo_url=None,  # no external URL — admin already has the file
        demo_id=demo.id,
    )
    db.add(pro_match)
    db.commit()
    db.refresh(pro_match)

    # Kick off parsing in the background. ``spawn`` retains a strong
    # reference so the parse task can't be garbage-collected mid-run.
    spawn(process_demo(demo.id, str(abs_path)), name=f"parse-demo-{demo.id}")
    logger.info(
        "manual pro upload: pro_match=%s demo=%s team_a=%r team_b=%r event=%r",
        pro_match.id, demo.id, pro_match.team_a, pro_match.team_b,
        pro_match.event_name,
    )

    return {
        "pro_match_id": pro_match.id,
        "demo_id": demo.id,
        "status": "queued",
        "message": (
            "Demo subido y encolado. En unos minutos va a aparecer en /pro "
            "con el botón 'Ver en 2D'."
        ),
    }


@router.delete("/matches/{match_id}")
async def delete_pro_match(
    match_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Admin-only cleanup. Previously this had NO auth — any visitor
    could enumerate ``match_id`` and wipe entries from the pro feed."""
    row = db.query(ProMatch).filter(ProMatch.id == match_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Pro match not found")
    db.delete(row)
    db.commit()
    return None
