"""
Feedback widget endpoints.

Three routes:

  * ``POST /feedback``                 — authenticated users submit a report.
  * ``GET  /admin/feedback``           — admin queue (filter + counts).
  * ``PATCH /admin/feedback/{id}``     — admin triage (status / notes).

Rate-limiting is deliberately gentle (max 5 reports per user per hour)
so a typo'd Send doesn't drown the queue but a serious bug spree from
one user still gets through. Anonymous reports were intentionally ruled
out at design time — the widget only renders for logged-in users.
"""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from core.utc import utcnow_naive
from db.database import get_db
from db.models.feedback import (
    FEEDBACK_CATEGORIES,
    FEEDBACK_STATUSES,
    FeedbackReport,
)
from db.models.user import User
from routers.admin import require_admin
from routers.deps import get_current_user
from schemas.feedback import (
    FeedbackAdmin,
    FeedbackAdminList,
    FeedbackAdminUpdate,
    FeedbackCreate,
    FeedbackPublic,
)

# Two routers — one public-ish (/feedback) and one admin (/admin/feedback)
# — registered separately in main.py.
public_router = APIRouter(prefix="/feedback", tags=["feedback"])
admin_router = APIRouter(prefix="/admin/feedback", tags=["feedback-admin"])


# ---------------------------------------------------------------------------
# Per-user rate limit
# ---------------------------------------------------------------------------
_RATE_WINDOW = timedelta(hours=1)
_RATE_MAX = 5


def _check_rate_limit(db: Session, user_id: str) -> None:
    """Raise 429 if the user already submitted 5+ reports in the last hour.

    Counted against ``created_at`` so admins moving statuses can't
    accidentally reset somebody's budget. Cheap query (indexed user_id +
    created_at), runs once per submit.
    """
    cutoff = utcnow_naive() - _RATE_WINDOW
    recent = (
        db.query(func.count(FeedbackReport.id))
        .filter(FeedbackReport.user_id == user_id)
        .filter(FeedbackReport.created_at >= cutoff)
        .scalar()
    )
    if (recent or 0) >= _RATE_MAX:
        raise HTTPException(
            status_code=429,
            detail=(
                f"Demasiados reportes (max {_RATE_MAX}/hora). "
                "Esperá un rato y volvé a intentar."
            ),
        )


# ---------------------------------------------------------------------------
# POST /feedback — user submit
# ---------------------------------------------------------------------------
@public_router.post("", response_model=FeedbackPublic, status_code=201)
def submit_feedback(
    body: FeedbackCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if body.category not in FEEDBACK_CATEGORIES:
        # Pydantic already enforces the Literal but keep this defensive
        # check so a stale frontend / curl can't slip past with a typo.
        raise HTTPException(status_code=400, detail="Invalid category")

    _check_rate_limit(db, current_user.id)

    report = FeedbackReport(
        user_id=current_user.id,
        category=body.category,
        subject=body.subject,
        body=body.body,
        status="open",
        page_url=body.page_url,
        user_agent=body.user_agent,
        demo_id=body.demo_id,
    )
    db.add(report)
    db.commit()
    db.refresh(report)
    return FeedbackPublic(
        id=report.id,
        status=report.status,
        createdAt=report.created_at,
    )


# ---------------------------------------------------------------------------
# GET /admin/feedback — list with optional status filter
# ---------------------------------------------------------------------------
@admin_router.get("", response_model=FeedbackAdminList)
def list_feedback(
    status: str | None = None,
    limit: int = 200,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    """Return all feedback rows, newest first, plus per-status counts.

    ``status`` may be one of FEEDBACK_STATUSES to filter the list (the
    counts are always computed across ALL statuses so the UI can keep
    its filter chips populated).
    """
    limit = max(1, min(int(limit), 500))

    base = db.query(FeedbackReport)
    if status:
        if status not in FEEDBACK_STATUSES:
            raise HTTPException(status_code=400, detail="Invalid status filter")
        rows = (
            base.filter(FeedbackReport.status == status)
            .order_by(FeedbackReport.created_at.desc())
            .limit(limit)
            .all()
        )
    else:
        rows = (
            base.order_by(FeedbackReport.created_at.desc())
            .limit(limit)
            .all()
        )

    # Counts per status — single query, grouped.
    grouped = (
        db.query(FeedbackReport.status, func.count(FeedbackReport.id))
        .group_by(FeedbackReport.status)
        .all()
    )
    counts: dict[str, int] = {s: 0 for s in FEEDBACK_STATUSES}
    for s, n in grouped:
        counts[s] = int(n)

    return FeedbackAdminList(
        total=sum(counts.values()),
        items=[FeedbackAdmin.model_validate(r.to_admin_dict()) for r in rows],
        counts=counts,
    )


# ---------------------------------------------------------------------------
# PATCH /admin/feedback/{id} — change status / leave a note
# ---------------------------------------------------------------------------
@admin_router.patch("/{report_id}", response_model=FeedbackAdmin)
def update_feedback(
    report_id: int,
    body: FeedbackAdminUpdate,
    db: Session = Depends(get_db),
    _admin: User = Depends(require_admin),
):
    if body.status is None and body.admin_notes is None:
        raise HTTPException(
            status_code=400,
            detail="At least one of status / adminNotes must be provided",
        )
    if body.status is not None and body.status not in FEEDBACK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")

    report = (
        db.query(FeedbackReport)
        .filter(FeedbackReport.id == report_id)
        .first()
    )
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")

    if body.status is not None:
        report.status = body.status
    if body.admin_notes is not None:
        report.admin_notes = body.admin_notes.strip() or None
    report.updated_at = utcnow_naive()
    db.commit()
    db.refresh(report)
    return FeedbackAdmin.model_validate(report.to_admin_dict())
