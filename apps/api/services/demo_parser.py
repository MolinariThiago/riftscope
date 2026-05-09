"""
Demo parser service.

In production (Phase 3B) this is replaced via :func:`services.parser_factory.get_parser`
by a wrapper around ``demoparser2`` (Rust-backed) that extracts events from
real CS2 .dem files. Until that ships we use a deterministic stub that
produces coherent fake-but-realistic data seeded by the file's name+size,
so the full pipeline (upload → queue → process → render → 2D replay)
can be exercised end-to-end on any environment.

Phase 3A improvements:

- The stub now picks bombsite, spawn and callout anchors from the
  per-map metadata in :mod:`services.maps`, so different demos generate
  visibly different traffic patterns on the radar.
- Each frame includes a ``yaw`` (degrees, 0 = +X, CCW positive) for every
  player, used by the frontend to draw view-direction arrows.
- Grenade events carry an explicit ``radius`` so molotov burn areas and
  smoke clouds stay consistent with what the renderer paints.

Coordinates use the world bounds defined per-map; the frontend projects
them onto the visible map canvas through a matching transform.
"""

from __future__ import annotations

import math
import random
from pathlib import Path
from typing import Any

from services.maps import MapMetadata, get_map_or_default, supported_map_names


WEAPONS = ["ak47", "m4a1", "awp", "deagle", "usp_silencer", "glock", "famas", "mp9", "mac10"]
PRIMARY_T = ["ak47", "awp", "galilar", "sg556", "famas"]
PRIMARY_CT = ["m4a1", "m4a1_silencer", "awp", "famas", "aug"]
PISTOLS_T = ["glock", "p250", "tec9", "deagle"]
PISTOLS_CT = ["usp_silencer", "p2000", "fiveseven", "deagle"]
SMGS = ["mp9", "mac10", "mp7", "ump45", "p90"]
PLAYER_NAMES = [
    "s1mple", "ZywOo", "NiKo", "device", "electronic", "ropz", "donk", "m0NESY",
    "broky", "Twistzz", "frozen", "huNter-", "blameF", "stavn", "jL", "iM",
    "b1t", "Aleksib", "Snax", "torzsi",
]
GRENADE_TYPES = ["smoke", "flash", "he", "molotov"]
GRENADE_RADIUS = {"smoke": 220, "molotov": 160, "flash": 60, "he": 90}
GRENADE_DURATION = {"smoke": 18.0, "molotov": 7.0, "flash": 0.5, "he": 0.5}

