"""
Anti-strat detection — auto-classify each round's T-side play from the
parsed analysis blob.

This is the engine behind the "Playbook" scouting tool. For every round
it labels the attacking team's play as **execute / default / fake**, the
target **site**, the **plant time**, and a compact **utility signature**
(which nades landed near which site, and when). It's intentionally
heuristic and tunable — not ground truth.

Inputs are the dicts produced by ``RealDemoParser.parse``:
- ``analysis["meta"]``  → teamA (started CT), teamB (started T), map
- ``analysis["rounds"]`` → per round: number, half, winner, bombSite, bombPlanted
- ``analysis["timeline"]["rounds"][str(n)]["events"]`` → grenade_thrown
  ({subtype, team, x, y, detonatedAt}) + bomb_planted ({site, t})
"""

from __future__ import annotations

import logging
from typing import Any, Optional

logger = logging.getLogger("riftscope.anti_strat")

# Utility that lands within this many seconds of round start counts toward
# the "commit" to a site (an execute is a coordinated early util dump).
EARLY_WINDOW_S = 25.0
# Minimum early nades on one site to call it a deliberate commit.
MIN_COMMIT = 2


def _nearest_site(
    x: float,
    y: float,
    sa: Optional[tuple[float, float]],
    sb: Optional[tuple[float, float]],
) -> Optional[str]:
    if sa is None and sb is None:
        return None
    if sa is None:
        return "B"
    if sb is None:
        return "A"
    da = (x - sa[0]) ** 2 + (y - sa[1]) ** 2
    db = (x - sb[0]) ** 2 + (y - sb[1]) ** 2
    return "A" if da <= db else "B"


def _site_coords(map_name: str):
    try:
        from services.maps import get_map

        m = get_map(map_name)
        if m is None:
            return None, None
        sa = tuple(m.site_a) if getattr(m, "site_a", None) else None
        sb = tuple(m.site_b) if getattr(m, "site_b", None) else None
        return sa, sb
    except Exception as exc:  # pragma: no cover — defensive
        logger.debug("site coords lookup failed for %s: %s", map_name, exc)
        return None, None


def detect_round_tactics(analysis: dict[str, Any], map_name: str) -> list[dict[str, Any]]:
    """Return one play dict per round for the attacking (T) team."""
    meta = analysis.get("meta") or {}
    team_a = meta.get("teamA")  # clan that STARTED on CT
    team_b = meta.get("teamB")  # clan that STARTED on T
    rounds = analysis.get("rounds") or []
    timeline = (analysis.get("timeline") or {}).get("rounds") or {}
    sa, sb = _site_coords(map_name)

    out: list[dict[str, Any]] = []
    for r in rounds:
        rnum = r.get("number")
        if rnum is None:
            continue
        half = int(r.get("half", 1) or 1)
        # Odd halves keep the starting orientation (A=CT, B=T); even halves
        # swap. So the T team alternates each half.
        t_team = team_b if (half % 2 == 1) else team_a
        # Grenade events are tagged with each player's FIRST-HALF side
        # (the parser reads it from ``players_meta``, which is frozen at
        # half 1). So the attacking team's nades read "tt" only in odd
        # halves; in even halves they read "ct" (that team's half-1 side).
        # Matching a literal "tt" would silently pick the DEFENDERS' util
        # for the whole second half — invert the label per half instead.
        attacker_label = "tt" if (half % 2 == 1) else "ct"

        tl = timeline.get(str(rnum)) or {}
        events = tl.get("events") or []
        # The per-round timeline may include freeze time at the front, so
        # event timestamps are measured from the timeline start, not the
        # live round. ``playStartT`` marks where play actually begins; we
        # rebase every timestamp onto it so "seconds into the round" means
        # the same thing on every demo. Without this, demos parsed with
        # freeze included (playStartT≈20) push all early utility past the
        # commit window and every round degrades to "default". Demos parsed
        # without it have playStartT≈0, so this is a no-op there.
        play_start = float(tl.get("playStartT") or 0.0)

        plant_site = r.get("bombSite")
        planted = bool(r.get("bombPlanted")) or bool(plant_site)
        plant_time: Optional[float] = None
        site_util = {"A": 0, "B": 0}
        util_sig: list[dict[str, Any]] = []

        for e in events:
            et = e.get("type")
            if et == "bomb_planted":
                pt = e.get("t")
                if pt is not None:
                    plant_time = max(0.0, float(pt) - play_start)
                if not plant_site:
                    plant_site = e.get("site")
                continue
            if et != "grenade_thrown" or e.get("team") != attacker_label:
                continue
            sub = e.get("subtype")
            if sub not in ("smoke", "molotov", "flash"):
                continue
            raw_t = e.get("detonatedAt", e.get("t", 0.0)) or 0.0
            t = max(0.0, float(raw_t) - play_start)
            ns = _nearest_site(float(e.get("x", 0.0)), float(e.get("y", 0.0)), sa, sb)
            if ns:
                if t <= EARLY_WINDOW_S:
                    site_util[ns] += 1
                util_sig.append({"subtype": sub, "site": ns, "t": round(t, 1)})

        committed: Optional[str] = None
        if site_util["A"] or site_util["B"]:
            committed = "A" if site_util["A"] >= site_util["B"] else "B"
        committed_strong = committed is not None and site_util[committed] >= MIN_COMMIT

        if planted and plant_site:
            site = plant_site
            if committed_strong and committed != plant_site:
                kind = "fake"
            elif committed_strong:
                kind = "execute"
            else:
                kind = "default"
        else:
            site = committed
            kind = "execute" if committed_strong else "default"

        out.append({
            "round_number": int(rnum),
            "half": half,
            "team_name": t_team,
            "side": "tt",
            "site": site,
            "type": kind,
            "plant_time": float(plant_time) if plant_time is not None else None,
            "won": (r.get("winner") == "tt"),
            "util_signature": util_sig[:10],
        })
    return out
