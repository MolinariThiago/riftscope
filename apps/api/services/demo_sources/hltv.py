"""
HLTV /results source — direct scrape.

Why this exists:
- Liquipedia's matches page surfaces FUTURE / live matches too, none of
  which have a demo URL yet. The ingest pipeline downstream filters them
  out (score >= 2 is required), but they still clutter ``/pro`` and the
  user has to wait until the scheduler revisits each row to learn whether
  HLTV has a demo for it.
- HLTV's ``/results`` page is the opposite: it only lists matches that
  have ALREADY been played, every row has a real score, and every match
  page links straight to the demo download. So the moment a row lands in
  ``pro_matches`` from this source, it's eligible for auto-import.

This source goes through the same Webshare proxy pool we use for downloads
so HLTV's Cloudflare edge doesn't rate-limit the sync calls. Listing /
detail scraping reuses the same client config (``impersonate="chrome"``)
that already works for demo downloads in ``services.pro_import``.

We DO NOT fetch each match detail page from here — that would multiply
proxy traffic. ``demo_url`` is left None and the existing import worker
discovers it the first time it tries to download the match. That's the
same flow the manual upload path uses today.
"""

from __future__ import annotations

import asyncio
import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from curl_cffi import requests

from services.demo_sources.base import ExternalMatch
from services.hltv_proxy_pool import get_proxy_pool

logger = logging.getLogger("riftscope.sources.hltv")

HLTV_RESULTS_URL = "https://www.hltv.org/results"
# How long to wait on each HLTV /results request before giving up. Cloudflare
# can be slow to hand us the page, especially through a residential proxy,
# but anything past ~25s is almost certainly the IP being challenged.
HLTV_TIMEOUT = 30.0


