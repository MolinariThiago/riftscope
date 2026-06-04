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
        # Log a one-shot diagnostic about the page so a zero-match parse
        # is debuggable WITHOUT shipping a new build: page size, how many
        # ``result-con`` divs the cheap probe sees (signals "HTML changed"
        # vs "HTML wasn't HLTV at all"), and the title tag, which makes a
        # Cloudflare challenge / "Just a moment..." page obvious.
        title = ""
        m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if m:
            title = m.group(1).strip()[:120]
        result_con_count = len(re.findall(r"result-con", html, re.IGNORECASE))
        logger.info(
            "HLTV /results: %d chars, title=%r, result-con probe matches=%d",
            len(html), title, result_con_count,
        )
        matches = list(self._parse(html))
        if not matches and result_con_count > 0:
            # Layout drift — the rough probe sees rows but the structured
            # regex doesn't. Surface a sample so we can adjust the regex
            # without having to scrape from a dev machine.
            sample_start = html.lower().find("result-con")
            sample = html[max(0, sample_start - 40):sample_start + 600]
            logger.warning(
                "HLTV /results: parser found 0 matches but page DOES contain "
                "'result-con' — HTML layout drifted. Sample around first hit:\n%s",
                sample,
            )
        if since:
            # The scheduler passes ``since`` as tz-aware UTC (from
            # ``get_pro_cutoff``), but HLTV day headers parse to NAIVE
            # datetimes (they only carry a date, no timezone). Comparing
            # the two directly raises TypeError. Strip the tz from both
            # ends so we compare on a single representation, then filter.
            since_naive = (
                since.astimezone(timezone.utc).replace(tzinfo=None)
                if since.tzinfo is not None
                else since
            )
            matches = [
                m for m in matches
                if m.played_at is None or m.played_at >= since_naive
            ]
        logger.info(
            "HLTV /results: %d matches after parse + since filter (since=%s)",
            len(matches), since,
        )
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
    # Looser row regex than the strict one I started with — turns out
    # HLTV's prod HTML has ``class="result-con"`` mixed with other
    # tokens (``"result-con something"`` or ``"something result-con"``)
    # and the ``<a>`` sometimes carries data-* / aria-* attributes
    # before ``href``. The strict regex rejected those rows, leaving
    # ``last_sync_result.inserted = 0`` even when the page DID contain
    # results. Use ``\b`` word boundary on result-con and a non-greedy
    # gap before href.
    #
    # Match strategy is two-phase: a CHEAP anchor regex finds every
    # ``<a href="/matches/N/slug">`` whose URL pattern is HLTV's match
    # detail page (very stable). For each anchor we walk back ~600 chars
    # and forward ~3 kB into the page to grab the row body, then run the
    # cell-level regexes on that.
    _RE_MATCH_ANCHOR = re.compile(
        r'<a[^>]+href="(/matches/(\d+)/[^"]+)"',
        re.IGNORECASE,
    )
    # Cell-level regexes — match the actual class names HLTV uses,
    # tolerant to attribute order and extra classes.
    _RE_TEAMS = re.compile(
        r'class="[^"]*\bteam\b[^"]*"[^>]*>([^<]+)<',
        re.IGNORECASE,
    )
    _RE_SCORE = re.compile(
        r'class="[^"]*\bscore-(?:won|lost|tied)\b[^"]*"[^>]*>\s*(\d+)\s*<',
        re.IGNORECASE,
    )
    _RE_EVENT = re.compile(
        r'class="[^"]*\bevent-name\b[^"]*"[^>]*>([^<]+)<',
        re.IGNORECASE,
    )
    _RE_MAP = re.compile(
        r'class="[^"]*\bmap-text\b[^"]*"[^>]*>\s*([a-z0-9_]+)\s*<',
        re.IGNORECASE,
    )

    # Hard ceiling on the per-match window. Within that cap, the actual
    # window for match N stops where match N+1's anchor starts so the
    # cell-level regexes can't accidentally pick up the NEXT row's team
    # name (we hit this exact bug during development — the second match's
    # lookback covered the first match's body, so both rows ended up with
    # the same teams). HLTV row bodies are < 3 kB; 5 kB is comfortable.
    _ROW_MAX = 5000

    def _parse(self, html: str):
        # First map out the "Results for ..." headers so we can attach the
        # right played_at to each row. We capture (offset, date) pairs and
        # then assign every anchor's date by binary-walking the list.
        headers = [
            (m.start(), _parse_hltv_date(m.group(1)))
            for m in self._RE_DAY_HEADER.finditer(html)
        ]

        def date_for(pos: int) -> datetime | None:
            # Last header whose offset is <= pos.
            chosen: datetime | None = None
            for off, dt in headers:
                if off <= pos:
                    chosen = dt
                else:
                    break
            return chosen

        # Pre-collect anchors so each row's window can stop at the next
        # one — that's the cheapest way to guarantee row bodies don't
        # bleed into each other.
        anchors = list(self._RE_MATCH_ANCHOR.finditer(html))
        seen_ids: set[str] = set()
        for i, anchor in enumerate(anchors):
            hltv_id = anchor.group(2)
            if hltv_id in seen_ids:
                # HLTV often renders the same match twice (e.g. in the
                # "live" rail + the results list). Keep only the first.
                continue
            href = anchor.group(1)
            start = anchor.start()
            # Window starts at the anchor (the row's HTML follows it
            # because the entire row sits INSIDE the <a>) and ends at
            # the next anchor (or hard cap).
            window_end = start + self._ROW_MAX
            if i + 1 < len(anchors):
                window_end = min(window_end, anchors[i + 1].start())
            window = html[start:window_end]

            teams = [t for t in (_clean(x) for x in self._RE_TEAMS.findall(window)) if t]
            if len(teams) < 2:
                continue
            # The "team" class shows up on multiple elements (avatar +
            # name etc). Pick the first two distinct non-empty names that
            # appear, which on every HLTV row are the two teams in order.
            uniq: list[str] = []
            for t in teams:
                if not uniq or t != uniq[-1]:
                    uniq.append(t)
                if len(uniq) >= 2:
                    break
            if len(uniq) < 2:
                continue
            team_a, team_b = uniq[0], uniq[1]

            scores = self._RE_SCORE.findall(window)
            score_a = int(scores[0]) if len(scores) >= 1 else None
            score_b = int(scores[1]) if len(scores) >= 2 else None

            event_match = self._RE_EVENT.search(window)
            event_name = _clean(event_match.group(1)) if event_match else None

            map_match = self._RE_MAP.search(window)
            map_name = _clean(map_match.group(1)) if map_match else None

            played_at = date_for(start)
            seen_ids.add(hltv_id)

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
