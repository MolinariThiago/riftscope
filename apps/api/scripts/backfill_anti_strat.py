"""
Backfill team identity + anti-strat round tactics for demos parsed BEFORE
Phase 0 (team identity) shipped.

Those demos already have the per-round timeline in ``analysis_data`` (enough
to classify plays) but no clan names. Re-parsing 300-600 MB demos just to
recover clan names is wasteful, so this reads ONLY the ``team_clan_name``
column straight from the .dem (a few seconds) and:

  1. resolves each player's clan, rebuilds teamA / teamB,
  2. writes ``demos.team_a_name/team_b_name`` + ``demo_players.clan_name``,
  3. runs ``detect_round_tactics`` and (re)persists ``round_tactics``.

``analysis_data`` itself is left untouched (the classifier only reads the
clan info in-memory) so we don't rewrite the multi-MB JSON blob per demo.

Run from apps/api:  ./.venv/Scripts/python.exe scripts/backfill_anti_strat.py
Idempotent — safe to run repeatedly.
"""

from __future__ import annotations

import json
import os
import sys
import time

# Allow ``import db...`` / ``import services...`` when run as a script.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from demoparser2 import DemoParser  # noqa: E402

from db.database import SessionLocal  # noqa: E402
# Import every model before touching the ORM so SQLAlchemy can resolve the
# cross-model relationships (Demo -> User, etc.) — same ordering main.py uses.
from db.models.user import User  # noqa: E402, F401
from db.models.demo import Demo, DemoKill, DemoPlayer, DemoRound  # noqa: E402, F401
from db.models.insight import DemoInsight  # noqa: E402, F401
from db.models.pro_match import ProMatch  # noqa: E402, F401
from db.models.playbook import Playbook  # noqa: E402, F401
from db.models.team import Team, TeamMember  # noqa: E402, F401
from db.models.round_tactic import RoundTactic  # noqa: E402
from services.anti_strat import detect_round_tactics  # noqa: E402

UPLOADS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "uploads")


def clan_by_steamid(dem_path: str) -> dict[str, str]:
    """First non-empty team_clan_name per steamid (constant across a match)."""
    parser = DemoParser(dem_path)
    df = parser.parse_ticks(["team_clan_name"])
    df = df.dropna(subset=["team_clan_name"])
    out: dict[str, str] = {}
    for sid, clan in zip(df["steamid"].astype(str), df["team_clan_name"].astype(str)):
        clan = clan.strip()
        if clan and clan.lower() != "nan" and sid not in out:
            out[sid] = clan
    return out


def mode_clan(players: list[dict], cbs: dict[str, str], side: str) -> str | None:
    """Most common clan among players whose FIRST-HALF side == ``side``."""
    counts: dict[str, int] = {}
    for pl in players:
        clan = cbs.get(str(pl.get("steamId")))
        if pl.get("team") == side and clan:
            counts[clan] = counts.get(clan, 0) + 1
    return max(counts, key=counts.get) if counts else None


def main() -> None:
    db = SessionLocal()
    try:
        demos = db.query(Demo).filter(Demo.status == "completed").order_by(Demo.id).all()
        print(f"backfilling {len(demos)} completed demos\n")
        for d in demos:
            t0 = time.time()
            analysis = d.analysis_data
            if isinstance(analysis, str):
                analysis = json.loads(analysis)
            if not analysis:
                print(f"demo {d.id}: no analysis_data, skipping")
                continue

            dem_path = os.path.join(UPLOADS, d.storage_filename)
            cbs = clan_by_steamid(dem_path) if os.path.exists(dem_path) else {}
            if not cbs:
                print(f"demo {d.id}: no clan names found (.dem missing or unnamed)")

            players = analysis.get("players", [])
            team_a = mode_clan(players, cbs, "ct")
            team_b = mode_clan(players, cbs, "tt")

            # Inject in-memory so the classifier sees team identity.
            analysis.setdefault("meta", {})["teamA"] = team_a
            analysis["meta"]["teamB"] = team_b
            for pl in players:
                pl["clan"] = cbs.get(str(pl.get("steamId")))

            # Persist columns (NOT the JSON blob).
            d.team_a_name = team_a
            d.team_b_name = team_b
            for dp in db.query(DemoPlayer).filter(DemoPlayer.demo_id == d.id).all():
                dp.clan_name = cbs.get(str(dp.steam_id))

            map_name = d.map_name or analysis.get("meta", {}).get("map")
            plays = detect_round_tactics(analysis, map_name)
            db.query(RoundTactic).filter(RoundTactic.demo_id == d.id).delete()
            for p in plays:
                db.add(RoundTactic(
                    demo_id=d.id,
                    round_number=p["round_number"],
                    half=p.get("half", 1),
                    team_name=p.get("team_name"),
                    map_name=map_name,
                    side=p.get("side", "tt"),
                    site=p.get("site"),
                    type=p.get("type", "default"),
                    plant_time=p.get("plant_time"),
                    won=p.get("won", False),
                    util_signature=p.get("util_signature"),
                ))
            db.commit()
            print(
                f"demo {d.id} [{map_name}]: A={team_a!r} B={team_b!r} "
                f"-> {len(plays)} tactics ({time.time() - t0:.1f}s)"
            )
        print("\nbackfill done.")
    finally:
        db.close()


if __name__ == "__main__":
    main()
