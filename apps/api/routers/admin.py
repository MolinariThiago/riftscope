"""
Admin endpoints — real data only.

Every endpoint is gated by :func:`require_admin`, which wraps the
shared :func:`routers.deps.get_current_user` dep and rejects with 403
if the caller's ``User.is_admin`` flag is False. There is no separate
admin token flow — anyone marked admin in the DB can use this.

The numbers returned here come straight from the live tables; no
estimates, no mock series. Growth time-series for the dashboard chart
are computed from ``users.created_at`` / ``demos.uploaded_at`` so it
reflects actual signup / upload activity.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.settings import get_settings
from core.utc import utcnow_naive
from db.database import get_db
from db.models.demo import Demo
from db.models.user import User
from routers.deps import get_current_user

router = APIRouter(prefix="/admin", tags=["admin"])


# ---------------------------------------------------------------------------
# Dependency: admin gate
# ---------------------------------------------------------------------------
def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


# ---------------------------------------------------------------------------
# Metrics — KPI cards on the dashboard
# ---------------------------------------------------------------------------
@router.get("/metrics")
def get_metrics(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    settings = get_settings()

    total_users = db.query(User).count()
    active_users = db.query(User).filter(User.is_active == True).count()  # noqa: E712
    total_demos = db.query(Demo).count()
    processed_demos = db.query(Demo).filter(Demo.status == "completed").count()
    failed_demos = db.query(Demo).filter(Demo.status == "failed").count()
    in_flight_demos = (
        db.query(Demo)
        .filter(Demo.status.in_(("uploaded", "queued", "processing")))
        .count()
    )
    pro_users = (
        db.query(User)
        .filter(
            User.subscription_tier == "pro",
            User.subscription_status == "active",
        )
        .count()
    )
    admins = db.query(User).filter(User.is_admin == True).count()  # noqa: E712

    # Stripe revenue: ONLY surface a real number when monetization is
    # enabled. Otherwise return null so the dashboard shows "—" rather
    # than a misleading $0.
    stripe_revenue: float | None = None
    if settings.monetization_enabled:
        # Until /billing/webhook ingests real invoice totals, the closest
        # truth is "# of active Pro subs × monthly price". Keep this as
        # an explicit estimate — the frontend labels it as such.
        stripe_revenue = round(pro_users * 5.99, 2)

    return {
        "total_users": total_users,
        "active_users": active_users,
        "admins": admins,
        "pro_users": pro_users,
        "total_demos": total_demos,
        "processed_demos": processed_demos,
        "failed_demos": failed_demos,
        "in_flight_demos": in_flight_demos,
        "stripe_revenue": stripe_revenue,
        "api_cost": None,  # wire when an AI billing source exists
        "monetization_enabled": settings.monetization_enabled,
    }


# ---------------------------------------------------------------------------
# Growth — daily / weekly buckets from real signup + upload activity
# ---------------------------------------------------------------------------
@router.get("/growth")
def get_growth(
    days: int = 28,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    days = max(7, min(180, int(days)))
    cutoff = utcnow_naive() - timedelta(days=days)

    granularity = "week" if days > 14 else "day"

    # Pick the date-bucketing function per dialect — strftime is SQLite-only;
    # Postgres uses to_char(). Detecting by the active engine keeps the same
    # endpoint working in both dev (SQLite) and prod (Postgres).
    dialect_name = db.get_bind().dialect.name  # "sqlite" | "postgresql"
    is_postgres = dialect_name.startswith("postgres")

    def bucket(col):
        if granularity == "week":
            if is_postgres:
                return func.to_char(col, "IYYY-IW")  # ISO year + week
            return func.strftime("%Y-%W", col)
        if is_postgres:
            return func.to_char(col, "YYYY-MM-DD")
        return func.strftime("%Y-%m-%d", col)

    users_rows = (
        db.query(bucket(User.created_at).label("bucket"), func.count(User.id))
        .filter(User.created_at >= cutoff)
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )
    demos_rows = (
        db.query(bucket(Demo.uploaded_at).label("bucket"), func.count(Demo.id))
        .filter(Demo.uploaded_at >= cutoff)
        .group_by("bucket")
        .order_by("bucket")
        .all()
    )

    user_map = {str(b): int(c) for b, c in users_rows if b}
    demo_map = {str(b): int(c) for b, c in demos_rows if b}
    all_buckets = sorted(set(user_map) | set(demo_map))

    series = [
        {"bucket": b, "users": user_map.get(b, 0), "demos": demo_map.get(b, 0)}
        for b in all_buckets
    ]
    return {"granularity": granularity, "days": days, "series": series}


# ---------------------------------------------------------------------------
# Users — paginated list (also used by /admin/users in UI)
# ---------------------------------------------------------------------------
@router.get("/users")
def get_users(
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    limit = max(1, min(500, limit))
    offset = max(0, offset)
    total = db.query(User).count()
    rows = (
        db.query(User)
        .order_by(User.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Demo counts per user — single query, joined in memory to avoid N+1
    user_ids = [u.id for u in rows]
    demo_counts: dict[str, int] = {}
    if user_ids:
        for uid, cnt in (
            db.query(Demo.user_id, func.count(Demo.id))
            .filter(Demo.user_id.in_(user_ids))
            .group_by(Demo.user_id)
            .all()
        ):
            demo_counts[str(uid)] = int(cnt)

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": str(u.id),
                "email": u.email,
                "username": u.username,
                "name": u.username or u.email or "Unknown",
                "tier": u.subscription_tier or "free",
                "subscription_status": u.subscription_status or "inactive",
                "role": "admin" if u.is_admin else "user",
                "status": "active" if u.is_active else "banned",
                "demos_count": demo_counts.get(str(u.id), 0),
                "created_at": u.created_at.isoformat() if u.created_at else None,
                "last_login": u.last_login.isoformat() if u.last_login else None,
            }
            for u in rows
        ],
    }


# ---------------------------------------------------------------------------
# Incidents — failed demos
# ---------------------------------------------------------------------------
@router.get("/incidents")
def get_incidents(
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    failed = (
        db.query(Demo)
        .filter(Demo.status == "failed")
        .order_by(Demo.uploaded_at.desc())
        .limit(20)
        .all()
    )
    return [
        {
            "id": str(d.id),
            "filename": d.filename,
            "user_id": d.user_id,
            "error": d.error_message or "Unknown processing error",
            "date": d.uploaded_at.isoformat() if d.uploaded_at else None,
        }
        for d in failed
    ]


# ---------------------------------------------------------------------------
# Mutating actions — small, reversible, audit-friendly.
# ---------------------------------------------------------------------------


class _Toggle(BaseModel):
    value: bool


@router.post("/users/{user_id}/admin")
def set_admin(
    user_id: str,
    payload: _Toggle,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin_user.id and not payload.value:
        # Don't let an admin lock themselves out.
        raise HTTPException(
            status_code=400,
            detail="You can't remove admin from your own account.",
        )
    user.is_admin = bool(payload.value)
    db.commit()
    return {"id": str(user.id), "is_admin": user.is_admin}


@router.post("/users/{user_id}/active")
def set_active(
    user_id: str,
    payload: _Toggle,
    db: Session = Depends(get_db),
    admin_user: User = Depends(require_admin),
):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.id == admin_user.id and not payload.value:
        raise HTTPException(
            status_code=400, detail="You can't ban your own account."
        )
    user.is_active = bool(payload.value)
    db.commit()
    return {"id": str(user.id), "is_active": user.is_active}


class _TierPayload(BaseModel):
    tier: str  # "free" | "pro"


@router.post("/users/{user_id}/tier")
def set_tier(
    user_id: str,
    payload: _TierPayload,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if payload.tier not in {"free", "pro"}:
        raise HTTPException(status_code=400, detail="tier must be 'free' or 'pro'")
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user.subscription_tier = payload.tier
    user.subscription_status = "active" if payload.tier == "pro" else "inactive"
    db.commit()
    return {
        "id": str(user.id),
        "tier": user.subscription_tier,
        "status": user.subscription_status,
    }


@router.delete("/demos/{demo_id}")
def admin_delete_demo(
    demo_id: int,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Hard-delete a demo as admin (bypass ownership check)."""
    demo = db.query(Demo).filter(Demo.id == demo_id).first()
    if not demo:
        raise HTTPException(status_code=404, detail="Demo not found")
    db.delete(demo)
    db.commit()
    return {"ok": True}


