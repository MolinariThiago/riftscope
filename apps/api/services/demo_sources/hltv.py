"""
HLTV /results source — BeautifulSoup scrape.

Rewrote from fragile regex to DOM traversal with ``BeautifulSoup`` +
``lxml``. The regexes broke every time HLTV tweaked CSS classes or
attribute order — producing 0 matches silently. BS4's ``find`` / ``select``
are structurally stable because they match on the DOM tree, not on raw
HTML character sequences.

Why this exists:
- HLTV's ``/results`` page only lists matches that have ALREADY been
  played, every row has a real score, and every match page links straight
  to the demo download.
- The moment a row lands in ``pro_matches`` from this source, it's
  eligible for auto-import.

Proxy strategy: goes through the Webshare proxy pool so HLTV's Cloudflare
edge doesn't rate-limit the sync calls.
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
HLTV_TIMEOUT = 30.0

# Lazy-import BS4 + pick the best available parser backend. lxml is
# preferred (faster, more lenient about malformed HTML) but the stdlib
# ``html.parser`` is a fine fallback when lxml isn't available — e.g.
# in test harnesses or stripped-down dev environments.
_bs4_imported = False
BeautifulSoup = None  # type: ignore[assignment]
_BS4_PARSER = "html.parser"  # safe default


def _ensure_bs4():
    global _bs4_imported, BeautifulSoup, _BS4_PARSER
    if _bs4_imported:
        return
    from bs4 import BeautifulSoup as _BS  # type: ignore
    BeautifulSoup = _BS
    # Probe for lxml. If it's installed, use it (faster); otherwise
    # fall back to html.parser silently.
    try:
        import lxml  # type: ignore # noqa: F401
        _BS4_PARSER = "lxml"
    except ImportError:
        logger.warning("lxml not available — falling back to html.parser")
        _BS4_PARSER = "html.parser"
    _bs4_imported = True


class HltvSource:
    """List recently-played CS2 matches by scraping HLTV /results."""

    name = "hltv"
    legitimacy = "polite-scrape"
    enabled_by_default = True

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

        # Quick diagnostic — same as before, lets us see Cloudflare
        # challenge pages vs real HLTV content in logs.
        title = ""
        m = re.search(r"<title[^>]*>([^<]+)</title>", html, re.IGNORECASE)
        if m:
            title = m.group(1).strip()[:120]
        result_con_count = html.lower().count("result-con")
        logger.info(
            "HLTV /results: %d chars, title=%r, result-con probe=%d",
            len(html), title, result_con_count,
        )

        matches = list(self._parse(html))

        if not matches and result_con_count > 0:
            # DOM structure changed — log a sample for debugging.
            sample_start = html.lower().find("result-con")
            sample = html[max(0, sample_start - 40):sample_start + 600]
            logger.warning(
                "HLTV /results: parser found 0 matches but page DOES contain "
                "'result-con' — HTML layout drifted. Sample:\n%s",
                sample,
            )

        if since:
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
        return matches[:limit]

    async def download_demo(self, match: ExternalMatch) -> Path | None:
        return None

    # =========================================================================
    # Fetching
    # =========================================================================
    async def _fetch_results(self, *, limit: int) -> str:
        pool = get_proxy_pool()
        proxy = await pool.acquire() if pool.size > 0 else None
        proxies = {"http": proxy, "https": proxy} if proxy else None

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
    # Parsing — BeautifulSoup DOM traversal
    # =========================================================================
    def _parse(self, html: str):
        """Parse HLTV /results HTML into ExternalMatch objects.

        Strategy:
          1. Find all day headers ("Results for June 2nd 2026") to map
             sections to dates.
          2. Find all match anchors (<a href="/matches/<id>/<slug>">).
          3. For each anchor, walk UP to find the containing result row,
             then extract teams, scores, event, map, stars from the row's
             DOM subtree.

        This is structurally robust: we match on href patterns and walk
        the tree, not on CSS class names that HLTV changes every few
        months.
        """
        _ensure_bs4()
        soup = BeautifulSoup(html, _BS4_PARSER)

        # --- Day headers ---
        # HLTV wraps day headers in elements containing text like
        # "Results for June 2nd 2026". We search for any element whose
        # text matches this pattern.
        day_headers: list[tuple[int, datetime | None]] = []
        for el in soup.find_all(string=re.compile(r"Results for\s+", re.I)):
            parent = el.parent
            if parent is None:
                continue
            text = el.strip()
            m = re.search(
                r"Results for\s+([A-Z][a-z]+ \d{1,2}[a-z]{0,2}\s+\d{4})",
                text, re.IGNORECASE,
            )
            if m:
                dt = _parse_hltv_date(m.group(1))
                # Use the element's position in the HTML string as an
                # ordering key — sourcepos isn't available, but the
                # parent's index among siblings works for ordering.
                pos = html.find(text) if text else 0
                day_headers.append((pos, dt))

        def _date_for_pos(pos: int) -> datetime | None:
            chosen: datetime | None = None
            for off, dt in day_headers:
                if off <= pos:
                    chosen = dt
                else:
                    break
            return chosen

        # --- Match anchors ---
        # HLTV match links always have href="/matches/<id>/<slug>".
        # This pattern has been stable since 2017.
        match_link_re = re.compile(r"^/matches/(\d+)/")
        seen_ids: set[str] = set()

        for anchor in soup.find_all("a", href=match_link_re):
            href = anchor.get("href", "")
            id_match = match_link_re.match(href)
            if not id_match:
                continue
            hltv_id = id_match.group(1)
            if hltv_id in seen_ids:
                continue

            # The anchor wraps the entire result row on HLTV — all the
            # data we need is INSIDE it. This is the key insight: we
            # don't need to walk up, just search within anchor's children.
            row = anchor

            # --- Teams ---
            # HLTV renders team names in elements with class containing
            # "team". Multiple strategies, ordered by reliability:
            teams = _extract_teams(row)
            if len(teams) < 2:
                continue
            team_a, team_b = teams[0], teams[1]

            # --- Scores ---
            score_a, score_b = _extract_scores(row)

            # Sanity: HLTV /results shows SERIES scores; max is 5 (Bo9 5-4).
            if (score_a is not None and score_a > 5) or (
                score_b is not None and score_b > 5
            ):
                logger.warning(
                    "HLTV: suspicious series score %s:%s for match %s (%s vs %s)",
                    score_a, score_b, hltv_id, team_a, team_b,
                )

            # --- Event ---
            event_name = _extract_event(row)

            # --- Map ---
            map_name = _extract_map(row)

            # --- Stars → tier ---
            star_count = _extract_stars(row)
            tier = _stars_to_tier(star_count)

            # --- Team logos (from /team/<id>/ links) ---
            team_a_logo, team_b_logo = _extract_team_logos(row)

            # --- Date ---
            # Find this anchor's position in the original HTML to map
            # it to the correct day header.
            href_pos = html.find(href) if href else 0
            played_at = _date_for_pos(href_pos)

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
                demo_url=None,
                tier=tier,
                team_a_logo_url=team_a_logo,
                team_b_logo_url=team_b_logo,
            )


# =============================================================================
# DOM extraction helpers
# =============================================================================
# Each helper uses MULTIPLE fallback strategies so we survive HLTV's
# periodic CSS class renames. The strategies are ordered from most
# specific (class-based, fast) to most general (structural, slower but
# nearly impossible to break).


def _extract_teams(row) -> list[str]:
    """Extract the two team names from a result row.

    Strategy 1: elements with class containing 'team' that hold text.
    Strategy 2: divs/spans inside the row whose text looks like a team
                name (not a number, not empty, not a map name).
    """
    teams: list[str] = []

    # Strategy 1: class-based (covers 95% of HLTV layouts)
    for el in row.find_all(class_=re.compile(r"\bteam\b", re.I)):
        text = el.get_text(strip=True)
        if text and text not in teams and not text.isdigit():
            teams.append(_clean(text))
        if len(teams) >= 2:
            return teams

    # Strategy 2: look for elements that have a /team/<id>/ link nearby
    # and contain text that isn't a number or CSS noise.
    if len(teams) < 2:
        for link in row.find_all("a", href=re.compile(r"/team/\d+")):
            # The team name is usually the text content of the link or
            # a child element.
            text = link.get_text(strip=True)
            if text and text not in teams and not text.isdigit() and len(text) > 1:
                teams.append(_clean(text))
            if len(teams) >= 2:
                return teams

    return teams


def _extract_scores(row) -> tuple[int | None, int | None]:
    """Extract the series score from a HLTV /results row.

    HLTV /results always shows the SERIES score (e.g. ``2 - 1`` for a
    Bo3, ``3 - 2`` for a Bo5, ``1 - 0`` for a Bo1) — never per-map
    scores. Plausible range is **0-5** (covers Bo5 finals at most).

    Strategy 1: ``result-score`` container with ``score-won/lost/tied``
                children — HLTV's canonical layout.
    Strategy 2: any ``score-won/lost/tied`` elements anywhere in the row.
    Strategy 3: text fallback, restricted to single-digit numbers that
                aren't stars (1-5) or rankings. Conservative — only
                returns a value when we find exactly TWO plausible
                numbers separated by `-` or `:`.
    """
    # Plausible series scores: 0..5 (max series length is Bo9 = 5-4).
    MAX_PLAUSIBLE = 5

    # Strategy 1: result-score container
    score_container = row.find(class_=re.compile(r"\bresult-score\b", re.I))
    if score_container:
        digits = []
        for el in score_container.find_all(
            class_=re.compile(r"\bscore-(won|lost|tied)\b", re.I)
        ):
            text = el.get_text(strip=True)
            if text.isdigit() and int(text) <= MAX_PLAUSIBLE:
                digits.append(int(text))
        if len(digits) >= 2:
            return digits[0], digits[1]

    # Strategy 2: any score-won/lost/tied element
    digits = []
    for el in row.find_all(class_=re.compile(r"\bscore-(won|lost|tied)\b", re.I)):
        text = el.get_text(strip=True)
        if text.isdigit() and int(text) <= MAX_PLAUSIBLE:
            digits.append(int(text))
    if len(digits) >= 2:
        return digits[0], digits[1]

    # Strategy 3: text fallback — look for "N - M" or "N:M" pattern
    # explicitly, restricted to single digits 0-5. We DON'T accept just
    # any two numbers because every row has stars (1-5), team rankings
    # (1-30+), and various other digits that pollute the pool.
    all_text = row.get_text(" ", strip=True)
    m = re.search(r"\b([0-5])\s*[-:–]\s*([0-5])\b", all_text)
    if m:
        return int(m.group(1)), int(m.group(2))

    return None, None


def _extract_event(row) -> str | None:
    """Extract the event/tournament name."""
    # Strategy 1: class-based
    el = row.find(class_=re.compile(r"\bevent-name\b", re.I))
    if el:
        return _clean(el.get_text(strip=True)) or None

    # Strategy 2: img with title/alt containing event info
    for img in row.find_all("img"):
        title = img.get("title") or img.get("alt") or ""
        if title and "event" not in title.lower():
            # Check if this looks like an event logo (usually in
            # a container with 'event' in a parent's class)
            parent = img.parent
            while parent and parent != row:
                cls = " ".join(parent.get("class", []))
                if "event" in cls.lower():
                    return _clean(title) or None
                parent = parent.parent

    return None


def _extract_map(row) -> str | None:
    """Extract the map name (de_mirage, de_dust2, etc.)."""
    # Strategy 1: class-based
    el = row.find(class_=re.compile(r"\bmap\b", re.I))
    if el:
        text = el.get_text(strip=True).lower()
        if re.match(r"^(de_)?[a-z0-9_]+$", text):
            return text

    # Strategy 2: search all text for a known CS2 map pattern
    cs2_maps = {
        "mirage", "inferno", "ancient", "dust2", "nuke",
        "overpass", "train", "vertigo", "anubis",
    }
    all_text = row.get_text(" ", strip=True).lower()
    for map_short in cs2_maps:
        # Match both "de_mirage" and just "Mirage"
        if f"de_{map_short}" in all_text:
            return f"de_{map_short}"
    for map_short in cs2_maps:
        # Looser: just the name
        if map_short in all_text:
            return f"de_{map_short}"

    return None


def _extract_stars(row) -> int:
    """Count importance stars (0-5)."""
    # Strategy 1: container with 'stars' class, count <i> with 'star' class
    stars_el = row.find(class_=re.compile(r"\bstars\b", re.I))
    if stars_el:
        return len(stars_el.find_all("i", class_=re.compile(r"\bstar\b", re.I)))

    # Strategy 2: count any <i> with 'star' in class directly under the row
    stars = row.find_all("i", class_=re.compile(r"\bstar\b", re.I))
    return len(stars)


def _extract_team_logos(row) -> tuple[str | None, str | None]:
    """Extract team logo URLs from /team/<id>/ links."""
    team_link_re = re.compile(r"/team/(\d+)/")
    ids: list[str] = []
    for link in row.find_all("a", href=team_link_re):
        m = team_link_re.search(link.get("href", ""))
        if m and m.group(1) not in ids:
            ids.append(m.group(1))
        if len(ids) >= 2:
            break

    logo_a = f"https://img-cdn.hltv.org/teamlogo/{ids[0]}.svg" if len(ids) >= 1 else None
    logo_b = f"https://img-cdn.hltv.org/teamlogo/{ids[1]}.svg" if len(ids) >= 2 else None
    return logo_a, logo_b


# =============================================================================
# Helpers
# =============================================================================
_SUFFIX_RE = re.compile(r"(\d+)(st|nd|rd|th)\b", re.IGNORECASE)


def _clean(s: str | None) -> str:
    if not s:
        return ""
    return (
        s.replace("&amp;", "&")
        .replace("&#039;", "'")
        .replace("&quot;", '"')
        .replace("&nbsp;", " ")
        .strip()
    )


def _stars_to_tier(stars: int) -> str | None:
    """Map HLTV's 0-5 importance stars into RIFTSCOPE's tier vocabulary.

        5 -> S+   (IEM Major, BLAST Premier finals)
        4 -> S    (Tier-1 regular, ESL Pro League finals)
        3 -> A    (Tier-1 regional, big qualifiers)
        2 -> B    (Online cups, smaller LANs)
        0-1 -> C  (Scrims, FPL-C, low-stakes qualifiers)
    """
    if stars >= 5:
        return "S+"
    if stars == 4:
        return "S"
    if stars == 3:
        return "A"
    if stars == 2:
        return "B"
    if stars in (0, 1):
        return "C"
    return None


def _parse_hltv_date(s: str) -> datetime | None:
    """``June 2nd 2026`` / ``January 15 2025`` → naive-UTC datetime, midnight."""
    if not s:
        return None
    cleaned = _SUFFIX_RE.sub(r"\1", s).strip()
    for fmt in ("%B %d %Y", "%b %d %Y"):
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.replace(tzinfo=timezone.utc).astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            continue
    return None