# Replay sampling rate — frontend interpolates between frames for smooth motion
TIMELINE_FPS = 10


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
        map_meta = get_map_or_default(meta["map"])

        players = self._fake_players(rng)
        rounds = self._fake_rounds(rng, meta["roundCount"], meta["score"])
        kills = self._fake_kills(rng, players, rounds, map_meta)
        clutches = self._fake_clutches(rng, players, rounds)
        economy = self._fake_economy(rng, rounds)
        heatmap = self._fake_heatmap(rng, kills)
        timeline = self._fake_timeline(rng, players, rounds, kills, economy, map_meta)

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

    def _fake_meta(self, rng: random.Random) -> dict[str, Any]:
        score_a = rng.randint(8, 16)
        score_b = rng.randint(5, 16) if score_a == 16 else 16
        if rng.random() < 0.5:
            score_a, score_b = score_b, score_a
        round_count = score_a + score_b
        return {
            "map": rng.choice(supported_map_names()),
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

    def _fake_kills(
        self,
        rng: random.Random,
        players: list[dict],
        rounds: list[dict],
        map_meta: MapMetadata,
    ) -> list[dict[str, Any]]:
        kills = []
        for rnd in rounds:
            n_kills = rng.randint(3, 9)
            target = rnd["bombSite"] if rnd["bombPlanted"] else rng.choice(["A", "B"])
            for _ in range(n_kills):
                killer = rng.choice(players)
                victim = rng.choice([p for p in players if p["team"] != killer["team"]])
                # Engagement happens somewhere along the corridor each side
                # is using to attack/defend the active site — picking a point
                # along a real path keeps the kill marker on walkable terrain.
                kpos = self._engagement_point(rng, map_meta, killer["team"], target)
                vpos = self._engagement_point(rng, map_meta, victim["team"], target)
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
                    "killerPos": [int(kpos[0]), int(kpos[1]), rng.randint(0, 200)],
                    "victimPos": [int(vpos[0]), int(vpos[1]), rng.randint(0, 200)],
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
    # Per-round 2D timeline (for the replay viewer)
    # =========================================================================

    def _fake_timeline(
        self,
        rng: random.Random,
        players: list[dict],
        rounds: list[dict],
        kills: list[dict],
        economy: list[dict],
        map_meta: MapMetadata,
    ) -> dict[str, Any]:
        kills_by_round: dict[int, list[dict]] = {}
        for k in kills:
            kills_by_round.setdefault(k["round"], []).append(k)

        econ_by_round: dict[int, dict] = {e["round"]: e for e in economy}

        rounds_data: dict[str, Any] = {}

        for rnd in rounds:
            rnum = rnd["number"]
            duration = float(rnd["durationSeconds"])
            frame_count = int(duration * TIMELINE_FPS)
            econ = econ_by_round.get(rnum, {})

            # Per-round loadouts — what each player started the round with.
            loadouts = self._fake_loadouts(rng, players, rnum, econ)

            # Per-player path — each player picks one of the map's hand-curated
            # walking corridors (real CS2 lanes: ramp, mid, banana, apps, etc.)
            # and walks along it. Movement now follows the playable geometry
            # of the real radar instead of cutting through walls.
            target_site = rnd["bombSite"] if rnd["bombPlanted"] else rng.choice(["A", "B"])
            player_paths: dict[str, list[tuple[float, float]]] = {}
            for p in players:
                waypoints = self._pick_waypoints(rng, map_meta, p["team"], target_site)
                path = self._walk_along_waypoints(rng, waypoints, frame_count, map_meta)
                player_paths[p["steamId"]] = path

            # Map kills onto round-relative time so we know who dies and when.
            round_kills = sorted(kills_by_round.get(rnum, []), key=lambda k: k["tick"])
            tick_span = max(1, rnd["endTick"] - rnd["startTick"])

            death_time: dict[str, float] = {}
            for k in round_kills:
                t = (k["tick"] - rnd["startTick"]) / tick_span * duration
                # First time someone dies wins (a player can't die twice in CS)
                death_time.setdefault(k["victim"], t)

            # ---- Frames
            frames: list[dict[str, Any]] = []
            prev_positions: dict[str, tuple[float, float]] = {}
            for f in range(frame_count):
                t = f / TIMELINE_FPS
                frame_players = []
                for p in players:
                    sid = p["steamId"]
                    alive = sid not in death_time or t < death_time[sid]
                    if alive:
                        x, y = player_paths[sid][f]
                    else:
                        # Once dead, freeze the body at the death frame
                        death_frame = int(death_time[sid] * TIMELINE_FPS)
                        x, y = player_paths[sid][min(death_frame, frame_count - 1)]

                    # Yaw — direction the player is facing in degrees.
                    # Derived from the next-position delta; falls back to facing
                    # the round goal at frame 0.
                    if alive and f + 1 < frame_count:
                        nx, ny = player_paths[sid][f + 1]
                        dx, dy = nx - x, ny - y
                        if abs(dx) + abs(dy) < 0.5:
                            # Standing still — keep last known yaw or face the site.
                            prev = prev_positions.get(sid)
                            if prev is not None and (prev[0] != x or prev[1] != y):
                                dx, dy = x - prev[0], y - prev[1]
                            else:
                                gx, gy = self._site_anchor(rng, map_meta, "A")
                                dx, dy = gx - x, gy - y
                        yaw = math.degrees(math.atan2(dy, dx))
                    else:
                        yaw = 0.0
                    prev_positions[sid] = (x, y)

                    # HP decays slightly toward the death frame; before that
                    # it's full. Snapshot of "current" HP for the loadout panel.
                    if not alive:
                        hp = 0
                    else:
                        # Random low-amplitude noise so the bar isn't always 100
                        hp = max(20, 100 - int((f / max(1, frame_count)) * 12))
                    frame_players.append({
                        "steamId": sid,
                        "team": p["team"],
                        "name": p["name"],
                        "x": round(x, 1),
                        "y": round(y, 1),
                        "yaw": round(yaw, 1),
                        "alive": alive,
                        "hp": hp,
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
                    "killerX": k["killerPos"][0],
                    "killerY": k["killerPos"][1],
                })

            # Bomb planted / defused / exploded
            if rnd["bombPlanted"]:
                plant_t = duration * rng.uniform(0.35, 0.65)
                site_anchor = self._site_anchor(rng, map_meta, rnd["bombSite"])
                events.append({
                    "t": round(plant_t, 2),
                    "type": "bomb_planted",
                    "site": rnd["bombSite"],
                    "x": int(site_anchor[0]),
                    "y": int(site_anchor[1]),
                })
                if rnd["endReason"] == "defuse":
                    events.append({
                        "t": round(plant_t + rng.uniform(20, 39), 2),
                        "type": "bomb_defused",
                        "site": rnd["bombSite"],
                        "x": int(site_anchor[0]),
                        "y": int(site_anchor[1]),
                    })
                elif rnd["endReason"] == "explode":
                    events.append({
                        "t": round(plant_t + 40.0, 2),
                        "type": "bomb_exploded",
                        "site": rnd["bombSite"],
                        "x": int(site_anchor[0]),
                        "y": int(site_anchor[1]),
                    })

            # Grenades — between 4 and 10 per round, landing on real corridor
            # waypoints so smokes/molotovs cover actual chokepoints (banana,
            # connector, mid-window, etc.) rather than random spots in walls.
            n_grenades = rng.randint(4, 10)
            for _ in range(n_grenades):
                t = duration * rng.uniform(0.05, 0.95)
                subtype = rng.choice(GRENADE_TYPES)
                thrower = rng.choice(players)
                pos = self._utility_landing(rng, map_meta, thrower["team"], target_site)
                grenade_dur = GRENADE_DURATION[subtype]
                events.append({
                    "t": round(t, 2),
                    "type": "grenade_thrown",
                    "subtype": subtype,
                    "player": thrower["steamId"],
                    "team": thrower["team"],
                    "x": int(pos[0]),
                    "y": int(pos[1]),
                    "radius": GRENADE_RADIUS[subtype],
                    "expiresAt": round(t + grenade_dur, 2),
                })

            events.sort(key=lambda e: e["t"])

            rounds_data[str(rnum)] = {
                "durationSeconds": duration,
                "frameCount": frame_count,
                "frames": frames,
                "events": events,
                "loadouts": loadouts,
            }

        return {"fps": TIMELINE_FPS, "rounds": rounds_data}

    def _fake_loadouts(
        self,
        rng: random.Random,
        players: list[dict],
        round_number: int,
        econ: dict,
    ) -> dict[str, dict[str, Any]]:
        """Generate per-player loadouts for a round — weapon, money, armor, kit."""
        loadouts: dict[str, dict[str, Any]] = {}
        is_pistol = round_number in (1, 13)

        for p in players:
            team = p["team"]
            ct = team == "ct"
            buy_type = (econ.get("ctType") if ct else econ.get("ttType")) or "full"

            if is_pistol or buy_type == "eco":
                weapon = rng.choice(PISTOLS_CT if ct else PISTOLS_T)
                armor = rng.randint(0, 100) if rng.random() < 0.6 else 0
                helmet = False
                money_left = rng.randint(0, 800)
            elif buy_type == "force":
                weapon = rng.choice(SMGS + (PISTOLS_CT if ct else PISTOLS_T))
                armor = rng.randint(40, 100)
                helmet = rng.random() < 0.4
                money_left = rng.randint(0, 1500)
            elif buy_type == "semi":
                weapon = rng.choice(SMGS + ([rng.choice(PRIMARY_CT if ct else PRIMARY_T)] * 2))
                armor = rng.randint(60, 100)
                helmet = rng.random() < 0.7
                money_left = rng.randint(0, 2500)
            else:  # full buy
                weapon = rng.choice(PRIMARY_CT if ct else PRIMARY_T)
                armor = 100
                helmet = True
                money_left = rng.randint(0, 4500)

            has_kit = ct and rng.random() < 0.45 and not is_pistol

            loadouts[p["steamId"]] = {
                "weapon": weapon,
                "armor": armor,
                "helmet": helmet,
                "kit": has_kit,
                "money": money_left,
            }
        return loadouts

    # ------------- helpers for the timeline -------------

    def _site_anchor(
        self,
        rng: random.Random,
        map_meta: MapMetadata,
        site: str | None,
    ) -> tuple[float, float]:
        if site == "A":
            base = map_meta.site_a
        elif site == "B":
            base = map_meta.site_b
        else:
            base = map_meta.site_a if rng.random() < 0.5 else map_meta.site_b
        return (base[0] + rng.uniform(-160, 160), base[1] + rng.uniform(-160, 160))

    # =========================================================================
    # Corridor-aware position helpers (Phase 3A.3)
    # =========================================================================
    # All positions now sample from the per-map ``MapPath`` corridors so the
    # data lines up with the playable areas of the real radar. Random jitter
    # is applied PERPENDICULAR to the corridor direction (small) so motion
    # stays inside the corridor instead of leaking into walls.

    def _pick_waypoints(
        self,
        rng: random.Random,
        map_meta: MapMetadata,
        team: str,
        target_site: str,
    ) -> list[tuple[float, float]]:
        """Pick a corridor matching team + target. Falls back to spawn→site."""
        candidates = map_meta.find_paths(team, target_site)
        if candidates:
            return list(rng.choice(candidates).waypoints)
        # Fallback: straight spawn -> site
        spawn = map_meta.spawn_ct if team == "ct" else map_meta.spawn_tt
        site = map_meta.site_a if target_site == "A" else map_meta.site_b
        return [tuple(spawn), tuple(site)]

    def _engagement_point(
        self,
        rng: random.Random,
        map_meta: MapMetadata,
        team: str,
        target_site: str,
    ) -> tuple[float, float]:
        """Sample a position somewhere along the team's chosen corridor."""
        wp = self._pick_waypoints(rng, map_meta, team, target_site)
        # Pick a point biased toward the second half of the corridor
        # (engagements rarely happen at spawn).
        seg_idx = rng.randint(max(0, len(wp) // 2 - 1), max(0, len(wp) - 2))
        a = wp[seg_idx]
        b = wp[seg_idx + 1] if seg_idx + 1 < len(wp) else wp[seg_idx]
        t = rng.uniform(0.2, 0.9)
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        # Small perpendicular jitter so kills don't all stack on the centre line
        x += rng.uniform(-80, 80)
        y += rng.uniform(-80, 80)
        return self._clamp(map_meta, x, y)

    def _utility_landing(
        self,
        rng: random.Random,
        map_meta: MapMetadata,
        team: str,
        target_site: str,
    ) -> tuple[float, float]:
        """Pick a chokepoint waypoint where a smoke/molotov would actually land."""
        wp = self._pick_waypoints(rng, map_meta, team, target_site)
        # Util lands in the middle of the corridor (chokepoints, not spawn or site).
        if len(wp) >= 3:
            anchor = wp[rng.randint(1, len(wp) - 2)]
        else:
            anchor = wp[0]
        return self._clamp(
            map_meta,
            anchor[0] + rng.uniform(-90, 90),
            anchor[1] + rng.uniform(-90, 90),
        )

    def _clamp(
        self, map_meta: MapMetadata, x: float, y: float
    ) -> tuple[float, float]:
        return (
            max(map_meta.world_min_x, min(map_meta.world_max_x, x)),
            max(map_meta.world_min_y, min(map_meta.world_max_y, y)),
        )

    def _walk_along_waypoints(
        self,
        rng: random.Random,
        waypoints: list[tuple[float, float]],
        frame_count: int,
        map_meta: MapMetadata,
    ) -> list[tuple[float, float]]:
        """
        Smooth path of ``frame_count`` positions along the waypoint sequence.

        Distance-parameterized so corridor segments of different lengths are
        traversed at consistent speed. Adds:
        - ``hold_at``: some players stop partway and hold (anchor in cover)
        - perpendicular jitter (small) so the line doesn't look like a wire
        - approach-decay so jitter shrinks near the goal (settling into site)
        """
        if len(waypoints) < 2:
            return [waypoints[0]] * frame_count if waypoints else [(0.0, 0.0)] * frame_count

        # Segment lengths
        seg_lens = [
            math.hypot(waypoints[i + 1][0] - waypoints[i][0],
                       waypoints[i + 1][1] - waypoints[i][1])
            for i in range(len(waypoints) - 1)
        ]
        total_len = sum(seg_lens) or 1.0

        # 30% of players hold partway, simulating defenders/lurkers
        hold_at = rng.uniform(0.55, 0.92) if rng.random() < 0.3 else 1.0

        # Perpendicular jitter parameters
        jitter_amp = rng.uniform(15, 60)  # tight — stays in corridor
        phase = rng.uniform(0, 2 * math.pi)
        freq = rng.uniform(1.5, 3.5)

        out: list[tuple[float, float]] = []
        for f in range(frame_count):
            u_raw = f / max(1, frame_count - 1)
            u = min(u_raw, hold_at) / hold_at  # 0..1 along the corridor
            target_dist = u * total_len

            # Find current segment
            accum = 0.0
            seg_idx = 0
            while seg_idx < len(seg_lens) - 1 and accum + seg_lens[seg_idx] < target_dist:
                accum += seg_lens[seg_idx]
                seg_idx += 1
            sl = seg_lens[seg_idx] or 1.0
            seg_t = (target_dist - accum) / sl
            ax, ay = waypoints[seg_idx]
            bx, by = waypoints[seg_idx + 1]
            x = ax + (bx - ax) * seg_t
            y = ay + (by - ay) * seg_t

            # Perpendicular vector (normalized)
            dx, dy = bx - ax, by - ay
            seg_dist = math.hypot(dx, dy) or 1.0
            px, py = -dy / seg_dist, dx / seg_dist

            # Jitter — sinusoidal, decaying as the player approaches the goal
            decay = 1 - u * 0.6
            wiggle = math.sin(2 * math.pi * freq * (f / max(1, frame_count)) + phase)
            x += px * jitter_amp * wiggle * decay
            y += py * jitter_amp * wiggle * decay

            out.append(self._clamp(map_meta, x, y))
        return out