@router.post("/demos/retry-failed")
async def admin_retry_failed_demos(
    pro_only: bool = False,
    limit: int = 50,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Re-queue every ``failed`` demo for parsing without touching disk.

    Reuses the same ``process_demo`` pipeline the per-demo
    ``/demos/{id}/reprocess`` endpoint hits — flips status back to
    ``queued`` and schedules a fresh parse task. The .dem (or .rar)
    bytes are still on storage, so no re-download is needed: the
    worker just walks the file again with the current parser.

    Args:
      pro_only: when True, only retries demos linked to a ProMatch
        (skips solo uploads). Useful right after auto-import
        regressions.
      limit: cap the number of demos re-queued per call so the worker
        isn't flooded.  Default 50.

    Returns:
      ``{"requeued": N, "skipped": M, "demoIds": [...]}`` so the UI
      can show what actually moved.
    """
    from services.storage import get_storage
    from workers.demo_worker import schedule_demo_processing

    storage = get_storage()
    bucket = getattr(storage, "bucket", None)

    q = db.query(Demo).filter(Demo.status == "failed")
    if pro_only:
        q = q.filter(Demo.pro_match_id.isnot(None))
    candidates: list[Demo] = (
        q.order_by(Demo.uploaded_at.desc()).limit(max(1, min(500, limit))).all()
    )

    requeued_ids: list[int] = []
    skipped = 0

    for demo in candidates:
        # Defensive: the file has to be reachable. For S3 we trust the
        # bucket; for local we verify the path exists so a known-dead
        # demo doesn't get re-queued just to fail the same way.
        if not demo.storage_filename:
            skipped += 1
            continue
        if bucket:
            abs_path = f"s3://{bucket}/{demo.storage_filename}"
        else:
            try:
                local = storage.get_path(demo.storage_filename)
                if not local.exists():
                    skipped += 1
                    continue
                abs_path = str(local)
            except Exception:  # pragma: no cover — defensive
                skipped += 1
                continue

        demo.status = "queued"
        demo.processing_progress = 0
        demo.error_message = None
        demo.processed_at = None
        requeued_ids.append(demo.id)

        # Schedule on the running event loop. ``schedule_demo_processing``
        # keeps a strong reference to the spawned task via core.bg.spawn
        # so the GC won't collect it mid-parse.
        schedule_demo_processing(demo.id, abs_path)

    db.commit()
    return {
        "requeued": len(requeued_ids),
        "skipped": skipped,
        "demoIds": requeued_ids,
        "proOnly": pro_only,
    }


@router.post("/demos/reset-stuck")
def admin_reset_stuck_demos(
    older_than_minutes: int = 30,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Mark stale ``processing`` demos as ``failed`` so the UI unblocks.

    A demo stays in ``status="processing"`` when the worker process is
    killed mid-parse (Railway Hobby OOM, container restart, deploy
    bounce). The exception path in ``process_demo`` never runs in
    that case so the row never gets updated to ``failed``, and the
    /pro card spins forever at 50/80/90%.

    This endpoint is the manual recovery: any demo that's been
    ``processing`` for more than ``older_than_minutes`` (default 30)
    is flagged failed with a clear error message. It also clears the
    matching ``ProMatch.import_status`` so the operator can hit
    "Importar" again.

    Returns the count of demos and matches updated.
    """
    from db.models.pro_match import ProMatch
    from sqlalchemy import text

    cutoff = utcnow_naive() - timedelta(minutes=max(1, older_than_minutes))

    # Pull the stuck rows so we can also unstick the linked ProMatches
    # in the same transaction.
    stuck = (
        db.query(Demo)
        .filter(Demo.status == "processing")
        .filter(Demo.uploaded_at < cutoff)
        .all()
    )
    pro_match_ids = {d.pro_match_id for d in stuck if d.pro_match_id}

    demos_reset = 0
    for d in stuck:
        d.status = "failed"
        d.error_message = (
            "Parsing aborted (worker killed mid-parse — likely OOM on Railway Hobby). "
            "Re-upload or reduce concurrency."
        )
        demos_reset += 1

    matches_reset = 0
    if pro_match_ids:
        # Clear import_status on the parent ProMatches so the manual
        # "Importar" button works again. Only touch the ones that are
        # still marked ``importing`` — don't clobber successful imports
        # that just happen to share an id with a different stuck demo.
        matches = (
            db.query(ProMatch)
            .filter(ProMatch.id.in_(pro_match_ids))
            .filter(ProMatch.import_status == "importing")
            .all()
        )
        for m in matches:
            m.import_status = "failed"
            m.import_error = "Worker killed mid-parse — try re-importing."
            matches_reset += 1

    db.commit()
    return {
        "demosReset": demos_reset,
        "matchesReset": matches_reset,
        "cutoff": cutoff.isoformat(),
    }
