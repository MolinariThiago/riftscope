"""Demo source registry."""

from __future__ import annotations

from services.demo_sources.base import DemoSource, ExternalMatch
from services.demo_sources.hltv import HltvSource
from services.demo_sources.liquipedia import LiquipediaSource  # noqa: F401


def get_sources() -> list[DemoSource]:
    """Return the active list of demo sources, in priority order.

    Currently HLTV-only: scraping ``/results`` gives us ALREADY-played
    matches (real scores + a demo on the match page) so every row that
    lands in ``pro_matches`` is ready to import. Liquipedia returned a
    lot of "future / live" rows that just cluttered the feed until
    the importer rejected them downstream, so we dropped it from the
    default rotation. The class is still importable (see the noqa
    above) if we want to bring it back as a secondary source — it just
    isn't returned from here anymore.
    """
    return [HltvSource()]


__all__ = [
    "DemoSource",
    "ExternalMatch",
    "HltvSource",
    "LiquipediaSource",
    "get_sources",
]
