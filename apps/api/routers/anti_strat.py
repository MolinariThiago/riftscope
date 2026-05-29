"""
/anti-strat endpoints — opponent scouting from auto-detected round tactics.

Reads :class:`db.models.round_tactic.RoundTactic` rows (one classified
T-side play per round, produced at parse time by
:func:`services.anti_strat.detect_round_tactics`) and aggregates them per
team → map → (site, type) so the frontend can show "every execute / default
/ fake team X runs, where, when, and how often it works".

Ownership: like every other data endpoint, results are scoped to demos the
caller owns; admins see everything.
"""

from __future__ import annotations

from collections import defaultdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import Session

from db.database import get_db
from db.models.demo import Demo, DemoPlayer
from db.models.round_tactic import RoundTactic
from db.models.user import User
from routers.deps import get_current_user
from schemas.anti_strat import (
    MapReport,
    MapStrength,
    PlayerStat,
    PlayGroup,
    PlayRound,
    PreMatchReport,
    SignaturePlay,
    TeamReport,
    TeamSummary,
)

router = APIRouter()

# Timing heatmap: 10 s buckets, 0-10 … 50-60, then 60+ (7 buckets total).
TIMING_BUCKETS = 7
BUCKET_SIZE = 10.0


def _scoped(db: Session, user: User):
    """RoundTactic query joined to Demo and scoped to the caller's demos."""
    q = db.query(RoundTactic).join(Demo, Demo.id == RoundTactic.demo_id)
    if not user.is_admin:
        q = q.filter(Demo.user_id == user.id)
    return q


def _exec_time(rt: RoundTactic) -> Optional[float]:
    """When the play 'lands' in the round: plant time, else first utility."""
    if rt.plant_time is not None:
        return rt.plant_time
    sig = rt.util_signature or []
    ts = [s.get("t") for s in sig if isinstance(s, dict) and s.get("t") is not None]
    return min(ts) if ts else None


