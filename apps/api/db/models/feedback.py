"""
User feedback / bug reports.

Powers the floating widget in the bottom-right of the dashboard and the
admin queue at /admin → Feedback. Rows are append-only from the user's
side; admins move them through the lifecycle:

    open -> reviewing -> resolved
                     `-> dismissed

Notes for future-me:
- Identity is the logged-in ``user_id``. The widget only renders for
  authenticated users (anonymous reports were ruled out to keep spam
  off the queue), so ``user_id`` is NOT NULL.
- ``page_url`` / ``user_agent`` / ``demo_id`` are captured at submit time
  on the client side and saved verbatim — they're the bug-repro
  metadata, NOT user-supplied search keys. Don't trust them for
  authorization decisions.
- ``admin_notes`` is operator-only and never exposed to the reporter.
"""

from __future__ import annotations

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import relationship

from core.utc import utcnow_naive
from db.database import Base


# Vocabulary lives in the Python layer so adding a category later is just
# a code change — the DB column is plain VARCHAR.
FEEDBACK_CATEGORIES = ("bug", "demo_issue", "idea", "suggestion", "question")
FEEDBACK_STATUSES = ("open", "reviewing", "resolved", "dismissed")


class FeedbackReport(Base):
    __tablename__ = "feedback_reports"

    id = Column(Integer, primary_key=True, index=True)

    # Who reported. Users.id is a UUID string (see models/user.py).
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    # What kind of feedback. One of FEEDBACK_CATEGORIES.
    category = Column(String, nullable=False, index=True)

    # Free-text payload. Subject is optional ("just a quick note"); body
    # is required and capped client-side at 1500 chars. Stored as TEXT
    # so Postgres + SQLite agree on unlimited length.
    subject = Column(String, nullable=True)
    body = Column(Text, nullable=False)

    # Lifecycle. open is the initial state; admins move it forward.
    status = Column(
        String, default="open", nullable=False, index=True,
    )

    # Auto-captured context so the admin can reproduce bugs without
    # going back to the reporter. None of these are user-typed.
    page_url = Column(String, nullable=True)        # e.g. /demo/12/replay
    user_agent = Column(String, nullable=True)
    demo_id = Column(                                # null unless watching a demo
        Integer,
        ForeignKey("demos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Operator-only triage scratchpad. Never returned to the reporter.
    admin_notes = Column(Text, nullable=True)

    # Timestamps. ``updated_at`` is bumped by the admin endpoint when
    # status / notes change so the queue can be sorted by activity.
    created_at = Column(
        DateTime, default=utcnow_naive, nullable=False, index=True,
    )
    updated_at = Column(
        DateTime, default=utcnow_naive, nullable=False,
    )

    # Inverse side of the FK so admins can render the reporter inline.
    user = relationship("User", lazy="joined")

    def __repr__(self) -> str:  # pragma: no cover — debug helper
        return (
            f"<FeedbackReport id={self.id} cat={self.category} "
            f"status={self.status} user={self.user_id}>"
        )

    def to_admin_dict(self) -> dict:
        """Admin-facing serialisation. Includes the reporter's nick + Steam
        identity so the queue is browsable without a second query."""
        u = self.user
        return {
            "id": self.id,
            "category": self.category,
            "subject": self.subject,
            "body": self.body,
            "status": self.status,
            "pageUrl": self.page_url,
            "userAgent": self.user_agent,
            "demoId": self.demo_id,
            "adminNotes": self.admin_notes,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "updatedAt": self.updated_at.isoformat() if self.updated_at else None,
            "reporter": {
                "id": u.id if u else None,
                "nick": (u.username or u.steam_realname) if u else None,
                "steamId": u.steam_id if u else None,
                "avatarUrl": u.avatar_url if u else None,
            } if u else None,
        }
