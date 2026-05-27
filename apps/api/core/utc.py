"""
Timezone-aware UTC helpers.

``datetime.utcnow()`` is deprecated in Python 3.12 and slated for removal
in 3.14 — every call site that needs "right now in UTC" now goes through
this helper so the codebase has a single migration point and a single
TZ convention.

The DB schema uses plain ``DateTime`` (no ``timezone=True``) columns so
we strip ``tzinfo`` before handing the value to SQLAlchemy.  That keeps
inserts byte-compatible with existing rows — no Alembic migration needed.
"""

from __future__ import annotations

from datetime import datetime, timezone


def utcnow_naive() -> datetime:
    """Return the current UTC moment as a *naive* :class:`~datetime.datetime`.

    Drop-in replacement for the old ``datetime.utcnow()`` calls.  Use this
    everywhere instead of constructing UTC times by hand — both for
    SQLAlchemy column ``default=`` callables and for imperative
    ``foo.updated_at = ...`` assignments.
    """
    return datetime.now(timezone.utc).replace(tzinfo=None)
