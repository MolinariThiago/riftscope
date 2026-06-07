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
# This is the canonical CS2 SDK mapping. Some demos (FACEIT/community
# servers / older builds) ship with this inverted — we self-correct at
# parse time via _detect_team_orientation() and replace this dict for
# the rest of the run.
_TEAM_NUM_TO_SIDE = {2: "tt", 3: "ct"}
_TEAM_NUM_TO_SIDE_FLIPPED = {2: "ct", 3: "tt"}

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
_GRENADE_RADIUS = {"smoke": 144, "molotov": 135, "flash": 60, "he": 90}


# ---- Inventory grenade name normalisation ------------------------------
# demoparser2's ``inventory`` prop returns weapon strings that vary
# in style depending on the demo / parser version. Sometimes it's the
# engine name (``weapon_hegrenade``), sometimes the display name
# (``weapon_high_explosive``, ``weapon_incendiary``). The original
# inventory counter only matched exact engine names, so when the
# parser emitted display variants the grenade silently counted as 0
# and the player's feed showed empty slots — even though they were
# clearly holding the grenade in the demo.
#
# Every known variant maps to one of six canonical keys that the
# frontend's ``SLOT_ICONS`` understands.
_GRENADE_INVENTORY_ALIASES: dict[str, str] = {
    # HE
    "hegrenade":              "hegrenade",
    "he_grenade":             "hegrenade",
    "hegren":                 "hegrenade",
    "high_explosive":         "hegrenade",
    "high_explosive_grenade": "hegrenade",
    "highexplosive":          "hegrenade",
    "highexplosivegrenade":   "hegrenade",
    "hegrenadeprojectile":    "hegrenade",
    "he":                     "hegrenade",
    # Smoke
    "smokegrenade":           "smokegrenade",
    "smoke_grenade":          "smokegrenade",
    "smoke":                  "smokegrenade",
    "smokegrenadeprojectile": "smokegrenade",
    # Flash
    "flashbang":              "flashbang",
    "flash_grenade":          "flashbang",
    "flashgrenade":           "flashbang",
    "flash":                  "flashbang",
    "flashbangprojectile":    "flashbang",
    # Molotov (T-side fire grenade)
    "molotov":                "molotov",
    "molotov_grenade":        "molotov",
    "molotovgrenade":         "molotov",
    "molotovprojectile":      "molotov",
    # Incendiary (CT-side fire grenade)
    "incgrenade":             "incgrenade",
    "incendiary":             "incgrenade",
    "incendiary_grenade":     "incgrenade",
    "incendiarygrenade":      "incgrenade",
    "inferno":                "incgrenade",
    "firebomb":               "incgrenade",
    # Decoy
    "decoy":                  "decoy",
    "decoy_grenade":          "decoy",
    "decoygrenade":           "decoy",
    "decoyprojectile":        "decoy",
}


def _canonical_grenade_key(raw: str) -> str | None:
    """Normalise a raw inventory item name to a canonical grenade key.

    Resolution order matches the frontend's ``liveGrenadeKey``:
      1. Exact match against the alias table.
      2. Prefix-based fallback for parser variants we haven't seen
         explicitly yet — tight enough not to false-positive on
         real firearm names.
    Returns ``None`` when the item isn't a grenade.
    """
    if not isinstance(raw, str):
        return None
    n = raw.replace("weapon_", "").lower()
    # Strip spaces and dashes; keep underscores so engine-style names
    # like ``he_grenade`` survive intact for the alias lookup.
    n = n.replace(" ", "").replace("-", "")
    if n in _GRENADE_INVENTORY_ALIASES:
        return _GRENADE_INVENTORY_ALIASES[n]
    # Prefix fallback. No firearm starts with these prefixes, so
    # we won't accidentally classify an AK / pistol as a grenade.
    if n.startswith("smoke"):
        return "smokegrenade"
    if n.startswith("flash"):
        return "flashbang"
    if n.startswith("high") or n.startswith("hegren") or n.startswith("he_"):
        return "hegrenade"
    if (
        n.startswith("incendiary")
        or n.startswith("ince")
        or n.startswith("inferno")
        or n.startswith("firebomb")
        or n.startswith("inc_")
    ):
        return "incgrenade"
    if n.startswith("molotov"):
        return "molotov"
    if n.startswith("decoy"):
        return "decoy"
    return None


