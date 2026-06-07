"""Demo source registry.

HLTV-only — Liquipedia was dropped because every match it surfaced was
also covered by HLTV (with better metadata: real scores, star-based
tier, team logos) and Liquipedia's "future/live" rows polluted the
queue with rows that never had a demo. The ``liquipedia.py`` module is
kept in the tree as a reference for re-enabling later if needed but is
NOT imported here.
"""

from __future__ import annotations

from services.demo_sources.base import DemoSource, ExternalMatch
from services.demo_sources.hltv import HltvSource


def get_sources() -> list[DemoSource]:
    """Return the active list of demo sources, in priority order."""
    return [HltvSource()]


__all__ = [
    "DemoSource",
    "ExternalMatch",
    "HltvSource",
    "get_sources",
]
