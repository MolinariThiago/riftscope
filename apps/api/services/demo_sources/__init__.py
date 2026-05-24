"""Demo source registry."""

from __future__ import annotations

from services.demo_sources.base import DemoSource, ExternalMatch
from services.demo_sources.liquipedia import LiquipediaSource


def get_sources() -> list[DemoSource]:
    """Return the active list of demo sources, in priority order."""
    return [LiquipediaSource()]


__all__ = ["DemoSource", "ExternalMatch", "LiquipediaSource", "get_sources"]
