"""
Backfill the real PER-TEAM final score for demos parsed before the
team_rounds_total fix.

The old parser stored the per-SIDE round tally (score_ct/score_tt), which is
wrong after the halftime swap (e.g. "12-3"). This reads the game's own
scoreboard (team_rounds_total) straight from the .dem, groups it by clan, and
writes score_a / score_b (mapped to demos.team_a_name / team_b_name) — no full
re-parse needed. Idempotent.

Run from apps/api:  ./.venv/Scripts/python.exe scripts/backfill_scores.py
"""

from __future__ import annotations

import os
import sqlite3
import sys
import time

from demoparser2 import DemoParser

HERE = os.path.dirname(os.path.abspath(__file__))
API = os.path.dirname(HERE)
UPLOADS = os.path.join(API, "storage", "uploads")
DB = os.path.join(API, "riftscope.db")


def score_by_clan(path: str) -> dict[str, int]:
    p = DemoParser(path)
    df = p.parse_ticks(["team_clan_name", "team_rounds_total"])
    last = df["tick"].max()
    sub = df[df["tick"] == last][["team_clan_name", "team_rounds_total"]]
    out: dict[str, int] = {}
    for _, r in sub.iterrows():
        clan = r.get("team_clan_name")
        if clan is None:
            continue
        clan = str(clan).strip()
        if not clan or clan.lower() == "nan":
            continue
        try:
            won = int(r.get("team_rounds_total"))
        except (TypeError, ValueError):
            continue
        out[clan] = max(out.get(clan, 0), won)
    return out


def main() -> None:
    con = sqlite3.connect(DB, timeout=30)
    rows = con.execute(
        "SELECT id, storage_filename, team_a_name, team_b_name, map_name "
        "FROM demos WHERE status='completed' ORDER BY id"
    ).fetchall()
    print(f"backfilling scores for {len(rows)} demos\n")
    for did, sf, ta, tb, mp in rows:
        t0 = time.time()
        path = os.path.join(UPLOADS, sf)
        if not os.path.exists(path):
            print(f"demo {did} [{mp}]: .dem missing, skipping")
            continue
        sbc = score_by_clan(path)
        sa = sbc.get(ta)
        sb = sbc.get(tb)
        if sa is None or sb is None:
            print(f"demo {did} [{mp}]: score not found (teamA={ta!r} teamB={tb!r}, got {sbc})")
            continue
        con.execute("UPDATE demos SET score_a=?, score_b=? WHERE id=?", (sa, sb, did))
        con.commit()
        print(f"demo {did} [{mp}]: {ta} {sa} - {sb} {tb}  ({time.time()-t0:.1f}s)")
    con.close()
    print("\ndone.")


if __name__ == "__main__":
    main()
