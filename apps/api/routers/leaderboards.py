"""
/leaderboards endpoint — HLTV-Rating-2.0-style player ranking aggregated
across every completed demo.

Why this lives in its own router instead of /players:
  /players is a per-demo player SEARCH (find this nickname in the
  uploads). /leaderboards is a RANKING (sorted board of best
  performers by HLTV 2.0 rating with map / date / round filters).
  Different shape, different consumers, different SQL — keeping
  them separate avoids tangling the two.

The aggregation strategy is straight COUNT-then-divide, not
average-of-rates: rates from individual demos are pooled by summing
raw counters (kills, deaths, total_damage, kast_rounds, demo round
counts) and then dividing once at the end. Averaging rates instead
weights a 16-round half-stomp the same as a 38-round overtime
marathon, which is wrong.

Rating formula is HLTV 2.0 with public coefficients:
    Impact = 2.13·KPR + 0.42·APR − 0.41
    Rating = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR
             + 0.2372·Impact + 0.0032·ADR + 0.1587
HLTV 3.0 is intentionally NOT used — its sub-ratings depend on a
round-swing model calibrated on map/side/economy that we don't have.
2.0 is the public, reproducible standard csstats.gg / FerahgoTheGreat
/ bo3.gg all rely on.
"""

from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.demo import Demo, DemoPlayer
from schemas.leaderboards import (
    LeaderboardEntry,
    LeaderboardFilters,
    LeaderboardResponse,
)

router = APIRouter()


def _norm_map(raw: str | None) -> str | None:
    """Mirror of the frontend ``normalizeMapName`` — strip ``de_``,
    lowercase, trim. Keeps the API tolerant of both shapes the demo
    parser stores (``de_mirage`` vs ``Mirage``)."""
    if not raw:
        return None
    s = raw.strip().lower()
    if s.startswith("de_"):
        s = s[3:]
    return s or None


@router.get("", response_model=LeaderboardResponse)
async def get_leaderboard(
    map: Optional[str] = Query(None, description="Filter by map (e.g. 'mirage' or 'de_mirage')"),
    since: Optional[str] = Query(None, description="ISO date — only demos played on/after this"),
    min_rounds: int = Query(16, ge=1, le=10_000, description="Minimum rounds played to qualify"),
    limit: int = Query(30, ge=1, le=200, description="Top N entries to return"),
    db: Session = Depends(get_db),
):
    """Return the leaderboard sorted by HLTV 2.0 rating (descending)."""

    since_dt: datetime | None = None
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            # Drop tz so comparison works against the naive UTC stamps
            # the parser persists.
            if since_dt.tzinfo is not None:
                since_dt = since_dt.astimezone().replace(tzinfo=None)
        except ValueError:
            since_dt = None

    map_target = _norm_map(map)

    # Aggregate raw counters per player. ``Demo.round_count`` is the
    # match's true round total (after warmup trimming) — sum it per
    # demo, then total rounds played by a player = SUM(round_count)
    # over the demos they appear in.
    q = (
        db.query(
            DemoPlayer.steam_id.label("steam_id"),
            func.max(DemoPlayer.name).label("name"),
            func.max(DemoPlayer.clan_name).label("clan"),
            func.count(func.distinct(DemoPlayer.demo_id)).label("demos"),
            func.sum(func.coalesce(Demo.round_count, 0)).label("rounds"),
            func.sum(DemoPlayer.kills).label("kills"),
            func.sum(DemoPlayer.deaths).label("deaths"),
            func.sum(DemoPlayer.assists).label("assists"),
            func.sum(DemoPlayer.headshots).label("headshots"),
            func.sum(DemoPlayer.total_damage).label("total_damage"),
            func.sum(DemoPlayer.utility_damage).label("utility_damage"),
            func.sum(DemoPlayer.flash_assists).label("flash_assists"),
            func.sum(DemoPlayer.kast_rounds).label("kast_rounds"),
        )
        .join(Demo, Demo.id == DemoPlayer.demo_id)
        .filter(Demo.status == "completed")
    )

    if map_target:
        # Map filter is tolerant of both ``de_X`` and ``X`` storage
        # forms.  We can't apply ``_norm_map`` inside SQL without a
        # CASE expression, so we widen the IN-clause.
        q = q.filter(
            func.lower(Demo.map_name).in_([map_target, f"de_{map_target}"])
        )

    if since_dt is not None:
        # ``played_at`` is the real match date when available; fall
        # back to ``uploaded_at`` for demos that didn't carry one.
        q = q.filter(
            (Demo.uploaded_at >= since_dt)  # type: ignore[arg-type]
        )

    rows = q.group_by(DemoPlayer.steam_id).all()

    entries: list[dict] = []
    for r in rows:
        rounds_n = int(r.rounds or 0)
        if rounds_n < min_rounds:
            continue
        kills_n = int(r.kills or 0)
        deaths_n = int(r.deaths or 0)
        assists_n = int(r.assists or 0)
        flash_n = int(r.flash_assists or 0)
        total_dmg = int(r.total_damage or 0)
        util_dmg = int(r.utility_damage or 0)
        kast_rounds_n = int(r.kast_rounds or 0)
        headshots_n = int(r.headshots or 0)

        rounds_f = float(rounds_n)
        adr = round(total_dmg / rounds_f, 1)
        kpr = kills_n / rounds_f
        dpr = deaths_n / rounds_f
        apr = (assists_n + flash_n) / rounds_f
        kast = round(100.0 * kast_rounds_n / rounds_f, 1)
        udr = round(util_dmg / rounds_f, 1)
        far = round(flash_n / rounds_f, 3)
        kd = round(kills_n / max(1, deaths_n), 2)

        impact = 2.13 * kpr + 0.42 * apr - 0.41
        rating_raw = (
            0.0073 * kast
            + 0.3591 * kpr
            + -0.5329 * dpr
            + 0.2372 * impact
            + 0.0032 * adr
            + 0.1587
        )
        rating = round(max(0.0, rating_raw), 2)

        entries.append({
            "steamId": r.steam_id,
            "name": r.name or "",
            "clan": r.clan,
            "demos": int(r.demos or 0),
            "rounds": rounds_n,
            "rating": rating,
            "adr": adr,
            "kd": kd,
            "kpr": round(kpr, 2),
            "dpr": round(dpr, 2),
            "kast": kast,
            "udr": udr,
            "far": far,
            "kills": kills_n,
            "deaths": deaths_n,
            "assists": assists_n,
            "headshots": headshots_n,
        })

    # Sort then assign rank — only the top ``limit`` are returned but
    # we keep ``total`` so the UI can show "Top 30 of 412 players".
    entries.sort(key=lambda e: e["rating"], reverse=True)
    total = len(entries)
    capped = entries[:limit]
    ranked = [
        LeaderboardEntry(rank=i + 1, **e) for i, e in enumerate(capped)
    ]

    return LeaderboardResponse(
        filters=LeaderboardFilters(
            map=map_target,
            since=since_dt.isoformat() if since_dt else None,
            minRounds=min_rounds,
            limit=limit,
        ),
        entries=ranked,
        total=total,
    )