@router.get("/teams", response_model=list[TeamSummary])
def list_teams(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Teams we have scouting data for, ranked by rounds analyzed."""
    rows = _scoped(db, current_user).filter(RoundTactic.team_name.isnot(None)).all()

    agg: dict[str, dict] = defaultdict(lambda: {"demos": set(), "rounds": 0, "maps": set()})
    for r in rows:
        a = agg[r.team_name]
        a["demos"].add(r.demo_id)
        a["rounds"] += 1
        if r.map_name:
            a["maps"].add(r.map_name)

    out = [
        TeamSummary(name=name, demos=len(a["demos"]), rounds=a["rounds"], maps=sorted(a["maps"]))
        for name, a in agg.items()
    ]
    out.sort(key=lambda s: s.rounds, reverse=True)
    return out


@router.get("/report", response_model=TeamReport)
def team_report(
    team: str = Query(..., min_length=1),
    map: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Full scouting breakdown for one team (optionally a single map)."""
    q = _scoped(db, current_user).filter(RoundTactic.team_name == team)
    if map:
        q = q.filter(RoundTactic.map_name == map)
    rows = q.all()
    if not rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No scouting data for that team",
        )

    # map -> {rounds, plays{(site,type): [RoundTactic]}}
    maps: dict[str, dict] = defaultdict(lambda: {"rounds": 0, "plays": defaultdict(list)})
    for r in rows:
        m = maps[r.map_name or "unknown"]
        m["rounds"] += 1
        m["plays"][(r.site, r.type)].append(r)

    map_reports: list[MapReport] = []
    for map_name, md in maps.items():
        plays: list[PlayGroup] = []
        for (site, type_), group in md["plays"].items():
            count = len(group)
            wins = sum(1 for g in group if g.won)
            plant_times = [g.plant_time for g in group if g.plant_time is not None]
            avg_plant = round(sum(plant_times) / len(plant_times), 1) if plant_times else None

            timing = [0] * TIMING_BUCKETS
            for g in group:
                et = _exec_time(g)
                if et is not None:
                    b = min(TIMING_BUCKETS - 1, max(0, int(et // BUCKET_SIZE)))
                    timing[b] += 1

            rounds = sorted(
                (
                    PlayRound(
                        demo_id=g.demo_id,
                        round_number=g.round_number,
                        won=g.won,
                        plant_time=g.plant_time,
                    )
                    for g in group
                ),
                key=lambda pr: (pr.demo_id, pr.round_number),
            )
            plays.append(
                PlayGroup(
                    site=site,
                    type=type_,
                    count=count,
                    wins=wins,
                    win_rate=round(wins / count, 3) if count else 0.0,
                    avg_plant_time=avg_plant,
                    timing=timing,
                    rounds=rounds,
                )
            )
        plays.sort(key=lambda p: p.count, reverse=True)
        map_reports.append(MapReport(map=map_name, rounds=md["rounds"], plays=plays))

    map_reports.sort(key=lambda mr: mr.rounds, reverse=True)
    return TeamReport(team=team, total_rounds=len(rows), maps=map_reports)


# ==========================================================================
# Phase 2 — Vetos (map strengths)
# ==========================================================================


def _scoped_demos(db: Session, user: User):
    """Demo query scoped to the caller (admins see all, incl. orphans)."""
    q = db.query(Demo)
    if not user.is_admin:
        q = q.filter(Demo.user_id == user.id)
    return q


def _team_side(is_team_a: bool, half: int) -> str:
    """Side the team was on in a given round.

    team_a started CT, team_b started T. Odd halves keep the starting
    orientation; even halves swap.
    """
    if is_team_a:
        return "ct" if half % 2 == 1 else "tt"
    return "tt" if half % 2 == 1 else "ct"


def _map_strengths(demos: list[Demo], team: str) -> list[MapStrength]:
    agg: dict[str, dict] = {}
    for d in demos:
        if not d.map_name:
            continue
        is_a = d.team_a_name == team
        a = agg.setdefault(
            d.map_name,
            {"played": 0, "wins": 0, "rw": 0, "rp": 0, "ctw": 0, "ctp": 0, "tw": 0, "tp": 0},
        )
        won_rounds = lost_rounds = 0
        for r in d.rounds:
            side = _team_side(is_a, int(r.half or 1))
            won = r.winner == side
            a["rp"] += 1
            if side == "ct":
                a["ctp"] += 1
                if won:
                    a["ctw"] += 1
            else:
                a["tp"] += 1
                if won:
                    a["tw"] += 1
            if won:
                a["rw"] += 1
                won_rounds += 1
            else:
                lost_rounds += 1
        a["played"] += 1
        if won_rounds > lost_rounds:
            a["wins"] += 1

    out = [
        MapStrength(
            map=mp,
            played=a["played"],
            wins=a["wins"],
            win_rate=round(a["wins"] / a["played"], 3) if a["played"] else 0.0,
            rounds_won=a["rw"],
            rounds_played=a["rp"],
            ct_round_win_rate=round(a["ctw"] / a["ctp"], 3) if a["ctp"] else None,
            t_round_win_rate=round(a["tw"] / a["tp"], 3) if a["tp"] else None,
        )
        for mp, a in agg.items()
    ]
    out.sort(key=lambda m: (m.played, m.rounds_played), reverse=True)
    return out


@router.get("/maps", response_model=list[MapStrength])
def map_strengths(
    team: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-map strengths for a team (win rate + CT/T round splits)."""
    demos = (
        _scoped_demos(db, current_user)
        .filter(or_(Demo.team_a_name == team, Demo.team_b_name == team))
        .all()
    )
    if not demos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No demos for that team"
        )
    return _map_strengths(demos, team)


# ==========================================================================
# Phase 3 — Pre-match dashboard (aggregates everything for one opponent)
# ==========================================================================


def _team_players(db: Session, user: User, team: str) -> list[PlayerStat]:
    q = (
        db.query(DemoPlayer)
        .join(Demo, Demo.id == DemoPlayer.demo_id)
        .filter(DemoPlayer.clan_name == team)
    )
    if not user.is_admin:
        q = q.filter(Demo.user_id == user.id)

    by_sid: dict[str, dict] = {}
    for p in q.all():
        s = by_sid.setdefault(
            p.steam_id,
            {"name": p.name, "demos": 0, "rating": 0.0, "adr": 0.0, "kast": 0, "ok": 0},
        )
        s["name"] = p.name  # latest name wins
        s["demos"] += 1
        s["rating"] += p.rating or 0.0
        s["adr"] += p.adr or 0.0
        s["kast"] += p.kast or 0
        s["ok"] += p.opening_kills or 0

    out = []
    for sid, s in by_sid.items():
        n = s["demos"] or 1
        out.append(
            PlayerStat(
                name=s["name"],
                steam_id=sid,
                demos=s["demos"],
                rating=round(s["rating"] / n, 2),
                adr=round(s["adr"] / n, 1),
                kast=round(s["kast"] / n),
                opening_kills=s["ok"],
            )
        )
    out.sort(key=lambda p: p.rating, reverse=True)
    return out


def _signature_plays(db: Session, user: User, team: str) -> list[SignaturePlay]:
    rows = _scoped(db, user).filter(RoundTactic.team_name == team).all()
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r.map_name or "?", r.site, r.type)
        g = groups.setdefault(key, {"count": 0, "wins": 0})
        g["count"] += 1
        if r.won:
            g["wins"] += 1
    out = [
        SignaturePlay(
            map=k[0],
            site=k[1],
            type=k[2],
            count=g["count"],
            win_rate=round(g["wins"] / g["count"], 3) if g["count"] else 0.0,
        )
        for k, g in groups.items()
    ]
    # Only meaningful, repeated plays — drop one-offs and pure defaults.
    out = [s for s in out if s.count >= 2 and s.type != "default"]
    out.sort(key=lambda s: s.count, reverse=True)
    return out[:8]


@router.get("/pre-match", response_model=PreMatchReport)
def pre_match(
    team: str = Query(..., min_length=1),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Everything we know about one opponent, in a single payload."""
    demos = (
        _scoped_demos(db, current_user)
        .filter(or_(Demo.team_a_name == team, Demo.team_b_name == team))
        .all()
    )
    if not demos:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="No demos for that team"
        )
    classified = _scoped(db, current_user).filter(RoundTactic.team_name == team).count()
    return PreMatchReport(
        team=team,
        demos=len(demos),
        total_rounds=classified,
        maps=_map_strengths(demos, team),
        players=_team_players(db, current_user, team),
        signature_plays=_signature_plays(db, current_user, team),
    )
