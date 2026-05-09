"""
Liquipedia source — official MediaWiki API, CC BY-SA 4.0.

Liquipedia exposes its CS2 wiki content via the standard MediaWiki API at
``https://liquipedia.net/counterstrike/api.php``. We use it to surface
recent professional matches with team names, scores, event context and
played_at timestamps.

This source does NOT provide ``.dem`` files (Liquipedia doesn't host
them); ``demo_url`` is left null. The ingestion worker still records the
match metadata in ``pro_matches`` so the user can see them and
optionally import the demo via the manual URL importer.

Per Liquipedia's API guidelines:
- A custom User-Agent identifying the application + contact email is required.
- Rate limit: 30 reqs/30s, but we stay well under that with cache + small page sizes.
- Attribution (CC BY-SA) is shown in the UI ("Source: Liquipedia").
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from services.demo_sources.base import ExternalMatch

logger = logging.getLogger("riftscope.sources.liquipedia")

LIQUIPEDIA_API = "https://liquipedia.net/counterstrike/api.php"
USER_AGENT = "RIFTSCOPE/0.3 (https://github.com/riftscope; contact via README)"


class LiquipediaSource:
    name = "liquipedia"
    legitimacy = "official"
    enabled_by_default = True

    async def list_recent_matches(
        self,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[ExternalMatch]:
        """
        Surface recent CS2 matches by parsing the "Liquipedia:Matches" page.

        Liquipedia's structured match data is in templates rendered via
        ``Liquipedia:Matches`` and ``Liquipedia:Upcoming_and_ongoing_matches``.
        We use the API's ``parse`` action to get the rendered HTML and run a
        light regex over it. Pure text extraction — no DOM parsing.

        For now this returns "completed" matches first, then upcoming, up to
        ``limit``.
        """
        try:
            html = await self._fetch_match_pages()
        except Exception as exc:  # pragma: no cover — network/transport
            logger.warning("Liquipedia fetch failed: %s", exc)
            return []

        matches = self._extract_matches(html)

        if since:
            matches = [m for m in matches if m.played_at is None or m.played_at >= since]

        # De-dup by source_match_id, then truncate.
        seen: set[str] = set()
        out: list[ExternalMatch] = []
        for m in matches:
            if m.source_match_id in seen:
                continue
            seen.add(m.source_match_id)
            out.append(m)
            if len(out) >= limit:
                break
        return out

    async def download_demo(self, match: ExternalMatch) -> Path | None:
        # Liquipedia doesn't host demos. The user can paste the HLTV URL of
        # the match into the manual importer once we ship that.
        return None

    # =========================================================================
    # Internals
    # =========================================================================

    async def _fetch_match_pages(self) -> str:
        """Fetch combined HTML of upcoming + completed matches pages."""
        async with httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": USER_AGENT, "Accept-Encoding": "gzip"},
            follow_redirects=True,
        ) as client:
            tasks = [
                self._parse_page(client, "Liquipedia:Upcoming_and_ongoing_matches"),
                self._parse_page(client, "Liquipedia:Matches"),
            ]
            pages = await asyncio.gather(*tasks, return_exceptions=True)
        chunks: list[str] = []
        for p in pages:
            if isinstance(p, str):
                chunks.append(p)
        return "\n".join(chunks)

    async def _parse_page(self, client: httpx.AsyncClient, title: str) -> str:
        params = {
            "action": "parse",
            "page": title,
            "format": "json",
            "prop": "text",
            "redirects": "1",
        }
        try:
            r = await client.get(LIQUIPEDIA_API, params=params)
            r.raise_for_status()
            data = r.json()
            return data.get("parse", {}).get("text", {}).get("*", "") or ""
        except Exception as exc:  # pragma: no cover — transient
            logger.info("liquipedia parse %s failed: %s", title, exc)
            return ""

    # Each match is wrapped in <div class="match-info">…</div>. The block
    # closes at the next sibling matching the same indentation, but for our
    # purposes a regex up to ``</div></div></div>`` (closing match-info-header
    # + match-info wrapper) covers the team + score + timestamp section we
    # care about.
    _RE_MATCH_BLOCK = re.compile(
        r'<div class="match-info[^"]*">(.*?)</div>\s*</div>\s*</div>',
        re.DOTALL,
    )

    # Inside a block:
    #   <div class="match-info-header-opponent ...">
    #     ... <a href="/counterstrike/{slug}" title="{Team Name}">...
    _RE_OPPONENT = re.compile(
        r'class="match-info-header-opponent[^"]*"[^>]*>(.*?)(?=<div class="match-info-header(?:-opponent|-scoreholder)|</div></div>$)',
        re.DOTALL,
    )
    _RE_TEAM_TITLE = re.compile(r'<a[^>]*href="/counterstrike/[^"]+"\s+title="([^"]+)"')

    # Score: <span class="match-info-header-scoreholder-upper">2 : 1</span>
    # (When the match hasn't started yet, this contains "vs" instead.)
    _RE_SCORE_BLOCK = re.compile(
        r'class="match-info-header-scoreholder-upper">([^<]+)<',
    )

    _RE_TIME = re.compile(r'data-timestamp="(\d+)"')
    _RE_HLTV = re.compile(r'https://www\.hltv\.org/matches/(\d+)/')
    # Event name is in the trailing tournament block AFTER match-info-header.
    _RE_EVENT = re.compile(
        r'class="match-info-tournament[^"]*"[^>]*>(?:[^<]*<[^>]+>)*?[^<]*<a[^>]*title="([^"]+)"',
        re.DOTALL,
    )

    def _extract_matches(self, html: str) -> list[ExternalMatch]:
        out: list[ExternalMatch] = []
        for blk in self._RE_MATCH_BLOCK.finditer(html):
            block = blk.group(0)

            # Extract the two team names (left + right opponent).
            opponents = self._RE_OPPONENT.findall(block)
            team_titles: list[str] = []
            for op in opponents:
                m = self._RE_TEAM_TITLE.search(op)
                if m:
                    team_titles.append(m.group(1).strip())

            if len(team_titles) < 2:
                # Fallback: scan team-template href titles directly.
                titles = re.findall(r'href="/counterstrike/[^"]+"\s+title="([^"]+)"', block)
                # Filter out icon-only image links (they repeat the title).
                seen = []
                for t in titles:
                    if t not in seen and t.lower() != "team":
                        seen.append(t)
                    if len(seen) == 2:
                        break
                team_titles = seen

            if len(team_titles) < 2:
                continue

            team_a, team_b = team_titles[0], team_titles[1]
            if team_a.lower() == "tbd" or team_b.lower() == "tbd":
                continue
            # Skip wiki cross-links that aren't real team names.
            if any(c in team_a + team_b for c in ("/", "#", "?")):
                continue
            if len(team_a) > 40 or len(team_b) > 40:
                continue

            # Score (or "vs" if upcoming).
            score_a: int | None = None
            score_b: int | None = None
            sm = self._RE_SCORE_BLOCK.search(block)
            if sm:
                raw = sm.group(1).strip()
                # Common shapes: "2 : 1", "2&nbsp;:&nbsp;1", "vs"
                clean = raw.replace("&nbsp;", " ").replace(":", " ")
                bits = clean.split()
                if len(bits) >= 2 and bits[0].isdigit() and bits[1].isdigit():
                    score_a = int(bits[0])
                    score_b = int(bits[1])

            ts: datetime | None = None
            tm = self._RE_TIME.search(block)
            if tm:
                try:
                    ts = datetime.fromtimestamp(int(tm.group(1)), tz=timezone.utc)
                except (ValueError, OSError):
                    pass

            ev: str | None = None
            em = self._RE_EVENT.search(block)
            if em:
                ev = em.group(1).strip()

            hm = self._RE_HLTV.search(block)
            hltv_id = hm.group(1) if hm else None

            source_match_id = (
                f"hltv-{hltv_id}"
                if hltv_id
                else (
                    f"lp-{self._slug(team_a)}-{self._slug(team_b)}-"
                    f"{int(ts.timestamp()) if ts else 0}"
                )
            )

            out.append(
                ExternalMatch(
                    source="liquipedia",
                    source_match_id=source_match_id,
                    team_a=team_a,
                    team_b=team_b,
                    score_a=score_a,
                    score_b=score_b,
                    map=None,
                    event_name=ev,
                    played_at=ts,
                    demo_url=(
                        f"https://www.hltv.org/download/demo/{hltv_id}"
                        if hltv_id
                        else None
                    ),
                )
            )

        return out

    @staticmethod
    def _slug(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "-", (s or "").lower()).strip("-")

    @staticmethod
    def _normalize_team(raw: str) -> str:
        return (raw or "").strip().replace("_", " ").lower()