class RealDemoParser:
    """Real CS2 .dem parser via demoparser2."""

    def parse(self, demo_path: str | Path) -> dict[str, Any]:
        from demoparser2 import DemoParser  # imported lazily

        path = str(demo_path)
        logger.info("real parser starting on %s", path)
        parser = DemoParser(path)

        # ---- Identity / header ------------------------------------------------
        # Both parse_header() and parse_player_info() can throw
        # EntityNotFound or similar prop errors on malformed /
        # truncated demos. Wrap both with defensive fallbacks so we
        # surface a clearer "this demo file is malformed" error
        # instead of the bare ``EntityNotFound`` the user saw.
        try:
            header = parser.parse_header()
        except Exception as exc:
            logger.warning("parse_header failed: %s — using empty header", exc)
            header = {}
        map_name = header.get("map_name") or "unknown"

        try:
            player_info = parser.parse_player_info()
        except Exception as exc:
            raise RuntimeError(
                "demoparser2 couldn't read the player roster from this "
                "file — the demo is probably truncated or from an "
                "unsupported CS2 build. "
                f"Underlying error: {type(exc).__name__}: {exc}"
            ) from exc
        # team_number column maps to side. CS2 uses {2: T, 3: CT};
        # {0: unassigned, 1: spectator, including coaches} are NOT
        # playable. The previous code coerced spectators to "ct"
        # via the fallback, which silently included the team
        # coach as a 6th CT — their static spec position then
        # became a fake "thrower position" for any event that
        # got mis-attributed to their steamid, producing long
        # ghost utility tracers from a random map location (the
        # user's repeated "trayectorias random" complaint with
        # 5-man + coach demos).
        #
        # Strict filter: only steamids whose team_number is 2 or 3
        # land in players_meta. Coaches / casters / observers get
        # silently dropped. Their steamids in events
        # (inferno_startburn / weapon_fire / etc.) then have no
        # players_meta entry, so downstream code skips them
        # cleanly.
        players_meta: dict[str, dict[str, Any]] = {}
        playable_team_nums = {2, 3}
        for _, row in player_info.iterrows():
            sid = str(row["steamid"])
            team_num = _safe_int(row.get("team_number"))
            if team_num not in playable_team_nums:
                logger.debug(
                    "skipping non-playable steamid %s (team_num=%d, name=%s)",
                    sid, team_num, row.get("name"),
                )
                continue
            players_meta[sid] = {
                "steamId": sid,
                "name": str(row["name"]),
                "team": _TEAM_NUM_TO_SIDE.get(team_num, "ct"),
            }

        # Fallback: some demos (truncated downloads, demos captured
        # mid-warmup, certain HLTV-hosted bundles) make
        # ``parse_player_info()`` return a snapshot where every
        # player still has team_number=0 (unassigned). The strict
        # filter then empties players_meta and the radar renders
        # with no player markers at all — exactly the symptom in
        # the user's first screenshot.
        #
        # When we see an empty players_meta but the player_info
        # frame DID return rows, relax to: include every non-
        # spectator (team_number != 1). Players still get
        # team-assigned via per-tick ``team_num`` later, so the
        # downstream code stays correct; this just stops the
        # filter from silently dropping the whole roster.
        if not players_meta and player_info is not None and len(player_info) > 0:
            logger.warning(
                "parse_player_info returned %d rows but strict team_number "
                "filter (2/3) emptied players_meta — falling back to "
                "non-spectator filter (team_number != 1).",
                len(player_info),
            )
            for _, row in player_info.iterrows():
                sid = str(row["steamid"])
                team_num = _safe_int(row.get("team_number"))
                # Skip true spectators (1) and missing-id rows.
                if team_num == 1 or not sid:
                    continue
                players_meta[sid] = {
                    "steamId": sid,
                    "name": str(row["name"]),
                    # Default to CT — per-tick team mapping later
                    # corrects this for events that carry team info.
                    "team": _TEAM_NUM_TO_SIDE.get(team_num, "ct"),
                }
            logger.info(
                "fallback recovered %d players from non-spectator filter",
                len(players_meta),
            )

        # Diagnostic: this number is the second thing the operator
        # checks when a parse fails the quality gate ("only N players
        # detected"). Less than 10 here means either ``parse_player_info``
        # came back short or the spectator filter consumed too many
        # rows.  10 is the expected baseline (5v5).
        logger.info("players_meta finalised: %d players", len(players_meta))

        # ---- Rounds ----------------------------------------------------------
        round_ends = _safe_event(parser, "round_end")
        # CS2 fires a round_end at tick ≈0 for warmup/restart. Drop rounds with
        # no recorded freeze_end.
        round_starts = _safe_event(parser, "round_freeze_end")
        # round_start fires when the FREEZE PERIOD begins (buy time
        # starts). round_officially_ended fires after the post-round
        # freeze (5 s after the win condition). Used below to
        # extend each round's tick range so the timeline covers
        # FREEZE + PLAY + POST instead of just the play portion —
        # the user reported "rondas terminan antes de q termine
        # de verdad" because the previous build cut off the
        # instant round_end fired.
        round_starts_full = _safe_event(parser, "round_start")
        round_officially_ended_df = _safe_event(parser, "round_officially_ended")

        rounds = self._build_rounds(round_starts, round_ends)
        # Estimate tickrate: CS2 standard match is 64 tick. Non-standard demos
        # can be 128. Estimate from round duration in ticks vs seconds.
        tickrate = self._estimate_tickrate(rounds)
        # Extend each round's tick range to cover the full
        # freeze + play + post window. Preserves the original
        # play range as ``playStartTick`` / ``playEndTick`` so
        # downstream code that needs the gameplay window
        # (loadouts, win-condition checks) still has it.
        self._augment_rounds_freeze_post(
            rounds, round_starts_full, round_officially_ended_df, tickrate,
        )
        for r in rounds:
            r["durationSeconds"] = max(1, int((r["endTick"] - r["startTick"]) / tickrate))

        # Drop warmup / restart artifacts and truncate at the actual match
        # end. CS2 demos commonly emit extra round_end events for the
        # warmup, knife round, and OT restarts which inflated the final
        # score (e.g. a 13-8 game showing up as 16-8).
        rounds = self._trim_to_match_window(rounds)

        # Sanity warning: a real CS2 match is at minimum ~13 rounds
        # (MR12 13-0 sweep). When we land with fewer than 8 rounds,
        # either the demo file is truncated (HLTV sometimes serves
        # an incomplete .rar) or our round-pairing is missing
        # something. Surface it so the operator can decide whether
        # to re-import. Doesn't change behaviour — diagnostic only.
        if 0 < len(rounds) < 8:
            try:
                _starts = len(round_starts) if round_starts is not None else 0
                _ends = len(round_ends) if round_ends is not None else 0
            except Exception:
                _starts = _ends = -1
            logger.warning(
                "demo parsed with only %d rounds (raw freeze_end events: %d, "
                "round_end events: %d) — demo may be truncated or have "
                "malformed round events.",
                len(rounds), _starts, _ends,
            )

        # ---- Kills -----------------------------------------------------------
        deaths_df = _safe_event(parser, "player_death")
        kills_raw = deaths_df.to_dict(orient="records") if deaths_df is not None else []

        # ---- Damage events (for real ADR + utility damage) ------------------
        # ``player_hurt`` fires for every damage tick (bullets, grenades,
        # knife, etc.). On a 30-minute Bo3 game this can be 200k-500k
        # rows. We DO NOT materialise it as a Python list-of-dicts here
        # — that copy is enough to OOM-kill the worker on Railway Hobby
        # (512 MB) and leave the demo stuck in ``processing``
        # forever. The aggregator iterates the DataFrame directly with
        # vectorised pandas ops (C-level, ~constant peak memory).
        hurt_df = _safe_event(parser, "player_hurt")

        # ---- Shots (weapon_fire events) -------------------------------------
        # Each shot becomes a tiny tracer line on the radar so the viewer
        # can see every bullet fired in a round — not just the kill shots.
        fires_df = _safe_event(parser, "weapon_fire")
        fires_raw = fires_df.to_dict(orient="records") if fires_df is not None else []

        # ---- Bomb events -----------------------------------------------------
        bomb_planted_df = _safe_event(parser, "bomb_planted")
        bomb_defused_df = _safe_event(parser, "bomb_defused")
        bomb_exploded_df = _safe_event(parser, "bomb_exploded")

        # ---- Weapon floor pickups -------------------------------------------
        # item_pickup(silent=False) = picked up from the FLOOR (not bought).
        # Used to remove the dropped-weapon icon when someone picks it up.
        item_pickup_df = _safe_event(parser, "item_pickup")

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
        # ``velocity_Z`` powers the isJumping heuristic (CS2 jump velocity is
        # ~260 u/s on jump start; we use 100 as a noise-resistant threshold).
        wanted_props = [
            "X", "Y", "Z", "yaw",
            "is_alive", "health", "armor_value",
            "team_num", "active_weapon_name", "balance",
            "has_helmet", "has_defuser",
            "velocity_Z",
            # Clan / team name per player — the foundation of all
            # "anti-strat" features (which are per-TEAM, not per-side).
            # Best-effort: older demoparser2 builds that don't expose it
            # are handled by the cascading-prop fallback below, leaving
            # clans empty (team identity simply unknown for that demo).
            "team_clan_name",
            # Vertical look angle — needed for setang (smoke-lineup command).
            "pitch",
            # Official per-team round counter (the real scoreboard). Lets us
            # report the final score PER TEAM instead of tallying wins per
            # side, which is wrong after the halftime swap (produces scores
            # like "12-3" that map to no team). Best-effort: dropped by the
            # cascading fallback on older demoparser2 builds.
            "team_rounds_total",
            # ``inventory`` is a list-of-strings per player per tick
            # containing every weapon / grenade currently held. We
            # use it at the start of each round to seed the grenade
            # counts in PlayerLoadout (max 2 flashes + 1 smoke + 1 HE
            # + 1 molotov/inc + 1 decoy per player). Older
            # demoparser2 versions may not expose this prop — the
            # except branch below strips it and the loadout falls
            # back to the legacy "no grenade data" state.
            "inventory",
        ]
        # Defensive cascading parse_ticks. demoparser2 raises
        # EntityNotFound (and similar prop-name errors) when ANY
        # requested prop doesn't exist on the entities in the demo.
        # Different CS2 patch versions, malformed demos and older
        # demoparser2 builds all hit this. We try the full prop set
        # first, then strip progressively until something works (or
        # we run out).
        ticks = None
        cascade: list[list[str]] = [
            # Tier 1 — full props (modern demo + modern demoparser2)
            list(wanted_props),
            # Tier 2 — drop the optional-richness props (matches
            # the previous fallback exactly so behaviour is
            # unchanged on demos that worked before).
            [
                p for p in wanted_props
                if p not in (
                    "active_weapon_name",
                    "has_helmet",
                    "has_defuser",
                    "velocity_Z",
                    "inventory",
                )
            ],
            # Tier 3 — also drop has_helmet / armor / balance /
            # etc. Keeps only what we ABSOLUTELY need for the
            # timeline.
            ["X", "Y", "yaw", "is_alive", "health", "team_num"],
            # Tier 4 — bare minimum. Position + alive flag. The
            # pipeline can still render a basic 2D map of moving
            # dots even without HP / weapon / armor data.
            ["X", "Y", "is_alive", "team_num"],
        ]
        last_exc: Exception | None = None
        for tier_idx, props in enumerate(cascade):
            if not props:
                continue
            try:
                ticks = parser.parse_ticks(props)
                if tier_idx > 0:
                    logger.warning(
                        "demo parse_ticks fell back to tier %d (%d props)",
                        tier_idx + 1, len(props),
                    )
                break
            except Exception as exc:
                last_exc = exc
                logger.debug(
                    "parse_ticks tier %d failed (%d props): %s",
                    tier_idx + 1, len(props), exc,
                )
                continue
        if ticks is None:
            # Tier 5 — per-prop probe. We don't know WHICH specific
            # prop is unsupported in this demo (different CS2 build,
            # malformed dump, demoparser2 version drift), so try
            # each prop in isolation and keep the ones that work.
            # Slow (N parse_ticks calls) but resilient: even one
            # working prop is enough to produce SOME timeline.
            logger.warning(
                "all parse_ticks tiers failed — falling back to "
                "per-prop probing to find any usable subset"
            )
            working_props: list[str] = []
            failing_props: list[str] = []
            for p in wanted_props:
                try:
                    parser.parse_ticks([p])
                    working_props.append(p)
                except Exception:
                    failing_props.append(p)
            if working_props:
                try:
                    ticks = parser.parse_ticks(working_props)
                    logger.warning(
                        "parse_ticks recovered with %d/%d props (dropped: %s)",
                        len(working_props), len(wanted_props),
                        ", ".join(failing_props),
                    )
                except Exception as exc:
                    last_exc = exc
                    ticks = None
        if ticks is None:
            # Even per-prop probing yielded nothing. Surface a
            # clearer error so the upload UI doesn't just say
            # "EntityNotFound" with no context.
            raise RuntimeError(
                "demoparser2 rejected every prop we tried "
                f"({len(wanted_props)} attempted). The demo is "
                "probably truncated, malformed, or from an "
                "unsupported CS2 build. Last error: "
                f"{type(last_exc).__name__}: {last_exc}"
            )

        # Index per tick → per steamid for fast lookup later.
        # ticks DataFrame columns: tick, steamid, X, Y, Z, yaw, is_alive,
        # health, team_num, balance, ...
        ticks["steamid"] = ticks["steamid"].astype(str)

        # ---- Multi-signal observer filter ----
        # The previous team_num==1 filter catches most coaches,
        # but some demos still slip a coach / observer through
        # with team_num 2 or 3 (mis-registered, spec swap, parser
        # quirk). Their static spec-cam position then anchors
        # every ghost tracer in the demo (the user's "X en el
        # medio del mapa de donde salen todas las molotovs"
        # complaint that survived the basic filter).
        #
        # Score every steamid by FOUR signals — alive-tick count,
        # position range, weapon_fire count, kill/death involvement.
        # A REAL player scores high on all four (is alive at the
        # start of every round, moves a lot, shoots often, appears
        # in kills). A coach / observer scores zero on `alive`
        # because spectators are NEVER `is_alive=True` at any
        # tick, regardless of how active their spec camera is.
        #
        # `is_alive` is the strongest signal — it can't be spoofed
        # by an active spec cam (the previous bug: a coach
        # following different players each round had high
        # pos_range and slipped past the old 3-signal test).
        #
        # Final guard: enforce CS2's 5v5 cap PER SIDE. If a side
        # ends up with 6+ entries, drop the lowest-activity extras
        # so we never emit a 5v6 frame.
        if players_meta:
            try:
                # 1. Alive-tick count per steamid. Real players are
                # is_alive=True for ~80% of round ticks; coaches /
                # spectators NEVER have a True alive tick.
                #
                # ``has_alive_signal`` gates whether we can USE this
                # check at all — if parse_ticks fell back to a tier
                # that omits is_alive, EVERY steamid would have
                # alive_count=0 and we'd erroneously drop the whole
                # roster. In that case we silently skip the
                # alive-based check and rely on the 3-signal
                # fallback alone.
                alive_count: dict[str, int] = defaultdict(int)
                has_alive_signal = "is_alive" in ticks.columns
                if has_alive_signal:
                    alive_rows = ticks[ticks["is_alive"] == True]  # noqa: E712
                    if len(alive_rows) > 0:
                        for sid_idx, count in alive_rows.groupby("steamid").size().items():
                            alive_count[str(sid_idx)] = int(count)
                    else:
                        # is_alive column present but all False —
                        # corrupt / unusable signal. Disable the
                        # alive-based check.
                        has_alive_signal = False
                # 2. Position range per steamid.
                pos_range: dict[str, float] = {}
                if "X" in ticks.columns and "Y" in ticks.columns:
                    grp = ticks.groupby("steamid").agg(
                        x_min=("X", "min"),
                        x_max=("X", "max"),
                        y_min=("Y", "min"),
                        y_max=("Y", "max"),
                    )
                    for sid_idx, row_grp in grp.iterrows():
                        sid_str = str(sid_idx)
                        pos_range[sid_str] = (
                            abs(row_grp["x_max"] - row_grp["x_min"])
                            + abs(row_grp["y_max"] - row_grp["y_min"])
                        )
                # 3. weapon_fire count per shooter.
                fire_count: dict[str, int] = defaultdict(int)
                for f in fires_raw:
                    fsid = str(f.get("user_steamid") or "")
                    if fsid:
                        fire_count[fsid] += 1
                # 4. Kill involvement (killer or victim).
                kill_count: dict[str, int] = defaultdict(int)
                for k in kills_raw:
                    atk = str(k.get("attacker_steamid") or "")
                    vic = str(k.get("user_steamid") or "")
                    if atk:
                        kill_count[atk] += 1
                    if vic:
                        kill_count[vic] += 1

                # Hard observer test — ANY of the following marks
                # a steamid as a non-player:
                #   a) Zero alive ticks across the entire demo
                #      (definitive coach / spectator signal).
                #   b) Fails all three secondary signals (low
                #      movement, no shots, no kill involvement)
                #      — kept as a defensive net for demos where
                #      is_alive isn't available / is corrupt.
                observer_sids: set[str] = set()
                for sid in list(players_meta.keys()):
                    ac = alive_count.get(sid, 0)
                    pr = pos_range.get(sid, 0.0)
                    fc = fire_count.get(sid, 0)
                    kc = kill_count.get(sid, 0)
                    # Primary signal: never alive ⇒ never a player.
                    # Gated on has_alive_signal so demos missing the
                    # is_alive column don't lose their whole roster.
                    if has_alive_signal and ac == 0:
                        observer_sids.add(sid)
                        continue
                    # Secondary signal (legacy 3-signal fallback).
                    if pr < 500.0 and fc == 0 and kc == 0:
                        observer_sids.add(sid)
                if observer_sids:
                    logger.warning(
                        "dropping %d observer/coach steamid(s) "
                        "(no alive ticks / no shots / no kills): %s",
                        len(observer_sids), ", ".join(sorted(observer_sids)),
                    )
                    for sid in observer_sids:
                        players_meta.pop(sid, None)

                # Per-side 5-player cap. A demo where a coach
                # passes the alive-tick test (impossible in
                # practice, but defensive) would still leak a
                # 6th entry on ONE side, even if total count is
                # ≤ 10. Trim each side independently so we never
                # emit a 5v6 frame.
                #
                # Activity score weights `alive_count` heavily —
                # a coach who somehow got past the alive=0 test
                # would still have far fewer alive ticks than any
                # real player (who is alive for ~80% of the demo).
                def _activity_score(sid: str) -> float:
                    return (
                        alive_count.get(sid, 0) * 10.0
                        + pos_range.get(sid, 0.0)
                        + fire_count.get(sid, 0) * 1000.0
                        + kill_count.get(sid, 0) * 5000.0
                    )

                for side in ("ct", "tt"):
                    side_sids = [
                        sid for sid, m in players_meta.items()
                        if m["team"] == side
                    ]
                    if len(side_sids) > 5:
                        ranked = sorted(
                            side_sids, key=_activity_score, reverse=True,
                        )
                        drop_sids = set(ranked[5:])
                        logger.warning(
                            "trimming %d extra %s steamid(s) "
                            "(over 5-player side cap, lowest activity): %s",
                            len(drop_sids), side.upper(),
                            ", ".join(sorted(drop_sids)),
                        )
                        for sid in drop_sids:
                            players_meta.pop(sid, None)
            except Exception:
                logger.debug("observer-filter failed", exc_info=True)

        # Hard-filter the tick stream to playable steamids only.
        # players_meta was already filtered to exclude coaches /
        # spectators above, so any steamid NOT in players_meta is
        # a non-playable observer whose position rows would
        # otherwise leak into downstream consumers
        # (trajectory matcher, kill event lookups, player frame
        # generation, position lookups). Filtering here once is
        # cheaper + more robust than checking at every call site.
        if players_meta:
            playable_sids = set(players_meta.keys())
            ticks = ticks[ticks["steamid"].isin(playable_sids)]

        # Resolve the team_num → side mapping for THIS demo before anyone
        # uses it. Canonical CS2 is {2:T, 3:CT}; FACEIT and a handful of
        # community servers ship demos with the opposite convention, so
        # we sniff the round-1 freeze-end spawn positions to decide.
        team_num_to_side = _detect_team_orientation(
            ticks, rounds, map_name, bomb_planted_df=bomb_planted_df,
        )

        # ---- Rebuild players_meta with the (now-verified) orientation ---
        # ``parse_player_info`` already populated players_meta with the
        # canonical mapping; if the orientation flipped, we need to swap
        # every player's recorded "team" so the downstream stats line up.
        if team_num_to_side is _TEAM_NUM_TO_SIDE_FLIPPED:
            for sid, info in players_meta.items():
                info["team"] = "ct" if info["team"] == "tt" else "tt"

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

        # ---- Build shot events with position + yaw + per-tick team ----------
        shots = self._build_shots(
            fires_raw, ticks, rounds, players_meta,
            team_num_to_side=team_num_to_side,
        )

        # ---- Team identity (Phase 0): resolve each player's clan name -------
        # Clan is constant per player across the match, so one non-empty
        # value per steamid is enough. Best-effort + guarded: a missing
        # column (older parser build) just leaves clans unset.
        try:
            if ticks is not None and "team_clan_name" in getattr(ticks, "columns", []):
                cl = ticks[["steamid", "team_clan_name"]].dropna().copy()
                cl["team_clan_name"] = cl["team_clan_name"].astype(str).str.strip()
                cl = cl[(cl["team_clan_name"] != "") & (cl["team_clan_name"].str.lower() != "nan")]
                cl = cl.drop_duplicates("steamid")
                clan_by_sid = dict(zip(cl["steamid"].astype(str), cl["team_clan_name"]))
                for _sid, _m in players_meta.items():
                    if _sid in clan_by_sid:
                        _m["clan"] = clan_by_sid[_sid]
        except Exception as _exc:  # pragma: no cover — defensive
            logger.debug("clan extraction skipped: %s", _exc)

        # ---- Players summary stats (computed from kills + tick samples) -----
        # Aggregate real data first: damage (player_hurt), assists +
        # flash-assists + per-round K/A/S/T flags (from the enriched
        # kill list). The result feeds ``_build_players`` with real
        # numbers — no more 0-hardcoded assists / formula ADR / fake
        # KAST.
        agg = self._aggregate_player_stats(
            players_meta, kills, hurt_df, rounds, tickrate,
        )
        players = self._build_players(players_meta, kills, len(rounds), agg)

        # ---- Score (from rounds) --------------------------------------------
        ct_score = sum(1 for r in rounds if r["winner"] == "ct")
        tt_score = sum(1 for r in rounds if r["winner"] == "tt")
        # Verbose round-by-round dump so we can diagnose mismatches
        # between the parser's score and what the user saw in the demo.
        round_summary = ", ".join(f"R{r['number']}:{r['winner']}" for r in rounds)
        logger.info(
            "Final score: CT=%d, TT=%d (%d rounds kept). Rounds: %s",
            ct_score, tt_score, len(rounds), round_summary,
        )

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
        # CS2 demos DO NOT expose ``molotov_detonate`` — only
        # ``inferno_startburn`` (one event per fire patch). Verified
        # via ``DemoParser.list_game_events()`` on a CS2 demo: only
        # ``inferno_startburn`` and ``inferno_expire`` are emitted
        # for molotov-class nades. So we use inferno_startburn as
        # the detonate proxy, group patches per throw, and link each
        # group back to the actual projectile via a matcher (since
        # inferno's entityid points at the inferno entity, NOT the
        # projectile, unlike the other ``*_detonate`` events).
        molotovs = _safe_event(parser, "inferno_startburn")
        try:
            grenade_throws = parser.parse_grenades()
        except Exception:
            grenade_throws = None

        grenade_events_per_round = self._build_grenade_events(
            smokes, flashes, hes, molotovs, grenade_throws,
            rounds, players_meta, tickrate, ticks,
            fires_raw=fires_raw,
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
            shots=shots,
            team_num_to_side=team_num_to_side,
            item_pickup_df=item_pickup_df,
        )

        # Team names: A = the clan that started on CT, B = started on T.
        # (players_meta["team"] holds each player's FIRST-HALF side.)
        def _mode_clan(side: str) -> str | None:
            counts: dict[str, int] = {}
            for _m in players_meta.values():
                clan = _m.get("clan")
                if _m.get("team") == side and clan:
                    counts[clan] = counts.get(clan, 0) + 1
            return max(counts, key=counts.get) if counts else None

        team_a = _mode_clan("ct")
        team_b = _mode_clan("tt")
        # Final score PER TEAM from the game's own counter, NOT a per-side
        # tally. After the halftime swap "rounds won by CT" belong to a
        # different team in each half, so summing per side gives impossible
        # scores like 12-3. team_rounds_total is the official scoreboard and
        # already accounts for the swap + overtime.
        score_by_clan = self._final_score_by_clan(ticks)
        score_a = score_by_clan.get(team_a) if team_a else None
        score_b = score_by_clan.get(team_b) if team_b else None
        if score_a is None or score_b is None:
            # Counter unavailable (older demoparser2) — fall back to the
            # per-side tally so we still surface something.
            score_a, score_b = ct_score, tt_score
        total_rounds = (score_a + score_b) if (score_a + score_b) > 0 else len(rounds)

        meta = {
            "map": map_name,
            "tickrate": tickrate,
            "durationSeconds": sum(r["durationSeconds"] for r in rounds),
            "roundCount": total_rounds,
            "score": [score_a, score_b],         # PER TEAM: [teamA, teamB]
            "scoreBySide": [ct_score, tt_score],  # legacy per-side tally (CT, T)
            "teamA": team_a,
            "teamB": team_b,
        }

        # Cleanup helpers — drop internals before returning rounds.
        for r in rounds:
            r.pop("_winner_team_num", None)

        logger.info(
            "real parse complete: %s, %d rounds, %d kills, %d players, score=%s:%s",
            map_name, len(rounds), len(kills), len(players), score_a, score_b,
        )

        # ---- Quality gate ---------------------------------------------------
        # CS2 matches need at least 13 rounds (MR12 — first to 13 wins) and
        # exactly 10 playable players. Demos that come back with less are
        # almost always malformed: cut short, missing chunks, or a half
        # downloaded .rar. Marking them ``completed`` was producing the
        # "no players" / "only 2 rounds" cards the user kept reporting.
        # Raise instead so the subprocess wrapper marks them ``failed``
        # with a clear error message — much better signal than a broken
        # success state.
        _validate_parse_quality(
            map_name=map_name,
            rounds=len(rounds),
            players=len(players),
            score_a=score_a,
            score_b=score_b,
        )

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
    def _final_score_by_clan(ticks) -> dict[str, int]:
        """Official final score per clan, from ``team_rounds_total`` at the
        last tick. Robust to the halftime side swap + overtime because it
        reads the game's own scoreboard rather than tallying rounds per side.
        Returns {} when the counter isn't available."""
        try:
            cols = getattr(ticks, "columns", [])
            if ticks is None or "team_rounds_total" not in cols or "team_clan_name" not in cols:
                return {}
            last_tick = ticks["tick"].max()
            sub = ticks[ticks["tick"] == last_tick][["team_clan_name", "team_rounds_total"]]
            out: dict[str, int] = {}
            for _, row in sub.iterrows():
                clan = row.get("team_clan_name")
                if clan is None or _is_nan(clan):
                    continue
                clan = str(clan).strip()
                if not clan or clan.lower() == "nan":
                    continue
                try:
                    won = int(row.get("team_rounds_total"))
                except (TypeError, ValueError):
                    continue
                # A clan spans 5 player rows at the last tick; they all carry
                # the same team counter — keep the max defensively.
                out[clan] = max(out.get(clan, 0), won)
            return out
        except Exception as exc:  # pragma: no cover — defensive
            logger.debug("final score by clan failed: %s", exc)
            return {}

    @staticmethod
    def _build_rounds(starts_df, ends_df) -> list[dict]:
        """
        Pair freeze_end ticks with round_end ticks into ordered rounds.

        Pairing strategy: walk freeze_end events in order, and for each one
        pick the FIRST round_end that fires strictly after it AND before
        the next freeze_end. Any extra round_end events that land before
        the next freeze_end are discarded as spurious (CS2 occasionally
        emits a second round_end during restarts, warmup echoes, or
        knife rounds — the old "max freeze_end before each round_end"
        pairing was reusing the same start for both, producing two
        overlapping rounds where the spurious short one cut the real
        round visually mid-way through. The user saw this as "rondas
        terminan antes de q la ronda termine de verdad").

        Notes on CS2 demos:
          - The ``round`` field on round_end is unreliable; it can repeat
            during knife/restart sequences, so we re-number by tick order
            instead of trusting the source numbering.
          - Warmup rounds emit fake ``round_end`` events with empty winners
            or sub-second durations — we filter those out here.
          - Final trimming (cumulative-score gate, OT handling) happens in
            ``_trim_to_match_window`` after the parent computes tickrate.
        """
        if ends_df is None or len(ends_df) == 0:
            return []

        # 1. Normalise the ends_df into a list of (tick, winner) tuples,
        # dropping rows with missing/invalid winner data up front.
        ends: list[tuple[int, str]] = []
        for _, row in ends_df.iterrows():
            try:
                end_tick = int(row["tick"])
            except (TypeError, ValueError):
                continue
            # pandas returns NaN (a float) for missing string cells —
            # NOT None. The old ``or ""`` short-circuit treated NaN
            # as truthy and .upper() blew up on AttributeError.
            winner_val = row.get("winner")
            if winner_val is None or _is_nan(winner_val) or not isinstance(winner_val, str):
                continue
            winner_raw = winner_val.upper()
            winner = "ct" if winner_raw == "CT" else "tt" if winner_raw == "T" else None
            if winner is None:
                continue
            ends.append((end_tick, winner))
        ends.sort(key=lambda x: x[0])

        starts_ticks: list[int] = sorted(
            int(t) for t in (starts_df["tick"].tolist() if starts_df is not None else [])
        )
        if not starts_ticks:
            return []

        # 2. Walk freeze_end ticks in order. For each freeze_end, the
        # associated round_end is the first round_end strictly after
        # it that is ALSO strictly before the next freeze_end. The
        # ``ei`` cursor over ``ends`` ensures every round_end is used
        # at most once and every spurious extra round_end (firing
        # BEFORE the next freeze_end) is silently discarded.
        raw: list[dict] = []
        ei = 0
        for si, start_tick in enumerate(starts_ticks):
            next_start = starts_ticks[si + 1] if si + 1 < len(starts_ticks) else 10**18
            # Skip any ends that landed before this freeze_end — they
            # belong to an earlier round we already paired, or to a
            # warmup echo that never had a freeze_end of its own.
            while ei < len(ends) and ends[ei][0] <= start_tick:
                ei += 1
            if ei >= len(ends):
                break
            end_tick, winner = ends[ei]
            # The round_end must fire BEFORE the next freeze_end —
            # otherwise it belongs to the next round, not this one
            # (this happens when a freeze_end fires but no round_end
            # is recorded for it — e.g. demo recording stopped mid-
            # round).
            if end_tick >= next_start:
                continue
            # Drop sub-3 s "rounds" — knife round echoes, warmup
            # noise. A real CS2 round is always longer than 5 s
            # even on instant plants.
            if end_tick - start_tick < 3 * 64:
                ei += 1
                continue
            raw.append({
                "winner": winner,
                "startTick": start_tick,
                "endTick": end_tick,
                "_winner_team_num": 3 if winner == "ct" else 2,
            })
            # Advance past EVERY round_end that fired before the next
            # freeze_end. Any extras are the spurious double-emits
            # that used to leak through as ghost short rounds.
            ei += 1
            while ei < len(ends) and ends[ei][0] < next_start:
                ei += 1

        # 3. Renumber 1..N in tick order — ignores any source numbering.
        for i, r in enumerate(raw, start=1):
            r["number"] = i
        # Diagnostic: when the parse later fails the quality gate, this
        # number is the first thing to check.  A demo with 4 rounds
        # detected here will fail with "only 4 rounds detected" — and
        # the operator can correlate that against this log line to
        # see if it was a parser failure (low ``raw`` count) or a
        # trim failure (high ``raw`` count, low final count).
        logger.info(
            "rounds detected (pre-trim): %d freeze_end starts, %d round_end events, %d paired",
            len(starts_ticks), len(ends), len(raw),
        )
        return raw

    @staticmethod
    def _augment_rounds_freeze_post(
        rounds: list[dict],
        round_starts_full_df,
        official_ended_df,
        tickrate: int,
    ) -> None:
        """Extend each round's ``startTick`` / ``endTick`` to cover
        the full FREEZE + PLAY + POST window.

        Without this the timeline only covered the play portion (from
        round_freeze_end to round_end), so the viewer saw rounds end
        the instant a win condition was met — no post-round period,
        no pre-round freeze / buy phase. The user explicitly asked
        for both visible by default with a toggle to hide them.

        Mutates each round dict IN PLACE:
          • Records the original play range as ``playStartTick`` /
            ``playEndTick`` (loadout snapshots and any other code
            that needs the gameplay window still has it).
          • Overwrites ``startTick`` with the round_start tick
            (where freeze BEGINS) — falls back to ``startTick -
            20 s`` when round_start events aren't recorded.
          • Overwrites ``endTick`` with the round_officially_ended
            tick (where the post-round period ENDS) — falls back
            to ``endTick + 5 s`` when round_officially_ended
            events aren't recorded.
          • Records ``playStartT`` and ``playEndT`` in seconds
            relative to the new ``startTick`` so the timeline JSON
            can surface them to the frontend (which uses them to
            clamp playback when the user toggles the freeze/post
            view off).
        """
        FREEZE_DEFAULT_SEC = 20  # CS2 default freeze + buy time
        POST_DEFAULT_SEC = 5     # CS2 default post-round freeze

        rs_ticks: list[int] = (
            sorted(int(t) for t in round_starts_full_df["tick"].tolist())
            if round_starts_full_df is not None
            else []
        )
        oe_ticks: list[int] = (
            sorted(int(t) for t in official_ended_df["tick"].tolist())
            if official_ended_df is not None
            else []
        )

        for r in rounds:
            play_start = r["startTick"]
            play_end = r["endTick"]
            r["playStartTick"] = play_start
            r["playEndTick"] = play_end

            # Latest round_start at or before the play start. CS2
            # fires round_start when the freeze period begins, so
            # this gives us the buy-time origin.
            rs_candidates = [t for t in rs_ticks if t <= play_start]
            if rs_candidates:
                freeze_start = max(rs_candidates)
                # Safety clamp — don't pull the freeze start
                # absurdly far back if the events are mis-ordered
                # (max 30 s before the play start).
                freeze_start = max(freeze_start, play_start - 30 * tickrate)
            else:
                freeze_start = max(0, play_start - FREEZE_DEFAULT_SEC * tickrate)

            # Earliest round_officially_ended at or after the play
            # end. Also clamp so a missing event doesn't blow up.
            oe_candidates = [t for t in oe_ticks if t >= play_end]
            if oe_candidates:
                post_end = min(oe_candidates)
                post_end = min(post_end, play_end + 30 * tickrate)
            else:
                post_end = play_end + POST_DEFAULT_SEC * tickrate

            r["startTick"] = freeze_start
            r["endTick"] = post_end
            # Cached for downstream metadata emit.
            r["playStartT"] = round((play_start - freeze_start) / tickrate, 2)
            r["playEndT"] = round((play_end - freeze_start) / tickrate, 2)

    @staticmethod
    def _trim_to_match_window(rounds: list[dict]) -> list[dict]:
        """
        Keep every real round, in tick order, with a defensive hard cap.

        This used to truncate at the first time a side reached 13 (the MR12
        win condition). That was WRONG for scrim / training demos, which
        deliberately keep playing past 13 to practice — it silently dropped
        every round after the 13th (the user saw "1 round didn't load").

        We no longer need that cut:
          - warmup / knife / restart artifacts are already filtered upstream
            in ``_build_rounds`` (no valid CT/T winner, or sub-3s duration);
          - the match SCORE now comes from the game's ``team_rounds_total``
            counter, not from tallying these rounds, so extra rounds can't
            inflate it.

        So we just renumber 1..N and cap at 60 to guard against a runaway /
        corrupt demo (two matches concatenated into one .dem).
        """
        if not rounds:
            return rounds
        keep = rounds[:60]
        for i, r in enumerate(keep, start=1):
            r["number"] = i
        return keep

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
            # ``assister_steamid`` is the player credited with the
            # assist on this kill (empty / "0" / NaN when there was
            # none).  ``assistedflash`` is True when that assist was
            # earned via a flashbang.  Both feed the leaderboard's
            # real assists / flash-assists / KAST aggregation in
            # ``_aggregate_player_stats`` below.
            assister_raw = k.get("assister_steamid")
            if assister_raw is None or _is_nan(assister_raw):
                assister_sid = ""
            else:
                assister_sid = str(assister_raw).strip()
                if assister_sid in {"", "0"} or assister_sid not in players_meta:
                    assister_sid = ""
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
                "assister": assister_sid,
                "assistedFlash": bool(k.get("assistedflash") or False) and bool(assister_sid),
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
    def _build_shots(
        fires_raw: list[dict],
        ticks_df,
        rounds: list[dict],
        players_meta: dict,
        team_num_to_side: dict[int, str] | None = None,
    ) -> list[dict]:
        """Enrich weapon_fire events with shooter position, yaw, and
        CURRENT team (so colours stay right across the halftime swap).

        For each weapon_fire event we look up the shooter's
        (X, Y, yaw, team_num) at that tick from the ticks DataFrame.
        The yaw drives the directional line on the radar; the
        per-tick team_num is mapped through team_num_to_side so
        rounds 13+ render with the correct side colour even though
        the static PlayerStats.team still reflects the round-1 side.

        Returns: list of {tick, round, shooter, team, x, y, yaw, weapon}.
        """
        if not fires_raw or ticks_df is None or len(ticks_df) == 0:
            return []

        tn_map = team_num_to_side or {2: "tt", 3: "ct"}

        # Collect (tick, steamid) pairs we need to enrich.
        needed: set[tuple[int, str]] = set()
        for f in fires_raw:
            t = int(f.get("tick") or 0)
            sid = str(f.get("user_steamid") or "")
            if t and sid:
                needed.add((t, sid))

        wanted_ticks = {t for t, _ in needed}
        sub = ticks_df[ticks_df["tick"].isin(wanted_ticks)]
        # Lookup: (tick, sid) -> (X, Y, yaw, team_num)
        pos_lookup: dict[tuple[int, str], tuple[float, float, float, int]] = {}
        for _, row in sub.iterrows():
            key = (int(row["tick"]), str(row["steamid"]))
            if key in needed:
                pos_lookup[key] = (
                    float(row.get("X") or 0.0),
                    float(row.get("Y") or 0.0),
                    float(row.get("yaw") or 0.0),
                    _safe_int(row.get("team_num")),
                )

        out: list[dict] = []
        for f in fires_raw:
            t = int(f.get("tick") or 0)
            sid = str(f.get("user_steamid") or "")
            if not sid or sid not in players_meta:
                continue
            rnum = _which_round(t, rounds)
            if rnum is None:
                continue
            pos = pos_lookup.get((t, sid))
            if pos is None:
                continue
            x, y, yaw, tn = pos
            if x == 0.0 and y == 0.0:
                continue
            # Per-tick team — handles halftime side swap. Falls back
            # to the static player meta if team_num is unknown.
            team = tn_map.get(tn) or players_meta[sid]["team"]
            out.append({
                "tick": t,
                "round": rnum,
                "shooter": sid,
                "team": team,
                "x": int(x),
                "y": int(y),
                "yaw": float(yaw),
                "weapon": str(f.get("weapon") or "unknown"),
            })

        out.sort(key=lambda s: s["tick"])
        return out

    @staticmethod
    def _aggregate_player_stats(
        players_meta: dict,
        kills: list[dict],
        hurt_df,
        rounds: list[dict],
        tickrate: float,
    ) -> dict:
        """Build the real per-player aggregates the leaderboard needs.

        Returns a dict with these keys (all map steamid -> int):

        - ``total_dmg``: sum of player_hurt.dmg_health dealt by the
          player (excluding self / team damage).
        - ``util_dmg``: subset of total_dmg where the damaging weapon
          was a grenade (he / molotov / incendiary / inferno).
        - ``assists``: count of ``player_death`` events crediting the
          player as assister (non-flash).
        - ``flash_assists``: count of those assists where the kill was
          flagged ``assistedflash``.
        - ``kast_rounds``: rounds in which the player got a Kill,
          Assist (incl. flash), Survived, or was Traded (their killer
          died within ~5s after the player's death).

        These numbers are what make a HLTV-2.0-style leaderboard
        credible: ADR = total_dmg / rounds_played, KAST =
        kast_rounds / rounds_played, Impact = 2.13·KPR + 0.42·APR
        − 0.41. Cross-demo aggregation in the leaderboard endpoint
        sums these as raw counts (not rates) and then divides by
        total rounds played, which is mathematically correct.
        """
        total_dmg: dict[str, int] = defaultdict(int)
        util_dmg: dict[str, int] = defaultdict(int)
        assists: dict[str, int] = defaultdict(int)
        flash_assists: dict[str, int] = defaultdict(int)

        # Side per player (constant across the match). Used to skip
        # team damage in player_hurt. We can't trust per-tick team
        # because hurt rows don't carry it on every demoparser2 build
        # — but the per-player meta is set from the start lineup
        # which is good enough (team-damage to teammates we swapped
        # with at half is still same-team).
        side_by_sid = {sid: m.get("team") for sid, m in players_meta.items()}

        # Grenade-weapon prefixes (substring match against the
        # weapon string player_hurt reports). Covers the common
        # variants demoparser2 emits across CS2 patches.
        def _is_util(weapon: str) -> bool:
            w = weapon.lower()
            return (
                w.startswith("hegrenade")
                or w.startswith("weapon_hegrenade")
                or w.startswith("inferno")
                or w.startswith("molotov")
                or w.startswith("incgrenade")
                or w == "weapon_molotov"
                or w == "weapon_incgrenade"
            )

        # Vectorised path: keep the player_hurt DataFrame as a frame
        # and iterate it column-major via the numpy arrays underneath.
        # Materialising as a list-of-dicts (the old code path) blew
        # past the 512 MB Hobby budget for big Bo3 demos and got the
        # worker SIGKILL'd, leaving rows stuck in ``processing``.
        if hurt_df is not None and len(hurt_df) > 0:
            cols = getattr(hurt_df, "columns", [])
            # Pull only the columns we actually use as numpy arrays.
            # ``.to_numpy()`` is a zero-copy view of the underlying
            # block when dtype is uniform, so peak RAM is the size of
            # the original frame — not 2-3x as the dict copy was.
            try:
                atk_arr = hurt_df["attacker_steamid"].to_numpy() if "attacker_steamid" in cols else None
                vic_arr = hurt_df["user_steamid"].to_numpy() if "user_steamid" in cols else None
                dmg_arr = hurt_df["dmg_health"].to_numpy() if "dmg_health" in cols else None
                wpn_arr = hurt_df["weapon"].to_numpy() if "weapon" in cols else None
            except Exception:  # pragma: no cover — defensive
                atk_arr = vic_arr = dmg_arr = wpn_arr = None

            if atk_arr is not None and dmg_arr is not None:
                n = len(atk_arr)
                for i in range(n):
                    atk_raw = atk_arr[i]
                    if atk_raw is None or _is_nan(atk_raw):
                        continue
                    atk = str(atk_raw).strip()
                    if not atk or atk not in players_meta:
                        continue
                    vic_raw = vic_arr[i] if vic_arr is not None else None
                    if vic_raw is None or _is_nan(vic_raw):
                        vic = ""
                    else:
                        vic = str(vic_raw).strip()
                    if atk == vic:
                        continue
                    if vic and side_by_sid.get(atk) == side_by_sid.get(vic):
                        continue
                    try:
                        dmg = int(dmg_arr[i] or 0)
                    except (TypeError, ValueError):
                        continue
                    if dmg <= 0:
                        continue
                    total_dmg[atk] += dmg
                    weapon = ""
                    if wpn_arr is not None:
                        w_raw = wpn_arr[i]
                        if w_raw is not None and not _is_nan(w_raw):
                            weapon = str(w_raw)
                    if _is_util(weapon):
                        util_dmg[atk] += dmg

        # Assists + flash assists, straight off the enriched kill list.
        for k in kills:
            aid = k.get("assister") or ""
            if not aid:
                continue
            if k.get("assistedFlash"):
                flash_assists[aid] += 1
            else:
                assists[aid] += 1

        # ---- KAST per round ------------------------------------------------
        # Pre-index kills by round for the per-round walk.
        kills_by_round: dict[int, list[dict]] = defaultdict(list)
        for k in kills:
            kills_by_round[k["round"]].append(k)

        # Trade window: HLTV uses 5 seconds. tickrate is ~64 in CS2.
        trade_window_ticks = int(max(1.0, tickrate) * 5.0)
        kast_rounds: dict[str, int] = defaultdict(int)
        all_sids = list(players_meta.keys())

        for r in rounds:
            rnum = r["number"]
            round_kills = kills_by_round.get(rnum, [])

            killers_in_round: set[str] = set()
            assisters_in_round: set[str] = set()
            victims_in_round: dict[str, dict] = {}
            for k in round_kills:
                killers_in_round.add(k["killer"])
                if k.get("assister"):
                    assisters_in_round.add(k["assister"])
                # Keep the FIRST death of each player in the round
                # — that's the one the trade window applies to.
                if k["victim"] not in victims_in_round:
                    victims_in_round[k["victim"]] = k

            # Trade lookup: for each death of player V at tick t,
            # was V's killer (K) killed within ``trade_window`` ticks?
            traded: set[str] = set()
            for v_sid, death_k in victims_in_round.items():
                k_sid = death_k["killer"]
                death_tick = death_k["tick"]
                for k2 in round_kills:
                    if k2["victim"] != k_sid:
                        continue
                    if 0 <= (k2["tick"] - death_tick) <= trade_window_ticks:
                        traded.add(v_sid)
                        break

            for sid in all_sids:
                if (
                    sid in killers_in_round
                    or sid in assisters_in_round
                    or sid not in victims_in_round  # survived
                    or sid in traded
                ):
                    kast_rounds[sid] += 1

        return {
            "total_dmg": dict(total_dmg),
            "util_dmg": dict(util_dmg),
            "assists": dict(assists),
            "flash_assists": dict(flash_assists),
            "kast_rounds": dict(kast_rounds),
        }

    @staticmethod
    def _build_players(
        players_meta: dict,
        kills: list[dict],
        round_count: int,
        agg: dict | None = None,
    ) -> list[dict]:
        """Aggregate per-player stats from the real kill list.

        ``agg`` is the dict returned by ``_aggregate_player_stats``
        and carries the real damage / assist / KAST numbers. When
        absent (defensive fallback / legacy call sites) the per-player
        fields fall back to 0 — never to fake formula estimates,
        because the leaderboard aggregates those across demos and
        averaging a fake number poisons the ranking.
        """
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

        total_dmg_by = (agg or {}).get("total_dmg", {})
        util_dmg_by = (agg or {}).get("util_dmg", {})
        assists_by = (agg or {}).get("assists", {})
        flash_assists_by = (agg or {}).get("flash_assists", {})
        kast_rounds_by = (agg or {}).get("kast_rounds", {})

        rounds_f = float(round_count) if round_count else 0.0

        out: list[dict] = []
        for sid, info in players_meta.items():
            ks = kills_by_killer[sid]
            ds = deaths_by_victim[sid]
            kills_n = len(ks)
            deaths_n = len(ds)
            hs = sum(1 for k in ks if k["headshot"])
            hs_pct = int((hs / kills_n) * 100) if kills_n else 0

            assists_n = int(assists_by.get(sid, 0))
            flash_n = int(flash_assists_by.get(sid, 0))
            total_dmg_n = int(total_dmg_by.get(sid, 0))
            util_dmg_n = int(util_dmg_by.get(sid, 0))
            kast_rounds_n = int(kast_rounds_by.get(sid, 0))

            if rounds_f > 0:
                adr = round(total_dmg_n / rounds_f, 1)
                kpr = kills_n / rounds_f
                dpr = deaths_n / rounds_f
                # APR counts both regular assists and flash assists —
                # they both contribute to round impact.
                apr = (assists_n + flash_n) / rounds_f
                kast = int(round(100.0 * kast_rounds_n / rounds_f))
            else:
                adr = 0.0
                kpr = dpr = apr = 0.0
                kast = 0

            # HLTV Rating 2.0 (public coefficients).
            # Impact = 2.13·KPR + 0.42·APR − 0.41.
            # Rating = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR
            #          + 0.2372·Impact + 0.0032·ADR + 0.1587.
            if rounds_f > 0:
                impact = 2.13 * kpr + 0.42 * apr - 0.41
                rating_raw = (
                    0.0073 * kast
                    + 0.3591 * kpr
                    + -0.5329 * dpr
                    + 0.2372 * impact
                    + 0.0032 * adr
                    + 0.1587
                )
                rating = round(max(0.0, rating_raw), 2)
            else:
                rating = 0.0

            out.append({
                "steamId": sid,
                "name": info["name"],
                "team": info["team"],
                "clan": info.get("clan"),
                "kills": kills_n,
                "deaths": deaths_n,
                "assists": assists_n,
                "headshots": hs,
                "adr": adr,
                "kast": kast,
                "hsPercent": hs_pct,
                "rating": rating,
                "openingKills": opening_kills[sid],
                "openingDeaths": opening_deaths[sid],
                "clutchWins": 0,
                "clutchAttempts": 0,
                "utilityDamage": util_dmg_n,
                "flashAssists": flash_n,
                "mvpRounds": 0,
                # Raw counts so cross-demo aggregation in the
                # leaderboard endpoint can recompute rates correctly
                # (sum counts, divide by sum-of-rounds).
                "totalDamage": total_dmg_n,
                "kastRounds": kast_rounds_n,
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
        fires_raw: list[dict] | None = None,
    ) -> dict[int, list[dict]]:
        """Group grenade detonations into events keyed by round.

        Each event ships both the LANDING coordinates (``x``, ``y`` — where
        the smoke / molotov / flashbang detonated) and the THROWER coordinates
        (``throwerX``, ``throwerY`` — looked up from the tick stream at the
        nade's detonate tick), so the viewer can render projectile trajectories
        cs2.cam style.

        ``fires_raw`` is accepted for API parity but currently unused —
        an earlier experiment using ``weapon_fire`` as a "real throw
        commit" anchor turned out to be a dead end because CS2 fires
        weapon_fire for grenades AT projectile spawn (= end of throw
        animation), the same moment parse_grenades' first sample
        captures. The molotov throw-timing issue was actually rooted
        in using ``inferno_startburn`` as the molotov "detonate"
        event — its entityid is the inferno entity, not the
        projectile, forcing a spatial+temporal matcher that drifted
        the throw tick. Switching to ``molotov_detonate`` (whose
        entityid IS the projectile, same contract as the other
        ``*_detonate`` events) eliminates the matcher and the drift —
        see ``_push_molotov`` below.
        """
        del fires_raw  # See docstring above.
        per_round: dict[int, list[dict]] = defaultdict(list)

        # ``grenade_throws_df`` (parser.parse_grenades()) emits a row per tick
        # the projectile is alive. We index per (entity, steamid) so we can
        # later extract two things per detonation:
        #   1. ``first_throw_tick`` — the release tick (lookup table)
        #   2. ``trajectory`` — every position the projectile occupied while
        #      airborne, decimated to ~20 points so the JSON stays small
        first_throw_tick: dict[tuple[int, str], int] = {}
        trajectory_by_key: dict[tuple[int, str], list[tuple[int, float, float]]] = {}
        # Grenade-type for each projectile entity, used by the molotov
        # matcher below. Source of truth is the ``grenade_type`` column
        # in parse_grenades (e.g. ``CMolotovProjectile`` /
        # ``CIncendiaryGrenade``). A previous version mistakenly read
        # the ``name`` column, which actually holds the PLAYER NAME
        # (e.g. ``Mzinho``) — making the weapon-name filter reject
        # every real molotov projectile and forcing the matcher's
        # fallback to fire, which is what caused the molotov-specific
        # timing drift.
        weapon_type_by_key: dict[tuple[int, str], str] = {}
        if grenade_throws_df is not None and len(grenade_throws_df) > 0:
            try:
                # CRITICAL filter: drop "held" rows (player carrying
                # the grenade in their inventory). Those rows have
                # ``x`` / ``y`` = NaN and use the SAME grenade_entity_id
                # as the eventual projectile when the engine recycles
                # ids. Without dropping them, ``iloc[0]`` of a grouped
                # frame can land on a held tick from 30+ s before the
                # actual throw — turning ``first_throw_tick`` into
                # garbage and shifting every grenade's tracer-start
                # by an arbitrary amount. The user's "molotov no sale
                # en el mismo tick q el player lo tiro" was a
                # symptom of this; smokes happened to dodge it most
                # of the time because the smoke detonate event's
                # entityid mostly correlated with rows that had
                # projectile-only history.
                projectile_only = grenade_throws_df[
                    grenade_throws_df["x"].notna()
                    & grenade_throws_df["y"].notna()
                ]
                tdf = projectile_only.sort_values("tick")
                groups = tdf.groupby(["grenade_entity_id", "steamid"], dropna=False)
                for (entity_id, sid), grp in groups:
                    try:
                        ent_int = int(entity_id)
                    except (TypeError, ValueError):
                        continue
                    sid_str = str(sid)
                    # Skip projectiles attributed to non-playable
                    # steamids (coach / spectator). Their tracker
                    # data would otherwise sit in trajectory_by_key
                    # ready to be matched by a real player's
                    # detonate event — that mismatch is the source of
                    # the "ghost utility tracer from a random map
                    # position" the user kept reporting on 5-man +
                    # coach demos.
                    if sid_str not in players_meta:
                        continue
                    key = (ent_int, sid_str)
                    first_throw_tick[key] = int(grp["tick"].iloc[0])
                    # Capture the projectile's GRENADE TYPE (correct
                    # column — see the docstring above) so the molotov
                    # matcher can filter to fire-class projectiles
                    # only and skip co-pending smokes / flashes from
                    # the same player.
                    if "grenade_type" in grp.columns:
                        gtype = grp["grenade_type"].iloc[0]
                        if gtype is not None:
                            weapon_type_by_key[key] = str(gtype).lower()

                    # Decimate the path: if the projectile lived for N ticks,
                    # sample evenly to at most 20 points. CS2 nades typically
                    # fly 32-128 ticks so this rarely truncates real data.
                    n = len(grp)
                    if n == 0:
                        continue
                    step = max(1, n // 20)
                    pts: list[tuple[int, float, float]] = []
                    for idx in range(0, n, step):
                        r = grp.iloc[idx]
                        gx = r.get("x")
                        gy = r.get("y")
                        # No NaN check needed here — projectile_only
                        # already filtered them out. Kept defensively.
                        if gx is None or gy is None or _is_nan(gx) or _is_nan(gy):
                            continue
                        pts.append((int(r["tick"]), float(gx), float(gy)))
                    # Always include the last sample so the line reaches the
                    # landing point.
                    last = grp.iloc[-1]
                    if pts and pts[-1][0] != int(last["tick"]):
                        last_x = last.get("x")
                        last_y = last.get("y")
                        if last_x is not None and last_y is not None \
                                and not _is_nan(last_x) and not _is_nan(last_y):
                            pts.append((int(last["tick"]), float(last_x), float(last_y)))
                    if pts:
                        trajectory_by_key[key] = pts
            except Exception:
                logger.debug("grenade trajectory parsing failed", exc_info=True)

        def _push(df, subtype: str) -> None:
            if df is None or len(df) == 0:
                return
            for _, row in df.iterrows():
                t = _safe_int(row.get("tick"))
                rnum = _which_round(t, rounds)
                if rnum is None:
                    continue
                round_obj = next((r for r in rounds if r["number"] == rnum), None)
                if not round_obj:
                    continue
                start_tick = round_obj["startTick"]
                # ``t`` here is the DETONATE tick from the *_detonate event.
                detonate_rel_t = max(0.0, (t - start_tick) / tickrate)
                sid = str(row.get("user_steamid") or "")
                # Drop events attributed to non-playable steamids
                # (coach / spectator / caster). Without this, a
                # coach-attributed inferno_startburn would still
                # build a grenade_thrown event with the coach's
                # static spec position as thrower_pos, producing
                # the long ghost tracers the user reported.
                if not sid or sid not in players_meta:
                    continue
                team = players_meta.get(sid, {}).get("team", "ct")
                landing_x = _safe_int(row.get("x"))
                landing_y = _safe_int(row.get("y"))

                # Thrower position + actual throw tick. The throw fires
                # 0.5 - 2 s BEFORE the detonate event — we want the
                # event timestamp to be the THROW so the trajectory
                # renders during the projectile's flight, not after.
                thrower_pos: tuple[float, float] | None = None
                trajectory_payload: list[dict] | None = None
                throw_t: int | None = None
                ent = row.get("entityid")
                thrower_full: dict | None = None
                if ent is not None:
                    try:
                        ent_int = int(ent)
                    except (TypeError, ValueError):
                        ent_int = None
                    if ent_int is not None:
                        key = (ent_int, sid)
                        throw_t = first_throw_tick.get(key)
                        if throw_t is not None:
                            thrower_pos = _lookup_position(ticks_df, throw_t, sid)
                            thrower_full = _lookup_position_full(ticks_df, throw_t, sid)
                        # Convert trajectory ticks → seconds relative to round.
                        traj_pts = trajectory_by_key.get(key)
                        if traj_pts:
                            trajectory_payload = [
                                {
                                    "x": _safe_int(px),
                                    "y": _safe_int(py),
                                    "t": round(
                                        max(0.0, (pt - start_tick) / tickrate),
                                        2,
                                    ),
                                }
                                for (pt, px, py) in traj_pts
                            ]
                if thrower_pos is None:
                    thrower_pos = _lookup_position(ticks_df, t, sid)

                # The event fires at the THROW time. If we never got a
                # throw_tick from parse_grenades(), fall back to detonate
                # minus a typical flight duration (~0.7 s) so the
                # trajectory has SOME lead time in the UI.
                if throw_t is not None:
                    throw_rel_t = max(0.0, (throw_t - start_tick) / tickrate)
                else:
                    throw_rel_t = max(0.0, detonate_rel_t - 0.7)

                per_round[rnum].append({
                    # Event happens at the moment the player THROWS the
                    # grenade — frontend uses this to start animating the
                    # projectile trail in sync with the live demo.
                    "t": round(throw_rel_t, 2),
                    # When the grenade actually lands / explodes. Smoke
                    # cloud / molotov burn / HE shockwave begin here.
                    "detonatedAt": round(detonate_rel_t, 2),
                    "type": "grenade_thrown",
                    "subtype": subtype,
                    "player": sid,
                    "team": team,
                    # Landing position (where the area effect appears).
                    "x": landing_x,
                    "y": landing_y,
                    "throwerX": _safe_int(thrower_pos[0]) if thrower_pos else None,
                    "throwerY": _safe_int(thrower_pos[1]) if thrower_pos else None,
                    # Full thrower state at throw time — used by the CS2
                    # lineup-copy feature: setpos X Y Z; setang pitch yaw
                    "throwerZ": thrower_full["z"] if thrower_full else None,
                    "throwerPitch": thrower_full["pitch"] if thrower_full else None,
                    "throwerYaw": thrower_full["yaw"] if thrower_full else None,
                    "radius": _GRENADE_RADIUS[subtype],
                    # expiresAt: when the effect ends.
                    "expiresAt": round(
                        detonate_rel_t + _GRENADE_DURATION[subtype], 2,
                    ),
                    # Real per-tick projectile path — used by the renderer
                    # to draw a polyline that "grows" as the projectile flies.
                    "trajectory": trajectory_payload,
                })

        def _push_molotov_grouped(df) -> None:
            """Group ``inferno_startburn`` events per molotov throw,
            then match each group to its projectile in parse_grenades.

            CS2 doesn't emit ``molotov_detonate`` (verified via
            ``DemoParser.list_game_events()``), so we cannot use the
            same "look up by entityid" shortcut smokes/flashes/HE
            enjoy. Instead:

              1. Group ``inferno_startburn`` patches by (thrower,
                 ≤1.5 s rolling window). One group = one molotov.
              2. For each group, MATCH the projectile in
                 trajectory_by_key: same steamid, fire-class
                 grenade_type, and whose last trajectory tick lands
                 ≈ where + when the first inferno patch ignited.
              3. Use the matched projectile's first_throw_tick as
                 throw_t (= same source smokes use, so same accuracy).

            Critically:
              - trajectory_by_key was built from PROJECTILE-ONLY rows
                (NaN held rows filtered out upstream), so
                ``first_throw_tick`` is the projectile spawn tick, not
                some unrelated held tick from 30 s earlier.
              - The grenade-type filter reads ``weapon_type_by_key``,
                which is sourced from the correct ``grenade_type``
                column (e.g. ``cmolotovprojectile``). A previous bug
                read the ``name`` column instead — that column is the
                PLAYER NAME (``mzinho``), so the filter rejected every
                real molotov projectile and forced the fallback to
                fire, which is what shifted the molotov tracer by
                up to a second.
            """
            if df is None or len(df) == 0:
                return
            max_gap_ticks = int(tickrate * 1.5)
            sorted_df = df.sort_values("tick")
            open_idx: dict[str, int] = {}
            groups: list[dict] = []
            for _, row in sorted_df.iterrows():
                tick = _safe_int(row.get("tick"))
                rnum = _which_round(tick, rounds)
                if rnum is None:
                    continue
                sid = str(row.get("user_steamid") or "")
                if not sid or sid not in players_meta:
                    continue
                rx = row.get("x")
                ry = row.get("y")
                if rx is None or ry is None or _is_nan(rx) or _is_nan(ry):
                    continue
                px, py = int(rx), int(ry)
                gi = open_idx.get(sid)
                if gi is not None:
                    grp = groups[gi]
                    if grp["rnum"] == rnum and (tick - grp["last_tick"]) <= max_gap_ticks:
                        grp["patches"].append({"tick": tick, "x": px, "y": py})
                        grp["last_tick"] = tick
                        continue
                groups.append({
                    "sid": sid,
                    "rnum": rnum,
                    "first_tick": tick,
                    "last_tick": tick,
                    "patches": [{"tick": tick, "x": px, "y": py}],
                })
                open_idx[sid] = len(groups) - 1

            for grp in groups:
                sid = grp["sid"]
                rnum = grp["rnum"]
                round_obj = next((r for r in rounds if r["number"] == rnum), None)
                if not round_obj:
                    continue
                start_tick = round_obj["startTick"]
                team = players_meta.get(sid, {}).get("team", "ct")
                thrower_full: dict | None = None
                first_patch = grp["patches"][0]
                landing_x = first_patch["x"]
                landing_y = first_patch["y"]
                detonate_rel_t = max(0.0, (grp["first_tick"] - start_tick) / tickrate)
                last_patch_rel_t = max(0.0, (grp["last_tick"] - start_tick) / tickrate)
                patches_rel = [
                    {
                        "x": p["x"],
                        "y": p["y"],
                        "t": round(max(0.0, (p["tick"] - start_tick) / tickrate), 2),
                    }
                    for p in grp["patches"]
                ]

                # ---- Match the projectile ----
                # Find the parse_grenades projectile whose LAST
                # trajectory point lands ≈ where + when the first
                # inferno patch ignited.
                target_x_f = float(first_patch["x"])
                target_y_f = float(first_patch["y"])
                max_lead_ticks = int(tickrate * 1.5)
                max_lag_ticks = int(tickrate * 0.2)
                max_landing_dist = 80.0
                best_key = None
                best_score = float("inf")
                for (ent_id, traj_sid), pts in trajectory_by_key.items():
                    if traj_sid != sid or not pts:
                        continue
                    # Filter by grenade_type — only molotov / incendiary
                    # projectiles. Reads from weapon_type_by_key which
                    # was correctly populated from the ``grenade_type``
                    # column (not ``name`` which is the player name).
                    gtype = weapon_type_by_key.get((ent_id, traj_sid), "")
                    if gtype and not any(
                        s in gtype for s in (
                            "molotov", "incendiary", "inferno", "fire",
                        )
                    ):
                        continue
                    last_tick, last_x, last_y = pts[-1]
                    dt = grp["first_tick"] - last_tick
                    if dt < -max_lag_ticks or dt > max_lead_ticks:
                        continue
                    dx = float(last_x) - target_x_f
                    dy = float(last_y) - target_y_f
                    dist = (dx * dx + dy * dy) ** 0.5
                    if dist > max_landing_dist:
                        continue
                    score = abs(dt) + dist / 50.0
                    if score < best_score:
                        best_score = score
                        best_key = (ent_id, traj_sid)

                # ---- Throw timestamp + trajectory (same pattern as
                # smokes/flashes/HE in ``_push``) ----
                trajectory_payload = None
                thrower_pos = None
                throw_t: int | None = None
                if best_key is not None:
                    throw_t = first_throw_tick.get(best_key)
                    traj_pts = trajectory_by_key.get(best_key)
                    if traj_pts:
                        trajectory_payload = [
                            {
                                "x": _safe_int(px),
                                "y": _safe_int(py),
                                "t": round(
                                    max(0.0, (pt - start_tick) / tickrate),
                                    2,
                                ),
                            }
                            for (pt, px, py) in traj_pts
                        ]
                    if throw_t is not None:
                        thrower_pos = _lookup_position(ticks_df, throw_t, sid)
                        thrower_full = _lookup_position_full(ticks_df, throw_t, sid)

                if thrower_pos is None:
                    thrower_pos = _lookup_position(
                        ticks_df, grp["first_tick"], sid,
                    )
                    if thrower_full is None:
                        thrower_full = _lookup_position_full(ticks_df, grp["first_tick"], sid)

                if throw_t is not None:
                    throw_rel_t = max(0.0, (throw_t - start_tick) / tickrate)
                else:
                    throw_rel_t = max(0.0, detonate_rel_t - 0.7)

                # ---- Actual weapon type (CT incendiary vs TT molotov) --------
                # Derived from the real grenade_type column in parse_grenades()
                # via weapon_type_by_key, which was populated from the demo file
                # itself — more reliable than team_num → side mapping (which can
                # be tripped by the halftime orientation-detection heuristic).
                #
                # Vocabulary in the wild: "cmolotovprojectile", "incgrenade",
                # "weapon_incgrenade", "incendiarygrenade", etc.  We look for any
                # of the canonical incendiary substrings; everything else is the
                # T-side molotov.
                actual_gtype = ""
                if best_key is not None:
                    actual_gtype = weapon_type_by_key.get(best_key, "")
                _inc_keywords = ("incendia", "incgren", "firebomb", "inc_gr")
                if actual_gtype:
                    is_ct_incendiary = any(
                        s in actual_gtype.lower() for s in _inc_keywords
                    )
                else:
                    # No matched projectile — fall back to team as proxy.
                    is_ct_incendiary = team == "ct"
                weapon_type = "incgrenade" if is_ct_incendiary else "molotov"

                # ---- Synthetic spread augmentation ----
                # demoparser2's inferno_startburn often emits only 1-2
                # patches per inferno entity. Synthesise extras around
                # the ignition point so the visual reads as a spreading
                # fire instead of a single static disc.
                #
                # Patches are ordered by DISTANCE from the ignition centre
                # (inner patches first, outer patches last). This means the
                # timestamp increases with radius, so the rendered fire
                # visibly spreads outward from the impact point — matching
                # the real CS2 flame-expansion behaviour.
                TARGET_PATCH_COUNT = 14
                if len(patches_rel) < TARGET_PATCH_COUNT:
                    import math
                    import random as _random_mod
                    seed_str = f"{sid}-{grp['first_tick']}"
                    rng = _random_mod.Random(seed_str)
                    base = patches_rel[0]
                    needed = TARGET_PATCH_COUNT - len(patches_rel)
                    # Generate candidate patches with their distances, then sort
                    # so inner patches receive earlier timestamps.
                    new_patches: list[dict] = []
                    for i in range(needed):
                        base_angle = (i / needed) * 6.28318530718
                        jitter_angle = (rng.random() - 0.5) * 0.9
                        angle = base_angle + jitter_angle
                        # Distance grows with index so the circle is filled
                        # from inside out; a small random jitter keeps it
                        # irregular rather than perfectly ring-shaped.
                        min_d, max_d = 10.0, 62.0
                        dist = min_d + (max_d - min_d) * (i / needed) + (rng.random() - 0.5) * 8.0
                        dist = max(min_d, min(max_d, dist))
                        sx = int(base["x"] + math.cos(angle) * dist)
                        sy = int(base["y"] + math.sin(angle) * dist)
                        new_patches.append({"x": sx, "y": sy, "dist": dist})
                    # Sort inner → outer so the fire "expands" correctly.
                    new_patches.sort(key=lambda p: p["dist"])
                    # Spread timestamps from 0.06 s to 0.55 s after first ignition.
                    for i, p in enumerate(new_patches):
                        st = round(base["t"] + 0.06 + (i / needed) * 0.55, 2)
                        patches_rel.append({"x": p["x"], "y": p["y"], "t": st})
                    patches_rel.sort(key=lambda p: p["t"])
                    last_patch_rel_t = max(last_patch_rel_t, patches_rel[-1]["t"])

                per_round[rnum].append({
                    "t": round(throw_rel_t, 2),
                    "detonatedAt": round(detonate_rel_t, 2),
                    "type": "grenade_thrown",
                    "subtype": "molotov",
                    "player": sid,
                    "team": team,
                    # Canonical grenade-type key — used by the frontend to
                    # show the correct icon (incgrenade vs molotov) regardless
                    # of team orientation detection accuracy.
                    "weaponType": weapon_type,
                    "x": landing_x,
                    "y": landing_y,
                    "throwerX": _safe_int(thrower_pos[0]) if thrower_pos else None,
                    "throwerY": _safe_int(thrower_pos[1]) if thrower_pos else None,
                    "throwerZ": thrower_full["z"] if thrower_full else None,
                    "throwerPitch": thrower_full["pitch"] if thrower_full else None,
                    "throwerYaw": thrower_full["yaw"] if thrower_full else None,
                    "radius": _GRENADE_RADIUS["molotov"],
                    "expiresAt": round(
                        last_patch_rel_t + _GRENADE_DURATION["molotov"], 2,
                    ),
                    "trajectory": trajectory_payload,
                    "patches": patches_rel,
                })

        _push(smokes_df, "smoke")
        _push(flashes_df, "flash")
        _push(hes_df, "he")
        _push_molotov_grouped(molotovs_df)
        return per_round

    @staticmethod
    def _build_loadouts(
        rounds: list[dict], ticks_df, players_meta: dict
    ) -> dict[int, dict[str, dict]]:
        """Snapshot weapon + armor + money + helmet/kit + grenade
        inventory at start of each round.
        """
        out: dict[int, dict[str, dict]] = {}
        has_weapon = "active_weapon_name" in ticks_df.columns
        has_helmet_col = "has_helmet" in ticks_df.columns
        has_defuser_col = "has_defuser" in ticks_df.columns
        has_inventory = "inventory" in ticks_df.columns
        for r in rounds:
            # Snapshot a few seconds into the PLAY portion (after
            # buy phase). ``startTick`` was widened to include the
            # freeze period by ``_augment_rounds_freeze_post``, so
            # we use ``playStartTick`` (= the original freeze_end
            # tick) for loadout timing — otherwise the snapshot
            # would land in the middle of buy time and miss
            # weapons players bought near the end of freeze.
            play_start = r.get("playStartTick", r["startTick"])
            t_target = play_start + 320  # ~5s after freeze_end on 64-tick
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
                armor = _safe_int(row.get("armor_value"))
                helmet = bool(row.get("has_helmet")) if has_helmet_col else armor > 50
                kit = bool(row.get("has_defuser")) if has_defuser_col else False
                # ---- Grenade inventory ---------------------------
                # ``inventory`` is a list of weapon strings. Each item
                # is normalised through ``_canonical_grenade_key`` so
                # demoparser2 display-name variants (``weapon_high_
                # explosive``, ``weapon_incendiary``, ``weapon_inferno``)
                # collapse onto the same canonical key as the engine
                # names (``weapon_hegrenade``, ``weapon_incgrenade``).
                # Before this normalisation the loadout slots silently
                # showed 0 for HE / inc whenever the parser emitted
                # display variants — even though the player clearly
                # had the grenade in the demo. CS2 inventory caps:
                # flash=2, every other type=1.
                grenades = {
                    "hegrenade": 0,
                    "flashbang": 0,
                    "smokegrenade": 0,
                    "molotov": 0,
                    "incgrenade": 0,
                    "decoy": 0,
                }
                if has_inventory:
                    inv = row.get("inventory")
                    if inv is not None:
                        try:
                            items = list(inv)  # may already be a list / np.array
                        except TypeError:
                            items = []
                        for item in items:
                            canonical = _canonical_grenade_key(item)
                            if canonical:
                                grenades[canonical] += 1
                        # CS2 caps flashes at 2, everything else at 1.
                        grenades["flashbang"] = min(grenades["flashbang"], 2)
                        for k in ("hegrenade", "smokegrenade", "molotov", "incgrenade", "decoy"):
                            grenades[k] = min(grenades[k], 1)
                entry[sid] = {
                    "weapon": weapon,
                    "armor": armor,
                    "helmet": helmet,
                    "kit": kit,
                    "money": _safe_int(row.get("balance")),
                    "grenades": grenades,
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
        shots: list[dict] | None = None,
        team_num_to_side: dict[int, str] | None = None,
        item_pickup_df=None,
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
        # Default to canonical CS2 mapping if the caller didn't pass in
        # the demo-specific resolution.
        tn_map = team_num_to_side if team_num_to_side is not None else _TEAM_NUM_TO_SIDE

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

            # Build evenly-spaced sample ticks so frame i corresponds to
            # exactly i/TIMELINE_FPS seconds of real round time.
            #
            # We have to use FLOAT math here. With integer step =
            # tickrate // TIMELINE_FPS the per-frame stride is rounded
            # DOWN (64//10=6 ticks instead of 6.4) so each frame is
            # ~6 % short. By frame ~100 that's accumulated to a full
            # second of drift between the frame data (sampled at real
            # time 9.4 s) and the timeline events (real time 10 s),
            # causing kills/utilities to appear ~1 s before the player
            # frames catch up to them.
            #
            # ``int(start + i * tickrate / TIMELINE_FPS)`` rounds each
            # frame independently; sub-tick error stays bounded at
            # ~15 ms (one tick at 64 Hz) instead of accumulating.
            tick_per_frame = tickrate / TIMELINE_FPS
            sampled_ticks = [int(start + i * tick_per_frame) for i in range(frame_count)]
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
                # CRITICAL: team is derived from the PER-TICK ``team_num``,
                # not from the static ``players_meta`` snapshot. This is what
                # makes the post-halftime side swap render correctly — when
                # a CT player switches to T in round 13, team_num goes from 3
                # to 2 and we paint them orange from that frame onward.
                if g is not None:
                    for _, row in g.iterrows():
                        sid = str(row["steamid"])
                        if sid not in players_meta:
                            continue
                        alive = bool(row.get("is_alive") or False)
                        x = float(row.get("X") or 0.0)
                        y = float(row.get("Y") or 0.0)
                        z = float(row.get("Z") or 0.0)
                        raw_yaw = row.get("yaw")
                        yaw = float(raw_yaw) if raw_yaw is not None and not _is_nan(raw_yaw) else 0.0
                        hp = _safe_int(row.get("health")) if alive else 0
                        team_num_i = _safe_int(row.get("team_num"))
                        team_dynamic = tn_map.get(team_num_i) or players_meta[sid]["team"]

                        weapon_raw = row.get("active_weapon_name")
                        weapon = str(weapon_raw).replace("weapon_", "") if weapon_raw else None

                        vel_z_raw = row.get("velocity_Z")
                        try:
                            vel_z = float(vel_z_raw) if vel_z_raw is not None and not _is_nan(vel_z_raw) else 0.0
                        except (TypeError, ValueError):
                            vel_z = 0.0
                        # 100 u/s vertical = definitely in the air. CS2 jump
                        # apex is ~260, so this catches the rising half of
                        # the arc. We also flag falling (-30) so players
                        # mid-fall still get the "airborne" visual.
                        is_jumping = vel_z > 100 or vel_z < -30

                        last_state[sid] = {
                            "steamId": sid,
                            "team": team_dynamic,
                            "name": players_meta[sid]["name"],
                            "x": round(x, 1),
                            "y": round(y, 1),
                            "z": round(z, 1),
                            "yaw": round(yaw, 1),
                            "alive": alive,
                            "hp": hp,
                            "weapon": weapon,
                            "isJumping": is_jumping,
                        }

                # Emit ALL roster players every frame, even if their state
                # hasn't updated since the last tick.
                #
                # IMPORTANT: we do NOT synthesise a placeholder for
                # players who have NO last_state in this round.
                # The old behaviour emitted them at (0, 0, 0) with
                # ``alive=False``, which drew an X mark on the radar
                # at world origin — visually appearing in the middle
                # of the map. When a coach / observer slipped past
                # the players_meta filter, this produced the user's
                # repeated "X en el medio del mapa de donde salen
                # todas las molotovs" ghost (the X stayed in the
                # same spot across all rounds because (0,0,0) maps
                # to a fixed screen coord).
                #
                # Skipping the emission entirely is safe: real
                # players who die mid-round populate last_state
                # with their last known alive=False position and
                # still get the death X at the right spot.
                fp_list: list[dict] = []
                for sid in all_sids:
                    if sid in last_state:
                        fp_list.append(dict(last_state[sid]))

                frames.append({"t": round(rel_t, 2), "players": fp_list})

            # ---- Events ----
            # A player's side is constant within a round, so resolve it from
            # THIS round's frames (per-tick team, already orientation-correct).
            # The players[] summary side can't be used here: parse_player_info
            # reports the END-of-demo side, which is inverted after halftime.
            round_side: dict[str, str] = {}
            for fr in frames:
                for p in fr["players"]:
                    if p.get("team"):
                        round_side.setdefault(p["steamId"], p["team"])

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
                    # Killer's side IN THIS ROUND (survives the halftime swap).
                    "team": round_side.get(k["killer"]),
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
                # Fix team using per-round side (same fix as kills).
                # grenade_events were built from players_meta["team"] which is
                # the END-of-demo side — wrong after halftime. round_side is
                # derived from this round's frames, so it's always correct.
                sid = ge.get("player", "")
                correct_side = round_side.get(sid)
                if correct_side:
                    ge = {**ge, "team": correct_side}
                events.append(ge)

            # ---- Weapon drops + floor pickups ----
            # weapon_drop: emitted at the moment a player dies. Shows their
            # primary weapon (and a grenade if they had one) on the floor.
            # weapon_pickup: when someone picks up a floor item (silent=False).
            for k in kills:
                if k["round"] != rnum:
                    continue
                ktick = k["tick"]
                victim_sid = k["victim"]
                # Victim's last weapon = active_weapon_name at death tick.
                # Look for the most recent non-null weapon in a small window.
                vrows = ticks_df[
                    (ticks_df["steamid"].astype(str) == str(victim_sid)) &
                    (ticks_df["tick"] >= ktick - 10) &
                    (ticks_df["tick"] <= ktick)
                ]
                weapon_name: str | None = None
                if len(vrows) > 0 and "active_weapon_name" in vrows.columns:
                    wvals = vrows["active_weapon_name"].dropna()
                    if len(wvals):
                        raw = str(wvals.iloc[-1]).strip()
                        if raw and raw.lower() not in ("nan", "", "knife", "c4"):
                            # Skip grenades as the primary weapon
                            grenade_keywords = ("grenade", "flash", "smoke", "molotov",
                                                "incendiary", "decoy", "firebomb")
                            if not any(g in raw.lower() for g in grenade_keywords):
                                weapon_name = raw
                # Drop position = victim's position at death (already in victimPos)
                vx = k["victimPos"][0] if k.get("victimPos") else 0.0
                vy = k["victimPos"][1] if k.get("victimPos") else 0.0
                rel_t = (ktick - start) / tickrate
                if weapon_name:
                    events.append({
                        "t": round(rel_t, 2),
                        "type": "weapon_drop",
                        "weapon": weapon_name,
                        "x": round(vx, 1),
                        "y": round(vy, 1),
                        "victim": victim_sid,
                    })
                # Grenade drop: check loadout for this round
                loadout = (loadouts_per_round.get(rnum) or {}).get(victim_sid)
                if loadout and isinstance(loadout, dict):
                    grenades = loadout.get("grenades") or {}
                    # Priority order: smoke, flash, molotov, he, decoy
                    grenade_priority = ["smokegrenade", "flashbang", "molotov",
                                        "incgrenade", "hegrenade", "decoy"]
                    # Subtract thrown grenades
                    thrown_map: dict[str, int] = {}
                    for ge in grenade_events.get(rnum, []):
                        if ge.get("player") != victim_sid:
                            continue
                        sub = ge.get("subtype", "")
                        gkey = {
                            "smoke": "smokegrenade", "flash": "flashbang",
                            "molotov": "molotov", "he": "hegrenade",
                        }.get(sub, sub)
                        # Only count grenades thrown BEFORE death
                        if ge.get("t", 999) < rel_t:
                            thrown_map[gkey] = thrown_map.get(gkey, 0) + 1
                    for gkey in grenade_priority:
                        available = (grenades.get(gkey) or 0) - thrown_map.get(gkey, 0)
                        if available > 0:
                            events.append({
                                "t": round(rel_t, 2) + 0.01,
                                "type": "weapon_drop",
                                "weapon": gkey,
                                "x": round(vx + 12, 1),
                                "y": round(vy + 12, 1),
                                "victim": victim_sid,
                                "isGrenade": True,
                            })
                            break

            # Floor pickups — only emit when truly picked up from the FLOOR.
            # silent=False fires at round start (spawn) AND post-round (next
            # round's spawn leaks in via the extended endTick). We restrict
            # to the actual PLAY window [playStartTick, playEndTick] so we
            # don't pick up spawn events on either side.
            if item_pickup_df is not None and len(item_pickup_df) > 0:
                play_start_tick = r.get("playStartTick") or (start + 20 * tickrate)
                play_end_tick = r.get("playEndTick") or end
                floor = item_pickup_df[
                    (item_pickup_df["tick"] >= play_start_tick) &
                    (item_pickup_df["tick"] <= play_end_tick)
                ]
                if "silent" in floor.columns:
                    floor = floor[floor["silent"] == False]
                for _, pu in floor.iterrows():
                    ptick = int(pu["tick"])
                    item = str(pu.get("item", "")).strip()
                    if not item or item.lower() in ("knife", "vest", "kevlar",
                                                     "c4", "defuser", "taser",
                                                     "nan", ""):
                        continue
                    picker_sid = str(pu.get("user_steamid", ""))
                    rel_t = (ptick - start) / tickrate
                    events.append({
                        "t": round(rel_t, 2),
                        "type": "weapon_pickup",
                        "weapon": item,
                        "picker": picker_sid,
                    })

            # ---- Shots (per-bullet fire events) ----
            # Each weapon_fire becomes a tiny event with shooter
            # position + yaw so the viewer can draw a short directional
            # tracer line. We emit them as type="shot" — the viewer
            # filters by type to keep the timeline panel uncluttered.
            for sh in (shots or []):
                if sh["round"] != rnum:
                    continue
                rel_t = (sh["tick"] - start) / tickrate
                events.append({
                    "t": round(rel_t, 2),
                    "type": "shot",
                    "shooter": sh["shooter"],
                    # Per-tick team — correct across halftime swap.
                    "team": sh["team"],
                    "x": sh["x"],
                    "y": sh["y"],
                    "yaw": sh["yaw"],
                    "weapon": sh["weapon"],
                })

            events.sort(key=lambda e: e["t"])

            rounds_data[str(rnum)] = {
                "durationSeconds": round(duration, 1),
                "frameCount": len(frames),
                "frames": frames,
                "events": events,
                "loadouts": loadouts_per_round.get(rnum, {}),
                # Where the actual PLAY portion sits within the
                # extended timeline (freeze + play + post). The
                # frontend uses these to clamp playback when the
                # user toggles "show pre/post round" off — without
                # them the round would just animate through the
                # full freeze + post window unconditionally.
                "playStartT": r.get("playStartT", 0.0),
                "playEndT": r.get("playEndT", round(duration, 1)),
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
        t = _safe_int(row.get("tick"))
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


def _lookup_position_full(ticks_df, tick: int, steamid: str) -> dict | None:
    """Return X, Y, Z, yaw, pitch for a player at (or near) a given tick.
    Used for the CS2 setpos/setang lineup-copy feature."""
    if not steamid or ticks_df is None or len(ticks_df) == 0:
        return None
    sid_str = str(steamid)
    exact = ticks_df[(ticks_df["tick"] == tick) & (ticks_df["steamid"] == sid_str)]
    if len(exact) > 0:
        row = exact.iloc[0]
    else:
        nearby = ticks_df[
            (ticks_df["steamid"] == sid_str)
            & (ticks_df["tick"] >= tick - 64)
            & (ticks_df["tick"] <= tick + 64)
        ]
        if len(nearby) == 0:
            return None
        row = nearby.iloc[(nearby["tick"] - tick).abs().argmin()]
    def _f(col, default=0.0):
        v = row.get(col)
        try:
            return round(float(v), 3) if v is not None and not _is_nan(v) else default
        except (TypeError, ValueError):
            return default
    return {
        "x": _f("X"), "y": _f("Y"), "z": _f("Z"),
        "yaw": _f("yaw"), "pitch": _f("pitch"),
    }


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


def _detect_team_orientation(
    ticks_df, rounds: list[dict], map_name: str,
    bomb_planted_df=None,
) -> dict[int, str]:
    """
    Decide whether ``team_num=2`` means T (canonical CS2) or CT (some
    FACEIT / community / 5v5 demos invert this) on THIS specific demo.

    Strategy: try the strongest signal first, fall back as needed.

      W. **Bomb planter** — only Terrorists can plant the C4, so the
         planter's ``team_num`` IS the T team_num. 100% reliable when
         a plant exists in the first half. Doesn't depend on any map
         metadata, so it can't be fooled by stale spawn coordinates.

      A. **Spawn proximity** — at round 1's freeze-end + ~2 s, the team
         that's closer to the map's CT spawn IS the CT team. Needs the
         map to be registered in services.maps; skipped otherwise. Stale
         coords here led to a Mirage scrim being silently inverted —
         hence the bomb-planter check above takes priority.

      B. **Round-1 survivor count** — round 1 always ends with one side
         having more living players than the other (or it ended in a
         plant / defuse / explode). The side with more survivors at
         end_tick - 1 should match the recorded ``winner`` of round 1.
         This works on EVERY map and doesn't need any registry.

    Returns the resolved mapping dict. Logs heavily so the user can
    diagnose when something's off.
    """
    if ticks_df is None or len(ticks_df) == 0 or not rounds:
        logger.info("Team orientation skipped: no ticks / no rounds.")
        return _TEAM_NUM_TO_SIDE

    # ---------- Check W: bomb planter is definitively a Terrorist --------
    # Pick the FIRST plant in the first half (regulation rounds 1..12) and
    # look up the planter's team_num near the plant tick. Only Ts can plant,
    # so that team_num IS the T team_num — no ambiguity, no map dependency.
    weapons_verdict: dict[int, str] | None = None
    if bomb_planted_df is not None and len(bomb_planted_df) > 0:
        half1_cutoff = int(rounds[min(11, len(rounds) - 1)]["endTick"])
        for _, row in bomb_planted_df.iterrows():
            try:
                plant_tick = int(row.get("tick"))
            except (TypeError, ValueError):
                continue
            if plant_tick > half1_cutoff:
                continue
            sid = str(row.get("user_steamid") or "")
            if not sid:
                continue
            near = ticks_df[
                (ticks_df["tick"] >= plant_tick - 16)
                & (ticks_df["tick"] <= plant_tick + 16)
                & (ticks_df["steamid"].astype(str) == sid)
            ]
            if len(near) == 0:
                continue
            tn = _safe_int(near.iloc[0].get("team_num"))
            if tn not in (2, 3):
                continue
            # tn is the planter's team — definitionally Terrorist.
            weapons_verdict = {tn: "tt", (5 - tn): "ct"}
            logger.info(
                "Team detect: bomb planter sid=%s team_num=%d → T team_num=%d. Verdict: %s",
                sid, tn, tn, weapons_verdict,
            )
            break
    if weapons_verdict:
        if weapons_verdict == _TEAM_NUM_TO_SIDE:
            logger.info("Team orientation canonical (confirmed by bomb planter).")
            return _TEAM_NUM_TO_SIDE
        if weapons_verdict == _TEAM_NUM_TO_SIDE_FLIPPED:
            logger.warning(
                "Team orientation INVERTED (confirmed by bomb planter — overrides "
                "spawn/survivor heuristics). Using flipped mapping {2:ct,3:tt}."
            )
            return _TEAM_NUM_TO_SIDE_FLIPPED

    # ---------- Check B: round 1 survivor count ----------
    # Easier to implement first and works for every map.
    r1 = rounds[0]
    end_tick = int(r1["endTick"])
    winner = r1["winner"]  # "ct" or "tt"
    # Sample just BEFORE end_tick — at end_tick itself, players may have
    # already been respawned for the next round depending on the demo.
    snapshot_tick = end_tick - 16
    near = ticks_df[(ticks_df["tick"] >= snapshot_tick - 16) & (ticks_df["tick"] <= snapshot_tick + 4)]
    survivors_by_tn: dict[int, int] = {2: 0, 3: 0}
    counted_sids: set[str] = set()
    if len(near) > 0:
        for _, row in near.iterrows():
            sid = str(row.get("steamid") or "")
            if not sid or sid in counted_sids:
                continue
            tn = _safe_int(row.get("team_num"))
            if tn not in (2, 3):
                continue
            if not bool(row.get("is_alive") or False):
                continue
            counted_sids.add(sid)
            survivors_by_tn[tn] += 1

    winner_tn: int | None = None
    # Whichever team has MORE survivors is the round-1 winner.
    if survivors_by_tn[2] != survivors_by_tn[3]:
        winner_tn = 2 if survivors_by_tn[2] > survivors_by_tn[3] else 3
    logger.info(
        "Team detect: round1 winner='%s', survivors @tick%d → tn2=%d, tn3=%d, winner_tn=%s",
        winner, snapshot_tick, survivors_by_tn[2], survivors_by_tn[3], winner_tn,
    )

    survivor_verdict: dict[int, str] | None = None
    if winner_tn is not None:
        if winner == "ct":
            # The winning team_num IS the CT team_num.
            survivor_verdict = {winner_tn: "ct", (5 - winner_tn): "tt"}
        elif winner == "tt":
            survivor_verdict = {winner_tn: "tt", (5 - winner_tn): "ct"}
    # 5 - 2 = 3 and 5 - 3 = 2 — trick to flip 2↔3 cleanly.

    # ---------- Check A: spawn proximity ----------
    spawn_verdict: dict[int, str] | None = None
    try:
        from services.maps import get_map
        m = get_map(map_name)
    except Exception:
        m = None
    if m and getattr(m, "spawn_ct", None) and getattr(m, "spawn_tt", None):
        spawn_ct = m.spawn_ct
        spawn_tt = m.spawn_tt
        target_tick = int(rounds[0]["startTick"]) + 128
        near_sp = ticks_df[
            (ticks_df["tick"] >= target_tick - 32) & (ticks_df["tick"] <= target_tick + 32)
        ]
        by_team: dict[int, list[tuple[float, float]]] = {}
        for _, row in near_sp.iterrows():
            tn = _safe_int(row.get("team_num"))
            if tn not in (2, 3) or not bool(row.get("is_alive") or False):
                continue
            x = _safe_float(row.get("X"))
            y = _safe_float(row.get("Y"))
            by_team.setdefault(tn, []).append((x, y))

        def _avg_d2(pts, spawn):
            if not pts:
                return float("inf")
            return sum((p[0] - spawn[0]) ** 2 + (p[1] - spawn[1]) ** 2 for p in pts) / len(pts)

        if 2 in by_team and 3 in by_team:
            d2_ct = _avg_d2(by_team[2], spawn_ct)
            d2_tt = _avg_d2(by_team[2], spawn_tt)
            d3_ct = _avg_d2(by_team[3], spawn_ct)
            d3_tt = _avg_d2(by_team[3], spawn_tt)
            t2_is_ct = d2_ct < d2_tt
            t3_is_ct = d3_ct < d3_tt
            logger.info(
                "Team detect: spawn-proximity dist² tn2(ct=%.0f, tt=%.0f) tn3(ct=%.0f, tt=%.0f)",
                d2_ct, d2_tt, d3_ct, d3_tt,
            )
            if t2_is_ct != t3_is_ct:
                spawn_verdict = {
                    2: "ct" if t2_is_ct else "tt",
                    3: "ct" if t3_is_ct else "tt",
                }
    else:
        logger.info("Team detect: spawn check skipped (map '%s' not registered or missing spawns)", map_name)

    # ---------- Consensus ----------
    if spawn_verdict and survivor_verdict:
        if spawn_verdict == survivor_verdict:
            verdict = spawn_verdict
            logger.info("Team detect: both checks agree → %s", verdict)
        else:
            # When the checks disagree, spawn proximity wins. The
            # survivor count is unreliable in two cases: (a) round 1
            # winner field can be wrong if the demo includes a knife
            # round that's tagged as R1, and (b) survivors at end_tick
            # are sometimes the LOSING team if the winning condition
            # was a bomb explosion / defuse rather than elimination.
            # Spawn coords don't have those failure modes — players are
            # always near their spawn at freeze_end.
            verdict = spawn_verdict
            logger.warning(
                "Team detect: checks DISAGREE (spawn=%s, survivor=%s) — using SPAWN verdict",
                spawn_verdict, survivor_verdict,
            )
    elif survivor_verdict:
        verdict = survivor_verdict
        logger.info("Team detect: using survivor verdict → %s", verdict)
    elif spawn_verdict:
        verdict = spawn_verdict
        logger.info("Team detect: using spawn verdict → %s", verdict)
    else:
        logger.warning("Team detect: NO verdict from either check — keeping canonical {2:tt,3:ct}")
        return _TEAM_NUM_TO_SIDE

    if verdict == _TEAM_NUM_TO_SIDE:
        logger.info("Team orientation canonical (team_num=2→T, 3→CT).")
        return _TEAM_NUM_TO_SIDE
    if verdict == _TEAM_NUM_TO_SIDE_FLIPPED:
        logger.warning(
            "Team orientation INVERTED on this demo (team_num=2→CT). "
            "Using flipped mapping {2:ct,3:tt}."
        )
        return _TEAM_NUM_TO_SIDE_FLIPPED
    # Shouldn't happen, but log+default if it does.
    logger.warning("Team detect: unexpected verdict %s — defaulting to canonical", verdict)
    return _TEAM_NUM_TO_SIDE


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


def _safe_int(v: Any, default: int = 0) -> int:
    """
    Coerce to int with NaN/None tolerance.

    Pandas DataFrames return NaN (a float) for missing numeric cells,
    NOT None. ``int(NaN)`` raises ``ValueError`` — and the common
    ``int(row.get("x") or 0)`` idiom also breaks because NaN is truthy
    (so the ``or`` never substitutes the default). Use this helper for
    every coercion of a pandas-sourced numeric.
    """
    if v is None:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if math.isnan(f) or math.isinf(f):
        return default
    return int(f)


def _safe_float(v: Any, default: float = 0.0) -> float:
    """Same as _safe_int but for floats."""
    if v is None:
        return default
    try:
        f = float(v)
    except (TypeError, ValueError):
        return default
    if math.isnan(f) or math.isinf(f):
        return default
    return f



# ===========================================================================
# Quality gate — raised when the parse output fails sanity checks.
# Caught by the subprocess wrapper, which marks the Demo failed with the
# explanation as its error_message instead of persisting broken data.
# ===========================================================================
class ParseQualityError(ValueError):
    """The parser produced output that fails minimum-sanity checks.

    Distinct from a parser crash — the parse ran to completion but the
    result is clearly malformed (too few rounds, too few players, no
    score). We surface it as a specific exception so the wrapper can
    set a clear error_message instead of dumping a stack trace.
    """


# Quality gate thresholds — configurable via env so the operator can
# relax them for non-standard formats (showmatches, scrims, 2v2s)
# without touching code.
#
# Defaults match competitive CS2 (MR12 = first to 13, always 5v5).
import os as _os

# Lowered from 13/10 to 6/8 so we accept forfeits (Bo1 ending 6-0),
# short overtime-less Bo1s, and standard 5v5 demos where one player
# briefly dropped (gives players=9). Pure-junk demos (warmup-only,
# knife rounds, recording started mid-match) still get rejected.
_MIN_VALID_ROUNDS = int(_os.environ.get("PARSE_MIN_ROUNDS", "6"))
_MIN_VALID_PLAYERS = int(_os.environ.get("PARSE_MIN_PLAYERS", "8"))


def _validate_parse_quality(
    *,
    map_name: str | None,
    rounds: int,
    players: int,
    score_a: int | None,
    score_b: int | None,
) -> None:
    """Raise ``ParseQualityError`` when the parsed result is obviously broken.

    Called at the very end of ``parse()`` before returning. The checks
    are conservative on purpose — we would rather mark a real match
    failed (operator can reprocess) than persist a broken one that
    quietly hits the public feed.

    Thresholds can be lowered via env vars ``PARSE_MIN_ROUNDS`` and
    ``PARSE_MIN_PLAYERS`` (e.g. ``PARSE_MIN_ROUNDS=6`` accepts short
    showmatches; ``PARSE_MIN_PLAYERS=2`` accepts 1v1s).
    """
    issues: list[str] = []
    if rounds < _MIN_VALID_ROUNDS:
        issues.append(
            f"only {rounds} rounds detected (minimum {_MIN_VALID_ROUNDS})"
        )
    if players < _MIN_VALID_PLAYERS:
        issues.append(
            f"only {players} players detected (expected {_MIN_VALID_PLAYERS})"
        )
    if score_a is None or score_b is None:
        issues.append("score could not be determined")
    elif (score_a + score_b) < _MIN_VALID_ROUNDS:
        issues.append(
            f"final score sum {score_a}+{score_b} below minimum match length"
        )
    if issues:
        raise ParseQualityError(
            "Demo failed quality check"
            + (f" ({map_name})" if map_name else "")
            + ": "
            + "; ".join(issues)
        )

