"""
Demo parser service.

In production (Phase 3) this wraps `demoparser2` (Rust-backed) to extract
events from CS2 .dem files. Until that dependency ships, we use a
deterministic stub that produces coherent fake-but-realistic data seeded by
the file's name+size, so the full pipeline (upload → queue → process → render
→ 2D replay) can be exercised end-to-end on any environment.

The stub now generates a full PER-ROUND TIMELINE with:
    - movement frames at 10 FPS (player positions over time)
    - discrete events: kills, bomb_planted, bomb_defused, bomb_exploded,
      grenade_thrown (smoke / flashbang / he / molotov), grenade_expired
    - alive/dead state per player per frame

Coordinates use a normalized [-2000, 2000] CS2-like world space; the frontend
projects them onto the visible map canvas.

When demoparser2 becomes available, swap the body of `parse()` for the real
implementation; the return shape stays the same.
"""

from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Any


CS2_MAPS = ["de_mirage", "de_inferno", "de_dust2", "de_nuke", "de_ancient", "de_anubis", "de_vertigo"]
WEAPONS = ["ak47", "m4a1", "awp", "deagle", "usp_silencer", "glock", "famas", "mp9", "mac10"]
PLAYER_NAMES = [
    "s1mple", "ZywOo", "NiKo", "device", "electronic", "ropz", "donk", "m0NESY",
    "broky", "Twistzz", "frozen", "huNter-", "blameF", "stavn", "jL", "iM",
    "b1t", "Aleksib", "Snax", "torzsi",
]
GRENADE_TYPES = ["smoke", "flash", "he", "molotov"]

# Replay sampling rate — frontend interpolates between frames for smooth motion
TIMELINE_FPS = 10
WORLD_MIN, WORLD_MAX = -2000, 2000


