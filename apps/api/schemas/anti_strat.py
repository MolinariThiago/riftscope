"""
Pydantic v2 schemas for the Anti-strat scouting API.

The data is derived from :class:`db.models.round_tactic.RoundTactic` rows
(one auto-detected T-side play per round) and aggregated per team → map →
(site, type). Mirrors ``apps/web/types/anti-strat.ts``.

Field aliases are camelCase so the JSON matches the rest of the API.
"""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class TeamSummary(BaseModel):
    """One scoutable team for the selector."""

    name: str
    demos: int                       # distinct demos this team appears in
    rounds: int                      # T-side rounds we classified for them
    maps: list[str]

    model_config = ConfigDict(populate_by_name=True)


class PlayRound(BaseModel):
    """A single round backing a play group — links into the replay viewer."""

    demo_id: int = Field(..., alias="demoId")
    round_number: int = Field(..., alias="roundNumber")
    won: bool
    plant_time: Optional[float] = Field(None, alias="plantTime")

    model_config = ConfigDict(populate_by_name=True)


class PlayGroup(BaseModel):
    """Every round where the team ran the same (site, type) play."""

    site: Optional[str]              # "A" | "B" | None
    type: str                        # execute | default | fake
    count: int
    wins: int
    win_rate: float = Field(..., alias="winRate")
    avg_plant_time: Optional[float] = Field(None, alias="avgPlantTime")
    # Histogram of WHEN the play tends to land (execution time per round,
    # 10 s buckets: 0-10 … 50-60, 60+). Powers the timing heatmap.
    timing: list[int]
    rounds: list[PlayRound]

    model_config = ConfigDict(populate_by_name=True)


class MapReport(BaseModel):
    map: str
    rounds: int                      # T-side rounds on this map
    plays: list[PlayGroup]

    model_config = ConfigDict(populate_by_name=True)


class TeamReport(BaseModel):
    team: str
    total_rounds: int = Field(..., alias="totalRounds")
    maps: list[MapReport]

    model_config = ConfigDict(populate_by_name=True)


# --------------------------------------------------------------------------
# Phase 2 — Vetos (map strengths) + Phase 3 — Pre-match dashboard
# --------------------------------------------------------------------------


class MapStrength(BaseModel):
    """How a team performs on one map (from their demos)."""

    map: str
    played: int                      # demos on this map
    wins: int                        # demos won
    win_rate: float = Field(..., alias="winRate")
    rounds_won: int = Field(..., alias="roundsWon")
    rounds_played: int = Field(..., alias="roundsPlayed")
    # Round win rate split by the side the team was on (None if never on it).
    ct_round_win_rate: Optional[float] = Field(None, alias="ctRoundWinRate")
    t_round_win_rate: Optional[float] = Field(None, alias="tRoundWinRate")

    model_config = ConfigDict(populate_by_name=True)


class PlayerStat(BaseModel):
    """A team member, averaged across their demos."""

    name: str
    steam_id: str = Field(..., alias="steamId")
    demos: int
    rating: float
    adr: float
    kast: int
    opening_kills: int = Field(..., alias="openingKills")

    model_config = ConfigDict(populate_by_name=True)


class SignaturePlay(BaseModel):
    """A team's most-run plays (top round_tactics groups)."""

    map: str
    site: Optional[str]
    type: str
    count: int
    win_rate: float = Field(..., alias="winRate")

    model_config = ConfigDict(populate_by_name=True)


class PreMatchReport(BaseModel):
    team: str
    demos: int
    total_rounds: int = Field(..., alias="totalRounds")  # classified T-rounds
    maps: list[MapStrength]
    players: list[PlayerStat]
    signature_plays: list[SignaturePlay] = Field(..., alias="signaturePlays")

    model_config = ConfigDict(populate_by_name=True)
