"""
Schemas for the /leaderboards endpoint.

Mirrors the frontend ``types/leaderboards.ts`` shape so a single source
of truth describes the wire format. See ``routers/leaderboards.py`` for
the aggregation logic and ``services/demo_parser_real._build_players``
for where the underlying numbers come from.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel


class LeaderboardEntry(BaseModel):
    """One row of the leaderboard — a player aggregated across demos."""

    rank: int
    steamId: str
    name: str
    clan: Optional[str] = None
    demos: int
    rounds: int
    # Rating + per-round rates, all computed from the raw counts so
    # the values stay correct across multiple demos with different
    # round counts.
    rating: float
    adr: float
    kd: float
    kpr: float
    dpr: float
    kast: float
    udr: float
    far: float
    # Raw counters (useful for tooltips / debugging).
    kills: int
    deaths: int
    assists: int
    headshots: int


class LeaderboardFilters(BaseModel):
    """Echo back which filters were applied — handy for the UI."""

    map: Optional[str] = None
    since: Optional[str] = None
    minRounds: int
    limit: int


class LeaderboardResponse(BaseModel):
    filters: LeaderboardFilters
    entries: List[LeaderboardEntry]
    total: int
