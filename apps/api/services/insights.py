"""
Insights engine — heuristics over real parsed demo data.

Inspired by Leetify / Breakdown.gg / cs2.cam analytical layers but built
on top of the structured output the parser already produces. Nothing here
is fake or randomly generated — every insight references a real round
number, kill, or economy snapshot from the demo.

Usage:

    from services.insights import compute_insights
    insights = compute_insights(analysis_data)
    # → {summary, rounds, players, heatmap}

The output shape is stable across demos so the frontend can render any
demo without checking which insights happen to exist.
"""

from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Iterable

logger = logging.getLogger("riftscope.insights")

ENGINE_VERSION = "1"

# Tunables (kept as module-level constants so the engine version captures them)
TRADE_WINDOW_S = 5.0          # back-to-back kill ≤ 5s = trade
FAST_PLANT_S = 25.0           # plant time < 25s into round = fast plant
ECO_VALUE_THRESHOLD = 5000    # team equipment value < $5k = eco
ANTI_ECO_VALUE_DELTA = 8000   # |opponent − us| > 8k & we're up = anti-eco
SAVE_LOWHP_THRESHOLD = 50     # finishing the round with <50 HP = save


def compute_insights(analysis: dict[str, Any]) -> dict[str, Any]:
    """Top-level entrypoint. Returns the structured insights payload."""

    rounds = analysis.get("rounds", []) or []
    kills = analysis.get("kills", []) or []
    economy = analysis.get("economy", []) or []
    players = analysis.get("players", []) or []
    timeline = analysis.get("timeline", {}) or {}

    # Build helper indices once.
    kills_by_round: dict[int, list[dict]] = defaultdict(list)
    for k in kills:
        kills_by_round[int(k.get("round") or 0)].append(k)
    for r in kills_by_round.values():
        r.sort(key=lambda k: k.get("tick", 0))

    economy_by_round: dict[int, dict] = {int(e["round"]): e for e in economy}

    player_by_sid: dict[str, dict] = {p["steamId"]: p for p in players}

    round_insights: list[dict[str, Any]] = []
    for r in rounds:
        rnum = int(r["number"])
        rk = kills_by_round.get(rnum, [])
        econ = economy_by_round.get(rnum, {})
        round_obj = {
            "round": rnum,
            "winner": r.get("winner"),
            "endReason": r.get("endReason"),
            "bombSite": r.get("bombSite"),
            "insights": list(_round_insights(r, rk, econ, player_by_sid, timeline)),
        }
        round_insights.append(round_obj)

    player_rollups = _player_rollups(players, kills, rounds)
    heatmap = _build_heatmap_grid(kills)
    summary = _summary(rounds, kills, round_insights, player_rollups)

    return {
        "engine_version": ENGINE_VERSION,
        "summary": summary,
        "rounds": round_insights,
        "players": player_rollups,
        "heatmap": heatmap,
    }


# ===========================================================================
# Round-level heuristics
# ===========================================================================


