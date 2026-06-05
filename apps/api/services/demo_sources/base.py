"""
Demo source abstraction.

Every external feed of pro / community demos implements this interface so
the ingestion worker stays provider-agnostic. Add a new source by dropping
a new file in this package and registering it in :func:`get_sources`.

Phase 3A.2 ships ``LiquipediaSource`` (official, CC BY-SA) plus a manual
URL importer. HLTV polite scraping and tournament partnership feeds are
deferred to later phases.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Literal, Protocol


SourceLegitimacy = Literal["official", "polite-scrape", "manual"]


@dataclass
class ExternalMatch:
    """Compact metadata about a pro / community match before we have the demo."""

    source: str
    source_match_id: str
    team_a: str
    team_b: str
    score_a: int | None
    score_b: int | None
    map: str | None
    event_name: str | None
    played_at: datetime | None
    demo_url: str | None
    # Competitive tier inferred by the source (one of S+/S/A/B/C, or None).
    # Sources that don't expose a tier signal leave this null and let the
    # operator filter manually. The HLTV source maps the page's 0-5 star
    # rating into this bucket so PRO_AUTO_TIERS gives meaningful results
    # without an event-name whitelist.
    tier: str | None = None

    # Team logo URLs. The HLTV source derives these from the team's
    # HLTV id (``https://img-cdn.hltv.org/teamlogo/<id>.svg``); other
    # sources can leave them null and the UI falls back to a text-only
    # display. Stored as plain URL strings; the frontend loads them
    # directly from HLTV's CDN (small SVGs, no proxy traffic).
    team_a_logo_url: str | None = None
    team_b_logo_url: str | None = None


class DemoSource(Protocol):
    name: str
    legitimacy: SourceLegitimacy
    enabled_by_default: bool

    async def list_recent_matches(self, since: datetime | None = None, limit: int = 50) -> list[ExternalMatch]:
        """Return matches discovered by this source. Cheap call, idempotent."""

    async def download_demo(self, match: ExternalMatch) -> Path | None:
        """Download the demo file. Returns local path or None if not available yet."""
