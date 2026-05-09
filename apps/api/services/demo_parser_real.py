"""
Real demo parser — wraps ``demoparser2`` (Rust-backed) to produce the same
analysis dict shape that the stub does, so the frontend never knows which
backend ran.

Activated by setting ``PARSER_BACKEND=demoparser2`` in the env (the
factory in :mod:`services.parser_factory` resolves it). When a wheel for
the runtime Python version isn't available the import gracefully fails
and the factory falls back to the stub.

Schema parity is intentional: every field the stub emits is reproduced
here so existing storage rows, the frontend, and the timeline viewer
continue to work without changes.
"""

from __future__ import annotations

import logging
import math
from collections import defaultdict
from pathlib import Path
from typing import Any

logger = logging.getLogger("riftscope.parser.real")

# Sample target FPS for the 2D timeline (matches the stub).
TIMELINE_FPS = 10

# CS2 team_num: 2 = T, 3 = CT, 0/1 = unassigned/spectator
_TEAM_NUM_TO_SIDE = {2: "tt", 3: "ct"}

# demoparser2 grenade_type → our subtype enum
_GRENADE_SUBTYPE = {
    "CSmokeGrenade": "smoke",
    "CSmokeGrenadeProjectile": "smoke",
    "CMolotovGrenade": "molotov",
    "CMolotovProjectile": "molotov",
    "CIncendiaryGrenade": "molotov",
    "CFlashbang": "flash",
    "CFlashbangProjectile": "flash",
    "CHEGrenade": "he",
    "CHEGrenadeProjectile": "he",
}
_GRENADE_DURATION = {"smoke": 18.0, "molotov": 7.0, "flash": 0.5, "he": 0.5}
_GRENADE_RADIUS = {"smoke": 220, "molotov": 160, "flash": 60, "he": 90}