class DemoParserService:
    """Wraps the demo parser. Stub mode is deterministic by file path."""

    def parse(self, demo_path: str | Path) -> dict[str, Any]:
        """
        Parse a CS2 demo file and return structured analysis data.

        Returns a dict with keys:
            meta, players, rounds, kills, clutches, economy, heatmapPoints, timeline
        """
        path = Path(demo_path)
        seed_source = f"{path.name}:{path.stat().st_size if path.exists() else 0}"
        rng = random.Random(seed_source)

        meta = self._fake_meta(rng)
        players = self._fake_players(rng)
        rounds = self._fake_rounds(rng, meta["roundCount"], meta["score"])
        kills = self._fake_kills(rng, players, rounds)
        clutches = self._fake_clutches(rng, players, rounds)
        economy = self._fake_economy(rng, rounds)
        heatmap = self._fake_heatmap(rng, kills)
        timeline = self._fake_timeline(rng, players, rounds, kills)

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
    # Existing helpers
    # =========================================================================

    def _fake_meta(self, rng: random.Random) -> dict[str, Any]:
        score_a = rng.randint(8, 16)
        score_b = rng.randint(5, 16) if score_a == 16 else 16
        if rng.random() < 0.5:
            score_a, score_b = score_b, score_a
        round_count = score_a + score_b
        return {
            "map": rng.choice(CS2_MAPS),
            "tickrate": rng.choice([64, 128]),
            "durationSeconds": rng.randint(2400, 4500),
            "roundCount": round_count,
            "score": [score_a, score_b],
        }

    def _fake_players(self, rng: random.Random) -> list[dict[str, Any]]:
        names = rng.sample(PLAYER_NAMES, 10)
        players = []
        for i, name in enumerate(names):
            team = "ct" if i < 5 else "tt"
            kills = rng.randint(8, 30)
            deaths = rng.randint(10, 25)
            assists = rng.randint(2, 10)
            adr = round(rng.uniform(50, 120), 1)
            kast = rng.randint(55, 85)
            hs = rng.randint(35, 75)
            rating = round(0.6 + (kills - deaths) * 0.04 + adr * 0.005, 2)
            players.append({
                "steamId": f"7656119{rng.randint(1000000, 9999999):07d}",
                "name": name,
                "team": team,
                "kills": kills,
                "deaths": deaths,
                "assists": assists,
                "headshots": int(kills * hs / 100),
                "adr": adr,
                "kast": kast,
                "hsPercent": hs,
                "rating": rating,
                "openingKills": rng.randint(0, 7),
                "openingDeaths": rng.randint(0, 6),
                "clutchWins": rng.randint(0, 4),
                "clutchAttempts": rng.randint(0, 6),
                "utilityDamage": rng.randint(50, 400),
                "flashAssists": rng.randint(0, 8),
                "mvpRounds": rng.randint(0, 6),
            })
        players.sort(key=lambda p: p["rating"], reverse=True)
        return players

    def _fake_rounds(self, rng: random.Random, round_count: int, score: list[int]) -> list[dict[str, Any]]:
        ct_total, tt_total = score
        winners = ["ct"] * ct_total + ["tt"] * tt_total
        rng.shuffle(winners)
        end_reasons = ["elimination", "defuse", "explode", "time"]

        rounds = []
        tick = 0
        for i, winner in enumerate(winners, start=1):
            duration = rng.randint(20, 115)
            ct_eq = rng.randint(2000, 30000)
            tt_eq = rng.randint(2000, 30000)
            bomb_planted = rng.random() < 0.55
            rounds.append({
                "number": i,
                "half": 1 if i <= round_count // 2 else 2,
                "winner": winner,
                "endReason": rng.choice(end_reasons),
                "durationSeconds": duration,
                "startTick": tick,
                "endTick": tick + duration * 64,
                "ctEquipmentValue": ct_eq,
                "ttEquipmentValue": tt_eq,
                "bombPlanted": bomb_planted,
                "bombSite": rng.choice(["A", "B"]) if bomb_planted else None,
            })
            tick += duration * 64
        return rounds

    def _fake_kills(self, rng: random.Random, players: list[dict], rounds: list[dict]) -> list[dict[str, Any]]:
        kills = []
        for rnd in rounds:
            n_kills = rng.randint(3, 9)
            for _ in range(n_kills):
                killer = rng.choice(players)
                victim = rng.choice([p for p in players if p["team"] != killer["team"]])
                kills.append({
                    "tick": rnd["startTick"] + rng.randint(0, max(1, rnd["endTick"] - rnd["startTick"])),
                    "round": rnd["number"],
                    "killer": killer["steamId"],
                    "victim": victim["steamId"],
                    "weapon": rng.choice(WEAPONS),
                    "headshot": rng.random() < 0.55,
                    "throughSmoke": rng.random() < 0.05,
                    "blinded": rng.random() < 0.10,
                    "isOpeningKill": False,
                    "killerPos": [rng.randint(WORLD_MIN, WORLD_MAX), rng.randint(WORLD_MIN, WORLD_MAX), rng.randint(0, 200)],
                    "victimPos": [rng.randint(WORLD_MIN, WORLD_MAX), rng.randint(WORLD_MIN, WORLD_MAX), rng.randint(0, 200)],
                })
        per_round_first: dict[int, dict] = {}
        for k in kills:
            if k["round"] not in per_round_first or k["tick"] < per_round_first[k["round"]]["tick"]:
                per_round_first[k["round"]] = k
        for k in per_round_first.values():
            k["isOpeningKill"] = True
        return kills

    def _fake_clutches(self, rng: random.Random, players: list[dict], rounds: list[dict]) -> list[dict[str, Any]]:
        clutches = []
        for rnd in rng.sample(rounds, min(len(rounds), rng.randint(2, 6))):
            player = rng.choice(players)
            clutches.append({
                "round": rnd["number"],
                "player": player["steamId"],
                "enemies": rng.choice([1, 2, 3, 4]),
                "won": rng.random() < 0.45,
                "hpLeft": rng.randint(1, 100),
            })
        return clutches

    def _fake_economy(self, rng: random.Random, rounds: list[dict]) -> list[dict[str, Any]]:
        ct_bank = 800
        tt_bank = 800
        types = ["full", "eco", "force", "semi"]
        result = []
        for rnd in rounds:
            ct_spent = rng.randint(2000, 25000)
            tt_spent = rng.randint(2000, 25000)
            result.append({
                "round": rnd["number"],
                "ctBankBefore": ct_bank,
                "ttBankBefore": tt_bank,
                "ctSpent": ct_spent,
                "ttSpent": tt_spent,
                "ctType": rng.choice(types),
                "ttType": rng.choice(types),
            })
            ct_bank = max(800, ct_bank - ct_spent + rng.randint(2000, 5000))
            tt_bank = max(800, tt_bank - tt_spent + rng.randint(2000, 5000))
        return result

    def _fake_heatmap(self, rng: random.Random, kills: list[dict]) -> list[dict[str, Any]]:
        points = []
        for k in kills:
            points.append({"x": k["killerPos"][0], "y": k["killerPos"][1], "weight": 1.0, "type": "kill"})
            points.append({"x": k["victimPos"][0], "y": k["victimPos"][1], "weight": 1.0, "type": "death"})
        return points

    # =========================================================================
    # NEW: per-round 2D timeline (for the replay viewer)
    # =========================================================================

    def _fake_timeline(
        self,
        rng: random.Random,
        players: list[dict],
        rounds: list[dict],
        kills: list[dict],
    ) -> dict[str, Any]:
        """
        Build a per-round timeline with frames + events for the 2D replay.

        Output:
            {
              "fps": 10,
              "rounds": {
                 "1": {
                   "durationSeconds": 90,
                   "frameCount": 900,
                   "frames": [
                     { "t": 0.0, "players": [{ "steamId": ..., "x": ..., "y": ..., "alive": true, "team": "ct" }] }
                   ],
                   "events": [
                     { "t": 12.4, "type": "kill", "killer": ..., "victim": ..., "weapon": ..., "x": ..., "y": ... },
                     { "t": 45.0, "type": "bomb_planted", "site": "A", "player": ..., "x": ..., "y": ... },
                     { "t": 67.5, "type": "grenade_thrown", "player": ..., "subtype": "smoke", "x": ..., "y": ..., "expiresAt": 85.5 }
                   ]
                 },
                 ...
              }
            }
        """
        kills_by_round: dict[int, list[dict]] = {}
        for k in kills:
            kills_by_round.setdefault(k["round"], []).append(k)

        rounds_data: dict[str, Any] = {}

        for rnd in rounds:
            rnum = rnd["number"]
            duration = float(rnd["durationSeconds"])
            frame_count = int(duration * TIMELINE_FPS)

            # ---- Per-player path: pick a random start and goal anchor, then
            # walk between them with light jitter so players "drift" coherently.
            player_paths: dict[str, list[tuple[float, float]]] = {}
            for p in players:
                start = self._anchor(rng, p["team"], "spawn")
                goal = self._anchor(rng, p["team"], "site")
                path = self._walk(rng, start, goal, frame_count)
                player_paths[p["steamId"]] = path

            # ---- Build alive map per player using the round's kills.
            round_kills = sorted(kills_by_round.get(rnum, []), key=lambda k: k["tick"])
            tick_span = max(1, rnd["endTick"] - rnd["startTick"])

            death_time: dict[str, float] = {}
            for k in round_kills:
                t = (k["tick"] - rnd["startTick"]) / tick_span * duration
                # First time someone dies wins (a player can't die twice in CS)
                death_time.setdefault(k["victim"], t)

            # ---- Frames
            frames = []
            for f in range(frame_count):
                t = f / TIMELINE_FPS
                frame_players = []
                for p in players:
                    sid = p["steamId"]
                    alive = sid not in death_time or t < death_time[sid]
                    x, y = player_paths[sid][f] if alive else player_paths[sid][min(f, frame_count - 1)]
                    # Once dead, freeze the body at the death frame
                    if not alive:
                        death_frame = int(death_time[sid] * TIMELINE_FPS)
                        x, y = player_paths[sid][min(death_frame, frame_count - 1)]
                    frame_players.append({
                        "steamId": sid,
                        "team": p["team"],
                        "name": p["name"],
                        "x": round(x, 1),
                        "y": round(y, 1),
                        "alive": alive,
                    })
                frames.append({"t": round(t, 2), "players": frame_players})

            # ---- Discrete events
            events: list[dict[str, Any]] = []

            # Kills
            for k in round_kills:
                t = (k["tick"] - rnd["startTick"]) / tick_span * duration
                events.append({
                    "t": round(t, 2),
                    "type": "kill",
                    "killer": k["killer"],
                    "victim": k["victim"],
                    "weapon": k["weapon"],
                    "headshot": k["headshot"],
                    "x": k["victimPos"][0],
                    "y": k["victimPos"][1],
                })

            # Bomb planted / defused / exploded
            if rnd["bombPlanted"]:
                plant_t = duration * rng.uniform(0.35, 0.65)
                site_anchor = self._anchor(rng, "tt", "site", site=rnd["bombSite"])
                events.append({
                    "t": round(plant_t, 2),
                    "type": "bomb_planted",
                    "site": rnd["bombSite"],
                    "x": site_anchor[0],
                    "y": site_anchor[1],
                })
                if rnd["endReason"] == "defuse":
                    events.append({
                        "t": round(plant_t + rng.uniform(20, 39), 2),
                        "type": "bomb_defused",
                        "site": rnd["bombSite"],
                        "x": site_anchor[0],
                        "y": site_anchor[1],
                    })
                elif rnd["endReason"] == "explode":
                    events.append({
                        "t": round(plant_t + 40.0, 2),
                        "type": "bomb_exploded",
                        "site": rnd["bombSite"],
                        "x": site_anchor[0],
                        "y": site_anchor[1],
                    })

            # Grenades — between 4 and 10 per round, scattered through time
            n_grenades = rng.randint(4, 10)
            for _ in range(n_grenades):
                t = duration * rng.uniform(0.05, 0.95)
                subtype = rng.choice(GRENADE_TYPES)
                thrower = rng.choice(players)
                pos = (
                    rng.randint(WORLD_MIN, WORLD_MAX),
                    rng.randint(WORLD_MIN, WORLD_MAX),
                )
                grenade_duration = {"smoke": 18.0, "molotov": 7.0, "flash": 0.0, "he": 0.0}[subtype]
                events.append({
                    "t": round(t, 2),
                    "type": "grenade_thrown",
                    "subtype": subtype,
                    "player": thrower["steamId"],
                    "team": thrower["team"],
                    "x": pos[0],
                    "y": pos[1],
                    "expiresAt": round(t + grenade_duration, 2) if grenade_duration > 0 else round(t + 0.5, 2),
                })

            events.sort(key=lambda e: e["t"])

            rounds_data[str(rnum)] = {
                "durationSeconds": duration,
                "frameCount": frame_count,
                "frames": frames,
                "events": events,
            }

        return {"fps": TIMELINE_FPS, "rounds": rounds_data}

    # ------------- helpers for the timeline -------------

    def _anchor(
        self,
        rng: random.Random,
        team: str,
        kind: str,
        site: str | None = None,
    ) -> tuple[float, float]:
        """
        Stylized spawn/objective anchors. Real demoparser2 will give world coords;
        for the stub these are just biased corners so movement looks meaningful.
        """
        if kind == "spawn":
            base = (-1500, -1500) if team == "ct" else (1500, 1500)
        else:  # site
            if site == "A" or (site is None and rng.random() < 0.5):
                base = (1200, -800)
            else:
                base = (-1100, 1300)
        return (base[0] + rng.uniform(-200, 200), base[1] + rng.uniform(-200, 200))

    def _walk(
        self,
        rng: random.Random,
        start: tuple[float, float],
        goal: tuple[float, float],
        frame_count: int,
    ) -> list[tuple[float, float]]:
        """
        Generate a smooth path of length `frame_count` that drifts from start
        toward goal with sinusoidal jitter. Players "wander" rather than walking
        in straight lines.
        """
        path = []
        # Linear param + sinusoidal cross-axis wiggle
        amp_x = rng.uniform(80, 250)
        amp_y = rng.uniform(80, 250)
        phase_x = rng.uniform(0, 2 * math.pi)
        phase_y = rng.uniform(0, 2 * math.pi)
        freq = rng.uniform(0.5, 2.0)

        # Some players "stop" partway and hold a position (anchor in cover)
        hold_at = rng.uniform(0.4, 0.9) if rng.random() < 0.5 else 1.0

        for f in range(frame_count):
            u = min(f / max(1, frame_count - 1), hold_at) / hold_at
            base_x = start[0] + (goal[0] - start[0]) * u
            base_y = start[1] + (goal[1] - start[1]) * u
            wiggle_x = math.sin(2 * math.pi * freq * (f / frame_count) + phase_x) * amp_x * (1 - u * 0.7)
            wiggle_y = math.cos(2 * math.pi * freq * (f / frame_count) + phase_y) * amp_y * (1 - u * 0.7)
            path.append((
                max(WORLD_MIN, min(WORLD_MAX, base_x + wiggle_x)),
                max(WORLD_MIN, min(WORLD_MAX, base_y + wiggle_y)),
            ))
        return path