def _round_insights(
    r: dict,
    kills: list[dict],
    econ: dict,
    player_by_sid: dict[str, dict],
    timeline: dict,
) -> Iterable[dict]:
    rnum = int(r["number"])
    winner = r.get("winner")
    end_reason = r.get("endReason")

    # Opening duel
    if kills:
        first = kills[0]
        killer = player_by_sid.get(first.get("killer", ""))
        victim = player_by_sid.get(first.get("victim", ""))
        if killer and victim:
            yield {
                "kind": "opening_duel",
                "round": rnum,
                "team": killer.get("team"),
                "severity": "good" if killer.get("team") == winner else "bad",
                "title": f"Opening duel: {killer.get('name')}",
                "summary": (
                    f"{killer.get('name')} took the first kill on "
                    f"{victim.get('name')} with {first.get('weapon', '?')}"
                    f"{' (HS)' if first.get('headshot') else ''}."
                ),
                "evidence": {
                    "killer": killer.get("steamId"),
                    "victim": victim.get("steamId"),
                    "weapon": first.get("weapon"),
                    "headshot": bool(first.get("headshot")),
                    "tick": first.get("tick"),
                },
            }

    # Trade kills
    for i in range(1, len(kills)):
        prev, curr = kills[i - 1], kills[i]
        if prev.get("victim") and curr.get("victim"):
            tick_delta = abs(int(curr.get("tick", 0)) - int(prev.get("tick", 0)))
            # Quick approx: tick gap < ~5s × 64 tick = 320 ticks, or 640 on 128
            if tick_delta and tick_delta <= 320 * 2:
                killer_a = player_by_sid.get(prev.get("killer", ""))
                killer_b = player_by_sid.get(curr.get("killer", ""))
                if (
                    killer_a
                    and killer_b
                    and killer_a.get("team") != killer_b.get("team")
                    # Tradee is the previous killer (someone got back at them)
                    and curr.get("victim") == prev.get("killer")
                ):
                    yield {
                        "kind": "trade",
                        "round": rnum,
                        "team": killer_b.get("team"),
                        "severity": "info",
                        "title": f"Trade by {killer_b.get('name')}",
                        "summary": (
                            f"{killer_b.get('name')} traded "
                            f"{killer_a.get('name')} within {tick_delta} ticks."
                        ),
                        "evidence": {
                            "killer": killer_b.get("steamId"),
                            "tradee": killer_a.get("steamId"),
                            "tickDelta": tick_delta,
                        },
                    }

    # Fast plant — bomb planted in the first ~25s of round duration
    if r.get("bombPlanted"):
        rdata = (timeline.get("rounds") or {}).get(str(rnum), {})
        plant_ev = next(
            (e for e in (rdata.get("events") or []) if e.get("type") == "bomb_planted"),
            None,
        )
        if plant_ev and plant_ev.get("t", 999) < FAST_PLANT_S:
            yield {
                "kind": "fast_plant",
                "round": rnum,
                "team": "tt",
                "severity": "good",
                "title": f"Fast plant on {r.get('bombSite')}",
                "summary": (
                    f"T-side planted on {r.get('bombSite')} in "
                    f"{plant_ev['t']:.1f}s — execute pressure."
                ),
                "evidence": {
                    "site": r.get("bombSite"),
                    "plantSeconds": round(plant_ev["t"], 2),
                },
            }

    # Eco wins / anti-eco losses (purely from equipment values)
    ct_eq = int(r.get("ctEquipmentValue") or 0)
    tt_eq = int(r.get("ttEquipmentValue") or 0)
    if winner and (ct_eq or tt_eq):
        winner_eq = ct_eq if winner == "ct" else tt_eq
        loser_eq = tt_eq if winner == "ct" else ct_eq
        # Eco win — winner spent < threshold AND was significantly poorer
        if winner_eq < ECO_VALUE_THRESHOLD and loser_eq - winner_eq > 4000:
            yield {
                "kind": "eco_win",
                "round": rnum,
                "team": winner,
                "severity": "good",
                "title": f"Eco win for {winner.upper()}",
                "summary": (
                    f"{winner.upper()} won with ${winner_eq:,} equipment vs "
                    f"${loser_eq:,} on the other side."
                ),
                "evidence": {"winnerEq": winner_eq, "loserEq": loser_eq},
            }
        # Anti-eco loss — loser was overwhelmingly richer and still lost
        elif loser_eq < ECO_VALUE_THRESHOLD and winner_eq - loser_eq > ANTI_ECO_VALUE_DELTA:
            yield {
                "kind": "anti_eco_loss",
                "round": rnum,
                "team": "ct" if winner == "tt" else "tt",
                "severity": "bad",
                "title": "Anti-eco loss",
                "summary": (
                    f"Lost a full-buy round to a ${loser_eq:,} eco — "
                    f"reset their economy."
                ),
                "evidence": {"winnerEq": winner_eq, "loserEq": loser_eq},
            }

    # Round end-reason context
    if end_reason in {"defuse", "explode"}:
        yield {
            "kind": end_reason,
            "round": rnum,
            "team": winner,
            "severity": "good" if end_reason == "defuse" and winner == "ct" else "info",
            "title": f"Round won by {end_reason}",
            "summary": (
                f"{winner.upper()} closed the round on a "
                f"{'defuse' if end_reason == 'defuse' else 'bomb explode'}."
            ),
            "evidence": {"site": r.get("bombSite")},
        }


# ===========================================================================
# Per-player rollups
# ===========================================================================