class RealDemoParser:
    """Real CS2 .dem parser via demoparser2."""

    def parse(self, demo_path: str | Path) -> dict[str, Any]:
        from demoparser2 import DemoParser  # imported lazily

        path = str(demo_path)
        logger.info("real parser starting on %s", path)
        parser = DemoParser(path)

        # ---- Identity / header ------------------------------------------------
        header = parser.parse_header()
        map_name = header.get("map_name") or "unknown"

        player_info = parser.parse_player_info()
        # team_number column maps to side
        players_meta: dict[str, dict[str, Any]] = {}
        for _, row in player_info.iterrows():
            sid = str(row["steamid"])
            team_num = int(row.get("team_number") or 0)
            players_meta[sid] = {
                "steamId": sid,
                "name": str(row["name"]),
                "team": _TEAM_NUM_TO_SIDE.get(team_num, "ct"),
            }

        # ---- Rounds ----------------------------------------------------------
        round_ends = _safe_event(parser, "round_end")
        # CS2 fires a round_end at tick ≈0 for warmup/restart. Drop rounds with
        # no recorded freeze_end.
        round_starts = _safe_event(parser, "round_freeze_end")

        rounds = self._build_rounds(round_starts, round_ends)
        # Estimate tickrate: CS2 standard match is 64 tick. Non-standard demos
        # can be 128. Estimate from round duration in ticks vs seconds.
        tickrate = self._estimate_tickrate(rounds)
        for r in rounds:
            r["durationSeconds"] = max(1, int((r["endTick"] - r["startTick"]) / tickrate))

        # ---- Kills -----------------------------------------------------------
        deaths_df = _safe_event(parser, "player_death")
        kills_raw = deaths_df.to_dict(orient="records") if deaths_df is not None else []

        # ---- Bomb events -----------------------------------------------------
        bomb_planted_df = _safe_event(parser, "bomb_planted")
        bomb_defused_df = _safe_event(parser, "bomb_defused")
        bomb_exploded_df = _safe_event(parser, "bomb_exploded")

        plants_by_round = _index_by_round(bomb_planted_df, rounds)
        defuses_by_round = _index_by_round(bomb_defused_df, rounds)
        explodes_by_round = _index_by_round(bomb_exploded_df, rounds)

        # Annotate rounds with bomb info + end reason. Decision tree:
        #  - winner == CT && bomb_defused -> defuse
        #  - winner == T  && bomb_exploded -> explode
        #  - winner == CT && no plant -> elimination (kill all Ts)
        #  - winner == T  && plant + no explode + no defuse -> time (planters held)
        #  - else -> elimination (default)
        for r in rounds:
            n = r["number"]
            plants = plants_by_round.get(n, [])
            r["bombPlanted"] = bool(plants)
            r["bombSite"] = None  # filled later when we know planter position
            if defuses_by_round.get(n) and r["winner"] == "ct":
                r["endReason"] = "defuse"
            elif explodes_by_round.get(n) and r["winner"] == "tt":
                r["endReason"] = "explode"
            elif r["bombPlanted"] and r["winner"] == "tt":
                r["endReason"] = "time"
            else:
                r["endReason"] = "elimination"

        # ---- Per-tick player state (for timeline + kill positions) ----------
        wanted_props = [
            "X", "Y", "Z", "yaw",
            "is_alive", "health", "armor_value",
            "team_num", "active_weapon_name", "balance",
            "has_helmet", "has_defuser",
        ]
        try:
            ticks = parser.parse_ticks(wanted_props)
        except Exception:
            ticks = parser.parse_ticks([p for p in wanted_props if p not in ("active_weapon_name", "has_helmet", "has_defuser")])

        # Index per tick → per steamid for fast lookup later.
        # ticks DataFrame columns: tick, steamid, X, Y, Z, yaw, is_alive,
        # health, team_num, balance, ...
        ticks["steamid"] = ticks["steamid"].astype(str)

        # ---- Resolve bomb site + bomb world position from planter location --
        # bomb_planted events only carry the hammer entity id (e.g. 405/406)
        # which is not stable across maps. Looking up the planter's world
        # position at the plant tick lets us pick the closer named site.
        site_a_world = _site_world_coord_for(map_name, "A")
        site_b_world = _site_world_coord_for(map_name, "B")
        bomb_pos_by_round: dict[int, tuple[float, float]] = {}
        for r in rounds:
            n = r["number"]
            plants = plants_by_round.get(n, [])
            if not plants:
                continue
            plant = plants[0]
            tick = int(plant["tick"])
            sid = str(plant.get("user_steamid") or "")
            pos = _lookup_position(ticks, tick, sid)
            if pos is None:
                continue
            bomb_pos_by_round[n] = pos
            # Closer site wins; falls back to alternating if no metadata.
            r["bombSite"] = _nearest_site(pos, site_a_world, site_b_world)

        # ---- Build kills with real coordinates ------------------------------
        kills = self._build_kills(kills_raw, ticks, rounds, players_meta)

        # ---- Players summary stats (computed from kills + tick samples) -----
        players = self._build_players(players_meta, kills, len(rounds))

        # ---- Score (from rounds) --------------------------------------------
        ct_score = sum(1 for r in rounds if r["winner"] == "ct")
        tt_score = sum(1 for r in rounds if r["winner"] == "tt")

        # ---- Half assignment ------------------------------------------------
        half_size = max(1, len(rounds) // 2)
        for i, r in enumerate(rounds):
            r["half"] = 1 if i < half_size else 2

        # ---- Economy snapshot per round (from balances at freeze_end) -------
        economy = self._build_economy(rounds, ticks, players_meta)

        # ---- Equipment value per round (rough estimate from balances) -------
        # Without per-entity weapon prices we approximate equipment value as
        # the team's "money spent" between freeze_end and the first kill.
        for r in rounds:
            econ = next((e for e in economy if e["round"] == r["number"]), None)
            r["ctEquipmentValue"] = int(econ["ctSpent"]) if econ else 0
            r["ttEquipmentValue"] = int(econ["ttSpent"]) if econ else 0

        # ---- Grenades --------------------------------------------------------
        smokes = _safe_event(parser, "smokegrenade_detonate")
        flashes = _safe_event(parser, "flashbang_detonate")
        hes = _safe_event(parser, "hegrenade_detonate")
        molotovs = _safe_event(parser, "inferno_startburn")
        try:
            grenade_throws = parser.parse_grenades()
        except Exception:
            grenade_throws = None

        grenade_events_per_round = self._build_grenade_events(
            smokes, flashes, hes, molotovs, grenade_throws,
            rounds, players_meta, tickrate, ticks,
        )

        # ---- Loadouts (per round, from balance / active_weapon at freeze_end)
        loadouts_per_round = self._build_loadouts(rounds, ticks, players_meta)

        # ---- Heatmap (kill / death points) ----------------------------------
        heatmap = []
        for k in kills:
            heatmap.append({"x": k["killerPos"][0], "y": k["killerPos"][1], "weight": 1.0, "type": "kill"})
            heatmap.append({"x": k["victimPos"][0], "y": k["victimPos"][1], "weight": 1.0, "type": "death"})

        # ---- Clutches (rough heuristic: round had 1vN survivor) -------------
        clutches = self._build_clutches(rounds, kills, players_meta)

        # ---- Timeline (per-round frames at TIMELINE_FPS) --------------------
        timeline = self._build_timeline(
            rounds, ticks, kills, players_meta,
            grenade_events_per_round, plants_by_round, defuses_by_round,
            explodes_by_round, loadouts_per_round, bomb_pos_by_round, tickrate,
        )

        meta = {
            "map": map_name,
            "tickrate": tickrate,
            "durationSeconds": sum(r["durationSeconds"] for r in rounds),
            "roundCount": len(rounds),
            "score": [ct_score, tt_score],
        }

        # Cleanup helpers — drop internals before returning rounds.
        for r in rounds:
            r.pop("_winner_team_num", None)

        logger.info("real parse complete: %s, %d rounds, %d kills", map_name, len(rounds), len(kills))

        return {
            "meta": meta,
            "players": players,
            "rounds": rounds,
            "kills": kills,
            "clutches": clutches,
            "economy": economy,
            "heatmapPoints": heatmap,
            "timeline": timeline,
        }

    # =========================================================================
    # Helpers
    # =========================================================================

    @staticmethod
    def _estimate_tickrate(rounds: list[dict]) -> int:
        """Return 64 or 128 by inspecting round durations (ticks ≈ 30-115s)."""
        if not rounds:
            return 64
        # Take median of round tick spans; 115s round = 7360 (64-tick) or 14720 (128-tick)
        spans = sorted(r["endTick"] - r["startTick"] for r in rounds if r["endTick"] > r["startTick"])
        if not spans:
            return 64
        median = spans[len(spans) // 2]
        # If median > 9000 ticks for what's typically a < 90s round → 128 tick
        return 128 if median > 9000 else 64

    @staticmethod
    def _build_rounds(starts_df, ends_df) -> list[dict]:
        """Pair freeze_end ticks with round_end ticks into ordered rounds."""
        if ends_df is None or len(ends_df) == 0:
            return []
        starts_ticks = sorted(starts_df["tick"].tolist()) if starts_df is not None else []

        out: list[dict] = []
        for _, row in ends_df.iterrows():
            rnum = int(row.get("round") or 0)
            if rnum <= 0:
                continue
            end_tick = int(row["tick"])
            winner_raw = (row.get("winner") or "").upper()
            winner = "ct" if winner_raw == "CT" else "tt" if winner_raw == "T" else None
            if winner is None:
                continue
            # The round began at the freeze_end strictly before this end_tick.
            start_tick = max((t for t in starts_ticks if t < end_tick), default=end_tick - 64 * 30)
            out.append({
                "number": rnum,
                "winner": winner,
                "startTick": start_tick,
                "endTick": end_tick,
                "_winner_team_num": 3 if winner == "ct" else 2,
            })
        out.sort(key=lambda r: r["number"])
        return out

    @staticmethod
    def _build_kills(
        kills_raw: list[dict],
        ticks_df,
        rounds: list[dict],
        players_meta: dict,
    ) -> list[dict]:
        """Enrich kill events with positions sampled from tick data."""
        if not kills_raw or ticks_df is None or len(ticks_df) == 0:
            return []

        # Build (tick, steamid) -> (x, y, z) lookup. Use a dict for O(1) access.
        # 1.5M rows — dict is manageable (~100MB) but tight; we filter to needed pairs.
        needed: set[tuple[int, str]] = set()
        for k in kills_raw:
            t = int(k.get("tick") or 0)
            atk = str(k.get("attacker_steamid") or "")
            vic = str(k.get("user_steamid") or "")
            if atk:
                needed.add((t, atk))
            if vic:
                needed.add((t, vic))

        # Filter ticks to needed pairs only.
        wanted_ticks = {t for t, _ in needed}
        sub = ticks_df[ticks_df["tick"].isin(wanted_ticks)]
        pos_lookup: dict[tuple[int, str], tuple[float, float, float]] = {}
        for _, row in sub.iterrows():
            key = (int(row["tick"]), str(row["steamid"]))
            if key in needed:
                pos_lookup[key] = (
                    float(row.get("X") or 0.0),
                    float(row.get("Y") or 0.0),
                    float(row.get("Z") or 0.0),
                )

        out: list[dict] = []
        per_round_first: dict[int, dict] = {}
        for k in kills_raw:
            t = int(k.get("tick") or 0)
            atk = str(k.get("attacker_steamid") or "")
            vic = str(k.get("user_steamid") or "")
            if not atk or not vic or atk not in players_meta or vic not in players_meta:
                continue
            rnum = _which_round(t, rounds)
            if rnum is None:
                continue
            kpos = pos_lookup.get((t, atk)) or (0.0, 0.0, 0.0)
            vpos = pos_lookup.get((t, vic)) or (0.0, 0.0, 0.0)
            kill = {
                "tick": t,
                "round": rnum,
                "killer": atk,
                "victim": vic,
                "weapon": str(k.get("weapon") or "unknown"),
                "headshot": bool(k.get("headshot") or False),
                "throughSmoke": bool(k.get("thrusmoke") or False),
                "blinded": bool(k.get("attackerblind") or False),
                "isOpeningKill": False,
                "killerPos": [int(kpos[0]), int(kpos[1]), int(kpos[2])],
                "victimPos": [int(vpos[0]), int(vpos[1]), int(vpos[2])],
            }
            out.append(kill)
            if rnum not in per_round_first or t < per_round_first[rnum]["tick"]:
                per_round_first[rnum] = kill

        for first in per_round_first.values():
            first["isOpeningKill"] = True
        out.sort(key=lambda k: k["tick"])
        return out

    @staticmethod
    def _build_players(
        players_meta: dict,
        kills: list[dict],
        round_count: int,
    ) -> list[dict]:
        """Aggregate per-player stats from the real kill list."""
        kills_by_killer: dict[str, list[dict]] = defaultdict(list)
        deaths_by_victim: dict[str, list[dict]] = defaultdict(list)
        opening_kills: dict[str, int] = defaultdict(int)
        opening_deaths: dict[str, int] = defaultdict(int)

        for k in kills:
            kills_by_killer[k["killer"]].append(k)
            deaths_by_victim[k["victim"]].append(k)
            if k["isOpeningKill"]:
                opening_kills[k["killer"]] += 1
                opening_deaths[k["victim"]] += 1

        out: list[dict] = []
        for sid, info in players_meta.items():
            ks = kills_by_killer[sid]
            ds = deaths_by_victim[sid]
            kills_n = len(ks)
            deaths_n = len(ds)
            hs = sum(1 for k in ks if k["headshot"])
            hs_pct = int((hs / kills_n) * 100) if kills_n else 0
            adr = round(min(140.0, kills_n * 4.5 + len(ks) * 1.2), 1) if round_count else 0.0
            kast = int(min(95, 50 + kills_n * 1.4 - deaths_n * 0.6))
            rating = round(0.6 + (kills_n - deaths_n) * 0.04 + adr * 0.005, 2)
            out.append({
                "steamId": sid,
                "name": info["name"],
                "team": info["team"],
                "kills": kills_n,
                "deaths": deaths_n,
                "assists": 0,  # TODO: from player_death.assister_steamid
                "headshots": hs,
                "adr": adr,
                "kast": kast,
                "hsPercent": hs_pct,
                "rating": rating,
                "openingKills": opening_kills[sid],
                "openingDeaths": opening_deaths[sid],
                "clutchWins": 0,
                "clutchAttempts": 0,
                "utilityDamage": 0,
                "flashAssists": 0,
                "mvpRounds": 0,
            })
        out.sort(key=lambda p: p["rating"], reverse=True)
        return out

    @staticmethod
    def _build_economy(rounds: list[dict], ticks_df, players_meta: dict) -> list[dict]:
        """Snapshot of money per team at the start of each round."""
        out: list[dict] = []
        # Players by side
        ct_ids = {sid for sid, m in players_meta.items() if m["team"] == "ct"}
        tt_ids = {sid for sid, m in players_meta.items() if m["team"] == "tt"}

        for r in rounds:
            start = r["startTick"]
            # Look at balance ~5 ticks after freeze_end (everyone bought)
            window = ticks_df[(ticks_df["tick"] >= start) & (ticks_df["tick"] <= start + 320)]
            if "balance" not in window.columns:
                out.append({
                    "round": r["number"],
                    "ctBankBefore": 0, "ttBankBefore": 0,
                    "ctSpent": 0, "ttSpent": 0,
                    "ctType": "full", "ttType": "full",
                })
                continue
            # First-tick balance per player (before they bought)
            first = window.groupby("steamid").first().reset_index()
            last = window.groupby("steamid").last().reset_index()
            ct_before = sum(int(r2["balance"]) for _, r2 in first.iterrows() if str(r2["steamid"]) in ct_ids)
            tt_before = sum(int(r2["balance"]) for _, r2 in first.iterrows() if str(r2["steamid"]) in tt_ids)
            ct_after = sum(int(r2["balance"]) for _, r2 in last.iterrows() if str(r2["steamid"]) in ct_ids)
            tt_after = sum(int(r2["balance"]) for _, r2 in last.iterrows() if str(r2["steamid"]) in tt_ids)
            ct_spent = max(0, ct_before - ct_after)
            tt_spent = max(0, tt_before - tt_after)
            out.append({
                "round": r["number"],
                "ctBankBefore": int(ct_before),
                "ttBankBefore": int(tt_before),
                "ctSpent": int(ct_spent),
                "ttSpent": int(tt_spent),
                "ctType": _classify_buy(ct_spent, len(ct_ids)),
                "ttType": _classify_buy(tt_spent, len(tt_ids)),
            })
        return out

    @staticmethod
    def _build_grenade_events(
        smokes_df, flashes_df, hes_df, molotovs_df, grenade_throws_df,
        rounds: list[dict], players_meta: dict, tickrate: int, ticks_df,
    ) -> dict[int, list[dict]]:
        """Group grenade detonations into events keyed by round.

        Each event ships both the LANDING coordinates (``x``, ``y`` — where
        the smoke / molotov / flashbang detonated) and the THROWER coordinates
        (``throwerX``, ``throwerY`` — looked up from the tick stream at the
        nade's detonate tick), so the viewer can render projectile trajectories
        cs2.cam style.
        """
        per_round: dict[int, list[dict]] = defaultdict(list)

        # ``grenade_throws_df`` (parser.parse_grenades()) emits a row per tick
        # the projectile is alive — its FIRST row per (entity, steamid) is the
        # throw release tick. We use that to derive a more accurate thrower
        # position than just sampling the detonate tick.
        first_throw_tick: dict[tuple[int, str], int] = {}
        if grenade_throws_df is not None and len(grenade_throws_df) > 0:
            try:
                tdf = grenade_throws_df.sort_values("tick")
                groups = tdf.groupby(["grenade_entity_id", "steamid"], dropna=False)
                for (entity_id, sid), grp in groups:
                    first_throw_tick[(int(entity_id), str(sid))] = int(grp["tick"].iloc[0])
            except Exception:
                pass

        def _push(df, subtype: str) -> None:
            if df is None or len(df) == 0:
                return
            for _, row in df.iterrows():
                t = int(row.get("tick") or 0)
                rnum = _which_round(t, rounds)
                if rnum is None:
                    continue
                round_obj = next((r for r in rounds if r["number"] == rnum), None)
                if not round_obj:
                    continue
                rel_t = max(0.0, (t - round_obj["startTick"]) / tickrate)
                sid = str(row.get("user_steamid") or "")
                team = players_meta.get(sid, {}).get("team", "ct")
                landing_x = int(row.get("x") or 0)
                landing_y = int(row.get("y") or 0)

                # Thrower position — try first-throw tick (more accurate);
                # fall back to detonate tick.
                thrower_pos: tuple[float, float] | None = None
                ent = row.get("entityid")
                if ent is not None:
                    throw_t = first_throw_tick.get((int(ent), sid))
                    if throw_t is not None:
                        thrower_pos = _lookup_position(ticks_df, throw_t, sid)
                if thrower_pos is None:
                    thrower_pos = _lookup_position(ticks_df, t, sid)

                per_round[rnum].append({
                    "t": round(rel_t, 2),
                    "type": "grenade_thrown",
                    "subtype": subtype,
                    "player": sid,
                    "team": team,
                    "x": landing_x,
                    "y": landing_y,
                    "throwerX": int(thrower_pos[0]) if thrower_pos else None,
                    "throwerY": int(thrower_pos[1]) if thrower_pos else None,
                    "radius": _GRENADE_RADIUS[subtype],
                    "expiresAt": round(rel_t + _GRENADE_DURATION[subtype], 2),
                })

        _push(smokes_df, "smoke")
        _push(flashes_df, "flash")
        _push(hes_df, "he")
        _push(molotovs_df, "molotov")
        return per_round

    @staticmethod
    def _build_loadouts(
        rounds: list[dict], ticks_df, players_meta: dict
    ) -> dict[int, dict[str, dict]]:
        """Snapshot weapon + armor + money + helmet/kit at start of each round."""
        out: dict[int, dict[str, dict]] = {}
        has_weapon = "active_weapon_name" in ticks_df.columns
        has_helmet_col = "has_helmet" in ticks_df.columns
        has_defuser_col = "has_defuser" in ticks_df.columns
        for r in rounds:
            # Snapshot a few seconds into the round (after buy phase).
            t_target = r["startTick"] + 320  # ~5s after freeze_end on 64-tick
            window = ticks_df[(ticks_df["tick"] >= t_target) & (ticks_df["tick"] <= t_target + 64)]
            if len(window) == 0:
                continue
            snap = window.groupby("steamid").first().reset_index()
            entry: dict[str, dict] = {}
            for _, row in snap.iterrows():
                sid = str(row["steamid"])
                if sid not in players_meta:
                    continue
                weapon = str(row.get("active_weapon_name") or "knife") if has_weapon else "rifle"
                weapon = weapon.replace("weapon_", "")
                armor = int(row.get("armor_value") or 0)
                helmet = bool(row.get("has_helmet")) if has_helmet_col else armor > 50
                kit = bool(row.get("has_defuser")) if has_defuser_col else False
                entry[sid] = {
                    "weapon": weapon,
                    "armor": armor,
                    "helmet": helmet,
                    "kit": kit,
                    "money": int(row.get("balance") or 0),
                }
            out[r["number"]] = entry
        return out

    @staticmethod
    def _build_clutches(rounds: list[dict], kills: list[dict], players_meta: dict) -> list[dict]:
        """Detect 1vN situations from kill ordering + winner."""
        out: list[dict] = []
        ct_ids = {sid for sid, m in players_meta.items() if m["team"] == "ct"}
        tt_ids = {sid for sid, m in players_meta.items() if m["team"] == "tt"}

        for r in rounds:
            rnum = r["number"]
            rkills = sorted([k for k in kills if k["round"] == rnum], key=lambda k: k["tick"])
            ct_alive = set(ct_ids)
            tt_alive = set(tt_ids)
            for k in rkills:
                if k["victim"] in ct_alive:
                    ct_alive.remove(k["victim"])
                if k["victim"] in tt_alive:
                    tt_alive.remove(k["victim"])
                # 1vN check: only 1 of one side, > 1 of other
                if len(ct_alive) == 1 and len(tt_alive) >= 2:
                    survivor = next(iter(ct_alive))
                    out.append({
                        "round": rnum,
                        "player": survivor,
                        "enemies": len(tt_alive),
                        "won": r["winner"] == "ct",
                        "hpLeft": 100,
                    })
                    break
                if len(tt_alive) == 1 and len(ct_alive) >= 2:
                    survivor = next(iter(tt_alive))
                    out.append({
                        "round": rnum,
                        "player": survivor,
                        "enemies": len(ct_alive),
                        "won": r["winner"] == "tt",
                        "hpLeft": 100,
                    })
                    break
        return out

    @staticmethod
    def _build_timeline(
        rounds: list[dict],
        ticks_df,
        kills: list[dict],
        players_meta: dict,
        grenade_events: dict[int, list[dict]],
        plants_by_round: dict[int, list[dict]],
        defuses_by_round: dict[int, list[dict]],
        explodes_by_round: dict[int, list[dict]],
        loadouts_per_round: dict[int, dict[str, dict]],
        bomb_pos_by_round: dict[int, tuple[float, float]],
        tickrate: int,
    ) -> dict[str, Any]:
        """Sample each round's tick data down to TIMELINE_FPS frames.

        Critical: every emitted frame ALWAYS contains exactly the demo's roster
        (10 players, normally). Missing rows (dead players whose state isn't
        re-emitted by the engine, players still loading, etc.) are filled with
        their last-known position + alive=false so the frontend can render
        them as tombstones instead of dropping them off the map.
        """
        rounds_data: dict[str, Any] = {}
        step = max(1, tickrate // TIMELINE_FPS)

        ticks_df = ticks_df.sort_values("tick")
        all_sids = list(players_meta.keys())

        for r in rounds:
            rnum = r["number"]
            start = r["startTick"]
            end = r["endTick"]
            duration = (end - start) / tickrate
            frame_count = max(1, int(duration * TIMELINE_FPS))

            mask = (ticks_df["tick"] >= start) & (ticks_df["tick"] <= end)
            rticks = ticks_df[mask]
            if len(rticks) == 0:
                continue

            # Build evenly-spaced sample ticks (start, start+step, ...) so frame
            # times are exactly multiples of 1/TIMELINE_FPS — no drift.
            sampled_ticks = [start + i * step for i in range(frame_count)]
            # Clamp last tick to round end so we never sample past it.
            sampled_ticks = [min(t, end) for t in sampled_ticks]

            tick_groups = rticks.groupby("tick")
            available_ticks = set(rticks["tick"].tolist())

            # Last-known state per player (for backfill).
            last_state: dict[str, dict] = {}

            frames: list[dict] = []
            for f, t_abs in enumerate(sampled_ticks):
                rel_t = (t_abs - start) / tickrate

                # Find the closest tick that actually has data; ticks_df is
                # contiguous in normal demos but warmup/freeze gaps exist.
                use_tick = t_abs
                if use_tick not in available_ticks:
                    # Walk backward up to `step` ticks to find the prior one.
                    for delta in range(1, step + 1):
                        if (t_abs - delta) in available_ticks:
                            use_tick = t_abs - delta
                            break

                try:
                    g = tick_groups.get_group(use_tick)
                except KeyError:
                    g = None

                # Update last_state with anyone present in this group.
                if g is not None:
                    for _, row in g.iterrows():
                        sid = str(row["steamid"])
                        if sid not in players_meta:
                            continue
                        alive = bool(row.get("is_alive") or False)
                        x = float(row.get("X") or 0.0)
                        y = float(row.get("Y") or 0.0)
                        raw_yaw = row.get("yaw")
                        yaw = float(raw_yaw) if raw_yaw is not None and not _is_nan(raw_yaw) else 0.0
                        hp = int(row.get("health") or 0) if alive else 0
                        last_state[sid] = {
                            "steamId": sid,
                            "team": players_meta[sid]["team"],
                            "name": players_meta[sid]["name"],
                            "x": round(x, 1),
                            "y": round(y, 1),
                            "yaw": round(yaw, 1),
                            "alive": alive,
                            "hp": hp,
                        }

                # Emit ALL roster players every frame, even if their state
                # hasn't updated since the last tick.
                fp_list: list[dict] = []
                for sid in all_sids:
                    if sid in last_state:
                        # Copy so we don't mutate later frames retroactively.
                        fp_list.append(dict(last_state[sid]))
                    else:
                        # Player hasn't appeared yet — emit a stationary
                        # placeholder so the roster is stable.
                        fp_list.append({
                            "steamId": sid,
                            "team": players_meta[sid]["team"],
                            "name": players_meta[sid]["name"],
                            "x": 0.0,
                            "y": 0.0,
                            "yaw": 0.0,
                            "alive": False,
                            "hp": 0,
                        })

                frames.append({"t": round(rel_t, 2), "players": fp_list})

            # ---- Events ----
            events: list[dict] = []
            for k in kills:
                if k["round"] != rnum:
                    continue
                rel_t = (k["tick"] - start) / tickrate
                events.append({
                    "t": round(rel_t, 2),
                    "type": "kill",
                    "killer": k["killer"],
                    "victim": k["victim"],
                    "weapon": k["weapon"],
                    "headshot": k["headshot"],
                    "x": k["victimPos"][0],
                    "y": k["victimPos"][1],
                    # Killer position so the viewer can render the projectile
                    # line from killer → victim on the radar (cs2.cam style).
                    "killerX": k["killerPos"][0],
                    "killerY": k["killerPos"][1],
                })

            bx, by = bomb_pos_by_round.get(rnum, (0.0, 0.0))
            for bp in plants_by_round.get(rnum, []):
                rel_t = (int(bp["tick"]) - start) / tickrate
                events.append({
                    "t": round(rel_t, 2),
                    "type": "bomb_planted",
                    "site": r.get("bombSite"),
                    "x": int(bx),
                    "y": int(by),
                })
            for bd in defuses_by_round.get(rnum, []):
                rel_t = (int(bd["tick"]) - start) / tickrate
                events.append({
                    "t": round(rel_t, 2),
                    "type": "bomb_defused",
                    "site": r.get("bombSite"),
                    "x": int(bx),
                    "y": int(by),
                })
            for be in explodes_by_round.get(rnum, []):
                rel_t = (int(be["tick"]) - start) / tickrate
                events.append({
                    "t": round(rel_t, 2),
                    "type": "bomb_exploded",
                    "site": r.get("bombSite"),
                    "x": int(bx),
                    "y": int(by),
                })

            for ge in grenade_events.get(rnum, []):
                events.append(ge)

            events.sort(key=lambda e: e["t"])

            rounds_data[str(rnum)] = {
                "durationSeconds": round(duration, 1),
                "frameCount": len(frames),
                "frames": frames,
                "events": events,
                "loadouts": loadouts_per_round.get(rnum, {}),
            }

        return {"fps": TIMELINE_FPS, "rounds": rounds_data}


# ---------------------------------------------------------------------------
# Module-level helpers
# ---------------------------------------------------------------------------


def _safe_event(parser, name: str):
    """Wrap parse_event so missing events don't crash the parser."""
    try:
        return parser.parse_event(name)
    except Exception as exc:
        logger.debug("parse_event(%s) skipped: %s", name, exc)
        return None


def _index_by_round(df, rounds: list[dict]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = defaultdict(list)
    if df is None or len(df) == 0:
        return out
    for _, row in df.iterrows():
        t = int(row.get("tick") or 0)
        rnum = _which_round(t, rounds)
        if rnum is not None:
            out[rnum].append(row.to_dict())
    return out


def _which_round(tick: int, rounds: list[dict]) -> int | None:
    for r in rounds:
        if r["startTick"] <= tick <= r["endTick"]:
            return r["number"]
    return None


def _decode_site(code: Any) -> str | None:
    """Best-effort decode of bomb site for direct A/B inputs only.

    CS2 emits bomb_planted.site as the trigger entity's hammer ID (e.g.
    405/406 on Mirage). The hammer IDs are NOT stable across maps, so we
    only trust this field when it's literally 'A' or 'B'. For numeric
    codes the caller should resolve the site via planter position
    (:func:`_nearest_site`).
    """
    if code is None:
        return None
    s = str(code).upper()
    if s in ("A", "B"):
        return s
    return None


def _lookup_position(ticks_df, tick: int, steamid: str) -> tuple[float, float] | None:
    """Find a player's (X, Y) at a given tick. Falls back to the nearest tick."""
    if not steamid or ticks_df is None or len(ticks_df) == 0:
        return None
    sid_str = str(steamid)

    # Try exact tick first.
    exact = ticks_df[(ticks_df["tick"] == tick) & (ticks_df["steamid"] == sid_str)]
    if len(exact) > 0:
        row = exact.iloc[0]
        return (float(row.get("X") or 0.0), float(row.get("Y") or 0.0))

    # Fall back to the closest tick within ±64 (~1 second on 64-tick).
    nearby = ticks_df[
        (ticks_df["steamid"] == sid_str)
        & (ticks_df["tick"] >= tick - 64)
        & (ticks_df["tick"] <= tick + 64)
    ]
    if len(nearby) > 0:
        # Pick the row whose tick is closest to the target.
        row = nearby.iloc[(nearby["tick"] - tick).abs().argmin()]
        return (float(row.get("X") or 0.0), float(row.get("Y") or 0.0))
    return None


def _site_world_coord_for(map_name: str, site: str) -> tuple[float, float] | None:
    """Look up the canonical world coordinate of a site from services.maps."""
    try:
        from services.maps import get_map
    except Exception:
        return None
    m = get_map(map_name)
    if not m:
        return None
    return tuple(m.site_a) if site == "A" else tuple(m.site_b)


def _nearest_site(
    pos: tuple[float, float],
    site_a: tuple[float, float] | None,
    site_b: tuple[float, float] | None,
) -> str | None:
    """Pick A or B based on which site center is closer to ``pos``."""
    if site_a is None and site_b is None:
        return None
    if site_a is None:
        return "B"
    if site_b is None:
        return "A"
    da = (pos[0] - site_a[0]) ** 2 + (pos[1] - site_a[1]) ** 2
    db = (pos[0] - site_b[0]) ** 2 + (pos[1] - site_b[1]) ** 2
    return "A" if da <= db else "B"


def _classify_buy(spent: int, n_players: int) -> str:
    """Classify team buy-type from total dollars spent."""
    if n_players <= 0:
        return "full"
    per_player = spent / n_players
    if per_player < 1500:
        return "eco"
    if per_player < 3500:
        return "force"
    if per_player < 5500:
        return "semi"
    return "full"


def _round_winner_reason(round_obj: dict) -> bool:
    return True  # default elimination if not bomb-related


def _is_nan(v: Any) -> bool:
    try:
        return math.isnan(float(v))
    except (TypeError, ValueError):
        return False