class HltvSource:
    """List recently-played CS2 matches by scraping ``https://www.hltv.org/results``."""

    name = "hltv"
    legitimacy = "polite-scrape"
    enabled_by_default = True

    # Module-level cooldown so the public cooldown_remaining_seconds API
    # parallels Liquipedia's — the scheduler status endpoint surfaces this
    # in the UI when we get rate-limited hard.
    _next_call_at: float = 0.0

    @classmethod
    def cooldown_remaining_seconds(cls) -> float:
        try:
            now = asyncio.get_event_loop().time()
        except RuntimeError:
            return 0.0
        return max(0.0, cls._next_call_at - now)

    async def list_recent_matches(
        self,
        since: datetime | None = None,
        limit: int = 50,
    ) -> list[ExternalMatch]:
        html = await self._fetch_results(limit=limit)
        if not html:
            return []
        matches = list(self._parse(html))
        if since:
            matches = [
                m for m in matches if m.played_at is None or m.played_at >= since
            ]
        # Defensive truncate — HLTV's first page already gives us ~100 rows.
        return matches[:limit]

    async def download_demo(self, match: ExternalMatch) -> Path | None:
        # The existing import worker handles the download. We could
        # short-circuit by visiting the match page here, but that doubles
        # proxy traffic for the sync step and the import path already
        # does it on demand.
        return None

    # =========================================================================
    # Fetching
    # =========================================================================
    async def _fetch_results(self, *, limit: int) -> str:
        """Pull the HTML of ``/results`` through ONE proxy from the pool.

        We don't retry across IPs here — a transient block on the
        sync call isn't worth burning N residential IPs on. If the
        current pick is unhealthy, the pool's normal cooldown logic
        kicks in for the NEXT scheduler tick and we try a fresh IP
        15 min later.
        """
        pool = get_proxy_pool()
        proxy = await pool.acquire() if pool.size > 0 else None
        proxies = {"http": proxy, "https": proxy} if proxy else None

        # ``offset`` is HLTV's pagination knob — 100 results per page; we
        # request enough to cover the operator's ``limit``.
        url = HLTV_RESULTS_URL
        if limit > 100:
            url = f"{HLTV_RESULTS_URL}?offset=0"

        try:
            async with requests.AsyncSession(
                timeout=HLTV_TIMEOUT,
                impersonate="chrome",
                proxies=proxies,
            ) as client:
                r = await client.get(
                    url,
                    headers={"Referer": "https://www.hltv.org/"},
                )
                status = getattr(r, "status_code", None)
                if status and 200 <= status < 300:
                    if proxy:
                        await pool.report_success(proxy)
                    return r.text or ""
                if proxy and status in (403, 429, 503):
                    await pool.report_failure(proxy, f"HTTP {status}")
                logger.warning(
                    "HLTV /results returned %s — skipping this tick", status,
                )
                return ""
        except Exception as exc:
            if proxy:
                await pool.report_failure(proxy, type(exc).__name__)
            logger.warning("HLTV /results fetch failed: %s", exc)
            return ""

    # =========================================================================
    # Parsing
    # =========================================================================
    # HLTV uses a stable enough HTML structure for /results that a couple
    # of targeted regexes do the job and survive their occasional CSS
    # tweaks better than a full DOM walk would. Each result row sits
    # inside a ``<div class="result-con">`` and links to a
    # ``/matches/<id>/<slug>`` URL. The slug always contains
    # ``<teamA>-vs-<teamB>-<event>``. Day headers (``<span class="standard-
    # headline">Results for ...</span>``) tell us the played_at date for
    # everything that follows them.
    _RE_DAY_HEADER = re.compile(
        r'<span[^>]*class="[^"]*standard-headline[^"]*"[^>]*>\s*Results for\s+'
        r'([A-Z][a-z]+ \d{1,2}[a-z]{0,2}\s+\d{4})\s*</span>',
        re.IGNORECASE,
    )
    # One whole row.  We capture the inner HTML so a sub-regex can dig
    # into the cells. Non-greedy on the body so consecutive rows don't
    # collide.
    _RE_ROW = re.compile(
        r'<div\s+class="result-con[^"]*">\s*<a\s+[^>]*href="(/matches/\d+/[^"]+)"[^>]*>(.*?)</a>\s*</div>',
        re.IGNORECASE | re.DOTALL,
    )
    _RE_TEAMS = re.compile(
        r'<div class="team(?:\s+team-won|\s+team-lost)?">([^<]+)</div>',
        re.IGNORECASE,
    )
    _RE_SCORE = re.compile(
        r'<span\s+class="score-(?:won|lost|tied)">\s*(\d+)\s*</span>',
        re.IGNORECASE,
    )
    _RE_EVENT = re.compile(
        r'<span\s+class="event-name">([^<]+)</span>',
        re.IGNORECASE,
    )
    _RE_MAP = re.compile(
        r'<div\s+class="map-text">\s*([a-z0-9_]+)\s*</div>',
        re.IGNORECASE,
    )

    def _parse(self, html: str):
        # Walk the page in order. Each "Results for ..." header sets the
        # date for every row that follows it until the next header.
        # Splitting on the header keeps the chronological context.
        chunks = self._RE_DAY_HEADER.split(html)
        # split() with one capture group: [pre, date1, body1, date2, body2, ...]
        if len(chunks) <= 1:
            # No day header found — treat the whole page as "unknown date".
            yield from self._rows_in_chunk(chunks[0] if chunks else html, played_at=None)
            return
        # Skip the pre-amble; it contains nav / hero, never rows.
        i = 1
        while i + 1 < len(chunks):
            date_text = chunks[i]
            body = chunks[i + 1]
            played_at = _parse_hltv_date(date_text)
            yield from self._rows_in_chunk(body, played_at=played_at)
            i += 2

    def _rows_in_chunk(self, chunk: str, *, played_at: datetime | None):
        for row in self._RE_ROW.finditer(chunk):
            href = row.group(1)
            inner = row.group(2)

            teams = self._RE_TEAMS.findall(inner)
            if len(teams) < 2:
                continue
            team_a = _clean(teams[0])
            team_b = _clean(teams[1])
            if not team_a or not team_b:
                continue

            scores = self._RE_SCORE.findall(inner)
            score_a = int(scores[0]) if len(scores) >= 1 else None
            score_b = int(scores[1]) if len(scores) >= 2 else None

            event_match = self._RE_EVENT.search(inner)
            event_name = _clean(event_match.group(1)) if event_match else None

            map_match = self._RE_MAP.search(inner)
            map_name = _clean(map_match.group(1)) if map_match else None

            # Stable match id = HLTV's numeric id from the URL.
            id_match = re.search(r'/matches/(\d+)/', href)
            if not id_match:
                continue
            hltv_id = id_match.group(1)

            yield ExternalMatch(
                source=HltvSource.name,
                source_match_id=f"hltv-{hltv_id}",
                team_a=team_a,
                team_b=team_b,
                score_a=score_a,
                score_b=score_b,
                map=map_name,
                event_name=event_name,
                played_at=played_at,
                # Left None on purpose. The import worker visits the match
                # page when it actually goes to download, and that's when
                # it resolves the demo link. Doing it here would double
                # proxy traffic and force us to choose between truncated
                # sync runs and slow ones.
                demo_url=None,
            )


# =============================================================================
# Helpers
# =============================================================================
_SUFFIX_RE = re.compile(r"(\d+)(st|nd|rd|th)\b", re.IGNORECASE)


def _clean(s: str | None) -> str:
    if not s:
        return ""
    # Cheap HTML entity unescaping for the handful that show up in team
    # / event names. Avoids pulling in ``html`` for one call.
    return (
        s.replace("&amp;", "&")
        .replace("&#039;", "'")
        .replace("&quot;", '"')
        .replace("&nbsp;", " ")
        .strip()
    )


def _parse_hltv_date(s: str) -> datetime | None:
    """``June 2nd 2026`` / ``January 15 2025`` → naive-UTC datetime, midnight."""
    if not s:
        return None
    # Strip ordinal suffix: "2nd" -> "2".
    cleaned = _SUFFIX_RE.sub(r"\1", s).strip()
    for fmt in ("%B %d %Y", "%b %d %Y"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.replace(tzinfo=timezone.utc).astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            continue
    return None