def _player_rollups(
    players: list[dict], kills: list[dict], rounds: list[dict]
) -> list[dict]:
    by_sid: dict[str, dict] = {p["steamId"]: dict(p) for p in players}
    opening_kills: dict[str, int] = defaultdict(int)
    opening_deaths: dict[str, int] = defaultdict(int)
    trades: dict[str, int] = defaultdict(int)   # times this player traded a teammate
    traded: dict[str, int] = defaultdict(int)   # times this player got traded
    deaths_with_kit: dict[str, int] = defaultdict(int)

    # Opening duels
    by_round = defaultdict(list)
    for k in kills:
        by_round[int(k.get("round") or 0)].append(k)
    for rk in by_round.values():
        rk.sort(key=lambda k: k.get("tick", 0))
        if rk:
            first = rk[0]
            if first.get("killer"):
                opening_kills[first["killer"]] += 1
            if first.get("victim"):
                opening_deaths[first["victim"]] += 1

    # Trades (heuristic: same as round-level, accumulated per player)
    for rk in by_round.values():
        for i in range(1, len(rk)):
            prev, curr = rk[i - 1], rk[i]
            if curr.get("victim") and curr.get("victim") == prev.get("killer"):
                if curr.get("killer"):
                    trades[curr["killer"]] += 1
                if prev.get("killer"):
                    traded[prev["killer"]] += 1

    out = []
    for sid, p in by_sid.items():
        out.append({
            "steamId": sid,
            "name": p.get("name"),
            "team": p.get("team"),
            "kills": int(p.get("kills") or 0),
            "deaths": int(p.get("deaths") or 0),
            "assists": int(p.get("assists") or 0),
            "rating": float(p.get("rating") or 0.0),
            "adr": float(p.get("adr") or 0.0),
            "kast": int(p.get("kast") or 0),
            "openingKills": opening_kills[sid],
            "openingDeaths": opening_deaths[sid],
            "tradesMade": trades[sid],
            "timesTraded": traded[sid],
            "deathsWithKit": deaths_with_kit[sid],
        })
    out.sort(key=lambda r: r["rating"], reverse=True)
    return out


# ===========================================================================
# Heatmap (32×32 grid of kills/deaths)
# ===========================================================================


def _build_heatmap_grid(kills: list[dict]) -> dict[str, Any]:
    """Bucket kill positions into a 32×32 grid for fast frontend rendering."""
    GRID = 32
    if not kills:
        return {"grid": GRID, "cells": [], "max": 0}

    # World bounds — use kill coords' min/max to fit the actual play space.
    xs = []
    ys = []
    for k in kills:
        kp = k.get("killerPos") or [0, 0, 0]
        vp = k.get("victimPos") or [0, 0, 0]
        xs.extend([kp[0], vp[0]])
        ys.extend([kp[1], vp[1]])
    if not xs or not ys:
        return {"grid": GRID, "cells": [], "max": 0}

    xmin, xmax = min(xs), max(xs)
    ymin, ymax = min(ys), max(ys)
    xspan = max(1, xmax - xmin)
    yspan = max(1, ymax - ymin)

    cells: dict[tuple[int, int], dict[str, int]] = defaultdict(lambda: {"kill": 0, "death": 0})
    for k in kills:
        kp = k.get("killerPos") or [0, 0, 0]
        vp = k.get("victimPos") or [0, 0, 0]
        kx = min(GRID - 1, max(0, int((kp[0] - xmin) / xspan * GRID)))
        ky = min(GRID - 1, max(0, int((kp[1] - ymin) / yspan * GRID)))
        vx = min(GRID - 1, max(0, int((vp[0] - xmin) / xspan * GRID)))
        vy = min(GRID - 1, max(0, int((vp[1] - ymin) / yspan * GRID)))
        cells[(kx, ky)]["kill"] += 1
        cells[(vx, vy)]["death"] += 1

    cell_list = [
        {"x": gx, "y": gy, **counts}
        for (gx, gy), counts in cells.items()
    ]
    max_count = max(
        (max(c["kill"], c["death"]) for c in cell_list), default=0
    )
    return {
        "grid": GRID,
        "worldBounds": [xmin, ymin, xmax, ymax],
        "cells": cell_list,
        "max": max_count,
    }


# ===========================================================================
# Summary
# ===========================================================================


def _summary(
    rounds: list[dict],
    kills: list[dict],
    round_insights: list[dict],
    player_rollups: list[dict],
) -> dict[str, Any]:
    n_rounds = len(rounds)
    ct_wins = sum(1 for r in rounds if r.get("winner") == "ct")
    tt_wins = sum(1 for r in rounds if r.get("winner") == "tt")

    fast_plants = 0
    eco_wins = 0
    trade_count = 0
    opening_duels = 0
    for r in round_insights:
        for ins in r["insights"]:
            if ins["kind"] == "fast_plant":
                fast_plants += 1
            elif ins["kind"] == "eco_win":
                eco_wins += 1
            elif ins["kind"] == "trade":
                trade_count += 1
            elif ins["kind"] == "opening_duel":
                opening_duels += 1

    top_rating = player_rollups[0] if player_rollups else None

    return {
        "rounds": n_rounds,
        "ctWins": ct_wins,
        "ttWins": tt_wins,
        "totalKills": len(kills),
        "headshots": sum(1 for k in kills if k.get("headshot")),
        "fastPlants": fast_plants,
        "ecoWins": eco_wins,
        "tradeKills": trade_count,
        "openingDuels": opening_duels,
        "topPerformer": (
            {
                "name": top_rating["name"],
                "team": top_rating["team"],
                "rating": top_rating["rating"],
            }
            if top_rating
            else None
        ),
    }
