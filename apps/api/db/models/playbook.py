"""
Playbook SQLAlchemy model — saved tactical-board scenarios.

A Playbook is a user-authored tactic on a specific map: a cast of
entities (players + utilities) plus an ordered list of frames ("steps")
that record where every entity sits and which vector annotations are
drawn. The whole authored document lives in the ``data`` JSON column —
the relational columns (``title`` / ``map_name`` / ``side``) are denormalized
copies kept on the row so the library list can render without parsing the
blob.

Ownership mirrors :class:`Demo`: playbooks are PRIVATE to their owner and
scoped by ``user_id`` in every router query.
"""

from __future__ import annotations

from sqlalchemy import Column, DateTime, ForeignKey, Integer, JSON, String

from core.utc import utcnow_naive
from db.database import Base


class Playbook(Base):
    __tablename__ = "playbooks"

    id = Column(Integer, primary_key=True, index=True)

    # Owner — required. Cascade-delete with the user account.
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # When set, the playbook is shared with this team (members can edit).
    # NULL = private to the owner. SET NULL on team delete so it reverts
    # to a personal playbook rather than disappearing.
    team_id = Column(
        Integer,
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    # Denormalized header fields (also present inside ``data``) so the
    # library list query doesn't need to deserialize the JSON blob.
    title = Column(String, nullable=False, default="Untitled tactic")
    map_name = Column(String, nullable=False, default="de_mirage", index=True)
    side = Column(String, nullable=True)  # "ct" | "tt" | None
    # Situation category: execute | retake | default | eco | pistol | anti-eco | None
    type = Column(String, nullable=True, index=True)
    # Free-form labels for filtering, stored as a JSON list of strings.
    tags = Column(JSON, nullable=True, default=list)

    # Organization: which folder this item lives in. NULL = loose (root).
    folder_id = Column(
        Integer,
        ForeignKey("playbook_folders.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    # "tactic" = hand-drawn board document (opens in /tactics);
    # "round"  = a saved demo round (plays in the real 2D replay viewer).
    kind = Column(String, nullable=False, default="tactic", index=True)
    # For kind="round": the demo + round to jump to in the replay. demo_id
    # SET NULL on demo delete so the entry survives (UI disables replay).
    demo_id = Column(
        Integer,
        ForeignKey("demos.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    round_number = Column(Integer, nullable=True)

    # The authored board document { entities, frames } — only for
    # kind="tactic". NULL/empty for kind="round" (those just reference
    # demo_id + round_number).
    data = Column(JSON, nullable=True, default=dict)

    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(
        DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False
    )


class PlaybookFolder(Base):
    """A named folder grouping Playbook items (rounds + tactics)."""

    __tablename__ = "playbook_folders"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(
        String,
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    # Shared with a team when set (members see it); NULL = personal.
    team_id = Column(
        Integer,
        ForeignKey("teams.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    name = Column(String, nullable=False, default="Untitled folder")

    created_at = Column(DateTime, default=utcnow_naive, nullable=False)
    updated_at = Column(
        DateTime, default=utcnow_naive, onupdate=utcnow_naive, nullable=False
    )
