"""
User SQLAlchemy model — auth + subscription state.

Identity is a server-generated UUIDv4 string so we never leak insertion
order across users (and Steam-linked accounts get a stable id even when
the same Steam profile re-registers).

The schema covers three responsibilities:

1. Auth — ``email`` + ``password_hash`` for email/password login, plus
   ``steam_id`` for Steam OpenID linking. Either may be ``NULL`` so an
   account can be Steam-only or email-only.
2. Subscription — ``subscription_tier`` / ``subscription_status`` are
   read by the admin dashboard and (eventually) by Stripe webhooks.
3. Admin flag — single boolean; the admin gate in :mod:`routers.deps`
   refuses to authenticate inactive accounts entirely.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String
from sqlalchemy.orm import relationship

from db.database import Base


def _uuid() -> str:
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    # Identity — UUIDv4 string. Stored as text so SQLite + Postgres
    # behave identically without needing a uuid-specific column type.
    id = Column(String, primary_key=True, default=_uuid, index=True)

    # Email login (optional; Steam-only accounts may leave it NULL).
    email = Column(String, unique=True, index=True, nullable=True)
    username = Column(String, nullable=True)
    password_hash = Column(String, nullable=True)

    # Steam linkage — 64-bit SteamID, stored as text. Indexed and
    # unique so the OpenID callback can look up the account in O(1).
    steam_id = Column(String, unique=True, index=True, nullable=True)
    avatar_url = Column(String, nullable=True)
    # Extra Steam Web API fields populated on every login. Profile URL
    # is the canonical ``steamcommunity.com`` page; realname / country
    # are optional (privacy-locked profiles return them empty). Stored
    # so /auth/me can surface them without re-hitting the Steam API on
    # every request — refreshed on the next login.
    steam_profile_url = Column(String, nullable=True)
    steam_realname = Column(String, nullable=True)
    steam_country = Column(String, nullable=True)
    # Player-supplied Steam Web API key — set via the "Integraciones"
    # section of the profile page. Used to fetch the player's match
    # history (so we can extract their demos automatically) without
    # the dev having to share a single global key. Stored as plain
    # text for now; promote to an encrypted column if we ever
    # multi-tenant this.
    steam_api_key = Column(String, nullable=True)

    # Role / state flags.
    is_admin = Column(Boolean, default=False, nullable=False, index=True)
    is_active = Column(Boolean, default=True, nullable=False, index=True)

    # Subscription. ``inactive`` is the canonical empty state — admins
    # bumping a user to PRO flip both fields atomically (see
    # ``routers/admin.py``).
    subscription_tier = Column(String, default="free", nullable=False)
    subscription_status = Column(String, default="inactive", nullable=False)
    stripe_customer_id = Column(String, nullable=True)
    stripe_subscription_id = Column(String, nullable=True)

    # Timestamps.
    created_at = Column(
        DateTime, default=datetime.utcnow, nullable=False, index=True
    )
    last_login = Column(DateTime, nullable=True)

    # Relationships — backref on Demo.user is the inverse side.
    demos = relationship(
        "Demo",
        back_populates="user",
        cascade="all, delete-orphan",
    )

    def __repr__(self) -> str:  # pragma: no cover — debug helper
        ident = self.email or self.steam_id or self.id
        return f"<User {ident} admin={self.is_admin} tier={self.subscription_tier}>"
