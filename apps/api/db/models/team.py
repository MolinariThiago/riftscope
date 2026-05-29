"""
Team + membership models — playbook sharing.

A Team groups users so playbooks can be shared collaboratively (every
member can load + edit a team playbook). Membership is many-to-many via
:class:`TeamMember`. A short ``invite_code`` lets teammates join without
an explicit invite flow.

A :class:`Playbook` with ``team_id`` set is visible/editable by every
member of that team; with ``team_id`` NULL it stays private to its owner.
"""

from __future__ import annotations

import secrets

from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
)

from core.utc import utcnow_naive
from db.database import Base


def _invite_code() -> str:
    # 8 hex chars — short enough to share verbally, large enough to avoid collisions at our scale.
    return secrets.token_hex(4)


class Team(Base):
    __tablename__ = "teams"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False, default="My team")
    invite_code = Column(String, unique=True, index=True, default=_invite_code, nullable=False)
    owner_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at = Column(DateTime, default=utcnow_naive, nullable=False)


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_member"),)

    id = Column(Integer, primary_key=True, index=True)
    team_id = Column(
        Integer, ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id = Column(
        String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String, nullable=False, default="member")  # "owner" | "member"
    joined_at = Column(DateTime, default=utcnow_naive, nullable=False)
