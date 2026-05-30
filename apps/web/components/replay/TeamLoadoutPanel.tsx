"use client";

import { useRef, useState } from "react";

import { Wrench } from "lucide-react";

import { cn } from "@/lib/utils";
import { normalizeWeaponName, weaponIconUrl } from "@/components/replay/weaponIcons";
import type {
  FramePlayer,
  PlayerLoadout,
  PlayerStats,
  TimelineEvent,
  TimelineFrame,
} from "@/types/demo";

// Set of canonical grenade keys that map onto the slot icons.
const GRENADE_SLOT_KEYS = [
  "smokegrenade",
  "flashbang",
  "hegrenade",
  "molotov",
  "incgrenade",
  "decoy",
] as const;
type GrenadeSlotKey = (typeof GRENADE_SLOT_KEYS)[number];

// Engine / display-name variants the parser might emit for each
// grenade. Mirrors the relevant subset of ``WEAPON_ALIASES`` in
// ``weaponIcons.ts``. We duplicate here because the alias table
// isn't exported (it shouldn't be — it's an icon-resolution
// implementation detail), and the alternative would be making
// the panel reach into private state of an unrelated module.
//
// ``high_explosive`` is the demoparser2 display name for the HE
// grenade (with the underscore — that's what made "HIGH" leak
// through as a text fallback in the user's screenshot). The
// joined ``highexplosive`` form is the post-strip variant in case
// some demos emit ``high-explosive`` or similar.
const GRENADE_NAME_ALIASES: Record<string, GrenadeSlotKey> = {
  smoke:                  "smokegrenade",
  smokegrenadeprojectile: "smokegrenade",
  flash:                  "flashbang",
  flashgrenade:           "flashbang",
  flashbangs:             "flashbang",
  he:                     "hegrenade",
  hegren:                 "hegrenade",
  highexplosive:          "hegrenade",
  high_explosive:         "hegrenade",
  high_explosive_grenade: "hegrenade",
  // demoparser2's ``active_weapon_name`` often returns the human
  // display name "High Explosive Grenade" / "Incendiary Grenade"
  // / "Smoke Grenade" etc. After ``replace("weapon_", "")`` and
  // ``normalizeWeaponName`` (which strips spaces) these collapse
  // into the joined forms below.
  highexplosivegrenade:   "hegrenade",
  he_grenade:             "hegrenade",
  hegrenadeprojectile:    "hegrenade",
  inferno:                "incgrenade",
  incendiary:             "incgrenade",
  incendiarygrenade:      "incgrenade",
  firegrenade:            "incgrenade",
  inc:                    "incgrenade",
  molotovgrenade:         "molotov",
  molotovprojectile:      "molotov",
  decoygrenade:           "decoy",
};

// Comprehensive set of CS2 knife engine / display names. The
// previous detection only matched strings containing the literal
// ``knife`` substring, which misses every workshop skin name
// (``karambit``, ``butterfly``, ``bayonet``, ``m9bayonet``, …).
// The user's screenshot showed "KARA" text falling through to the
// weapon column for a karambit because of this gap — strict
// "only real weapons" requires us to detect every knife variant
// so they can be filtered out.
const KNIFE_NAMES = new Set<string>([
  "bayonet",
  "karambit",
  "butterfly",
  "m9bayonet",
  "m9_bayonet",
  "bowie",
  "huntsman",
  "gut",
  "flip",
  "falchion",
  "tactical",
  "shadowdaggers",
  "shadow_daggers",
  "ursus",
  "navaja",
  "stiletto",
  "talon",
  "skeleton",
  "nomad",
  "paracord",
  "survival",
  "classic",
  "widowmaker",
  // Operation Riptide / community knives
  "canis",
  "cord",
  "outdoor",
  "push",
]);

/**
 * Map a raw weapon name to one of the six canonical grenade
 * slot keys — or ``null`` if the weapon isn't a grenade.
 * Used to detect "the player is currently holding a utility"
 * so we can glow the matching slot in the feed rather than
 * letting the grenade replace the primary weapon icon.
 *
 * Resolution order:
 *   1. Exact match against ``GRENADE_NAME_ALIASES`` or
 *      ``GRENADE_SLOT_KEYS`` (the canonical engine names plus
 *      every variant we've seen the parser emit explicitly).
 *   2. Prefix-based fallback for parser variants we haven't
 *      enumerated yet ("highexp…" / "incend…" / "smokegr…"
 *      / etc.). The prefixes are tight enough not to false-
 *      positive on real firearm names (no firearm starts with
 *      "smoke", "flash", "molotov", "decoy", "inferno", or
 *      "firebomb"; "he_" / "high" are specific enough on their
 *      own; "ince" doesn't collide with any rifle name).
 */
function liveGrenadeKey(weapon: string | undefined | null): GrenadeSlotKey | null {
  if (!weapon) return null;
  const k = normalizeWeaponName(weapon);

  // 1. Exact-match path
  const aliased = (k in GRENADE_NAME_ALIASES ? GRENADE_NAME_ALIASES[k] : k) as string;
  if ((GRENADE_SLOT_KEYS as readonly string[]).includes(aliased)) {
    return aliased as GrenadeSlotKey;
  }

  // 2. Prefix fallback for unknown parser variants
  if (k.startsWith("smoke")) return "smokegrenade";
  if (k.startsWith("flash")) return "flashbang";
  if (k.startsWith("high") || k === "he" || k.startsWith("he_") || k.startsWith("hegren")) {
    return "hegrenade";
  }
  if (k.startsWith("incendiary") || k.startsWith("ince") || k.startsWith("inferno") || k.startsWith("firebomb") || k.startsWith("inc_")) {
    return "incgrenade";
  }
  if (k.startsWith("molotov")) return "molotov";
  if (k.startsWith("decoy")) return "decoy";

  return null;
}

/** True when the weapon is any knife variant (incl. workshop skin names). */
function isKnife(weapon: string | undefined | null): boolean {
  if (!weapon) return false;
  const k = normalizeWeaponName(weapon);
  // Fast path: any string containing "knife" (engine names like
  // ``weapon_knife_t``, ``knife_karambit``) or the explicit
  // bayonet form.
  if (k === "bayonet" || k.includes("knife")) return true;
  // Workshop skin path: ``karambit`` / ``butterfly`` / ``m9bayonet``
  // / … carry no "knife" substring, so they need an explicit
  // lookup against the curated set.
  return KNIFE_NAMES.has(k);
}

/**
 * True when the weapon is any utility (knife OR grenade). Used to
 * decide whether the live weapon should be displayed in the
 * "weapon" column or whether we should fall back to a remembered
 * primary.
 */
function isUtility(weapon: string | undefined | null): boolean {
  return isKnife(weapon) || liveGrenadeKey(weapon) !== null;
}

interface TeamLoadoutPanelProps {
  frame: TimelineFrame | null;
  loadouts: Record<string, PlayerLoadout> | undefined;
  playerLookup: Map<string, PlayerStats>;
  /**
   * Past grenade-throw events for THIS round. Used to subtract from
   * the round-start grenade inventory so the slots accurately show
   * what each player has RIGHT NOW. Optional — when omitted, the
   * slots fall back to the round-start counts.
   */
  pastEvents?: TimelineEvent[];
  ctAlive?: number;
  ttAlive?: number;
  ctScore?: number;
  ttScore?: number;
  ctName?: string;
  ttName?: string;
  focusedSteamId?: string | null;
  onHover?: (steamId: string | null) => void;
  /**
   * Current round number. Used to scope the per-player "best
   * primary weapon seen this round" cache — when the round
   * changes, the cache resets so the previous round's primary
   * doesn't leak into the new one (relevant for players who died
   * and now start with just a knife).
   */
  roundNumber?: number;
}

/**
 * cs2.cam-style team loadout panels — one card per team with a per-player
 * row showing nick on the left, weapon icon + cash on the right, and a
 * compact equipment strip (helmet / kit / 4 grenade slots) below.
 *
 *   ┌─ CYBERSHOKE ────────── 1 ┐
 *   │ alpha--               $50 │
 *   │ AK47   🛡 🔧 ◯ ◯ ◯ ◯       │
 *   ├──────────────────────────┤
 *   │ ...                       │
 *   └──────────────────────────┘
 */
export function TeamLoadoutPanel({
  frame,
  loadouts,
  playerLookup,
  pastEvents,
  ctAlive,
  ttAlive,
  ctScore,
  ttScore,
  ctName = "Team CT",
  ttName = "Team T",
  focusedSteamId,
  onHover,
  roundNumber,
}: TeamLoadoutPanelProps) {
  const teamCt: FramePlayer[] = [];
  const teamTt: FramePlayer[] = [];

  const fromFrame = frame?.players;
  if (fromFrame && fromFrame.length > 0) {
    for (const p of fromFrame) (p.team === "ct" ? teamCt : teamTt).push(p);
  } else {
    playerLookup.forEach((p) => {
      const ghost: FramePlayer = {
        steamId: p.steamId,
        team: p.team,
        name: p.name,
        x: 0,
        y: 0,
        alive: true,
        hp: 100,
      };
      (p.team === "ct" ? teamCt : teamTt).push(ghost);
    });
  }

  return (
    <div className="space-y-2">
      <TeamCard
        team="ct"
        teamName={ctName}
        score={ctScore}
        players={teamCt}
        loadouts={loadouts}
        playerLookup={playerLookup}
        pastEvents={pastEvents}
        alive={ctAlive ?? teamCt.filter((p) => p.alive).length}
        focusedSteamId={focusedSteamId ?? null}
        onHover={onHover}
        roundNumber={roundNumber}
        currentT={frame?.t}
      />
      <TeamCard
        team="tt"
        teamName={ttName}
        score={ttScore}
        players={teamTt}
        loadouts={loadouts}
        playerLookup={playerLookup}
        pastEvents={pastEvents}
        alive={ttAlive ?? teamTt.filter((p) => p.alive).length}
        focusedSteamId={focusedSteamId ?? null}
        onHover={onHover}
        roundNumber={roundNumber}
        currentT={frame?.t}
      />
    </div>
  );
}

/**
 * Single-team variant — used when the two team cards live in separate
 * floating panels so each one can be moved/resized independently.
 */
export function SingleTeamLoadoutPanel({
  team,
  teamName,
  frame,
  loadouts,
  playerLookup,
  pastEvents,
  score,
  alive,
  focusedSteamId,
  onHover,
  roundNumber,
}: {
  team: "ct" | "tt";
  teamName: string;
  frame: TimelineFrame | null;
  loadouts: Record<string, PlayerLoadout> | undefined;
  playerLookup: Map<string, PlayerStats>;
  pastEvents?: TimelineEvent[];
  score?: number;
  alive?: number;
  focusedSteamId?: string | null;
  onHover?: (steamId: string | null) => void;
  /**
   * Current round number — used to scope the per-player "best
   * primary seen this round" cache so it resets cleanly between
   * rounds. See ``TeamCard`` for the cache itself.
   */
  roundNumber?: number;
}) {
  // Collect this team's players from the current frame (preferred) or
  // fall back to the player lookup so empty frames still render the
  // roster names.
  const players: FramePlayer[] = [];
  const fromFrame = frame?.players;
  if (fromFrame && fromFrame.length > 0) {
    for (const p of fromFrame) if (p.team === team) players.push(p);
  } else {
    playerLookup.forEach((p) => {
      if (p.team === team) {
        players.push({
          steamId: p.steamId,
          team: p.team,
          name: p.name,
          x: 0,
          y: 0,
          alive: true,
          hp: 100,
        });
      }
    });
  }
  return (
    <TeamCard
      team={team}
      teamName={teamName}
      score={score}
      players={players}
      loadouts={loadouts}
      playerLookup={playerLookup}
      pastEvents={pastEvents}
      alive={alive ?? players.filter((p) => p.alive).length}
      focusedSteamId={focusedSteamId ?? null}
      onHover={onHover}
      roundNumber={roundNumber}
      currentT={frame?.t}
    />
  );
}

function TeamCard({
  team,
  teamName,
  score,
  players,
  loadouts,
  playerLookup,
  pastEvents,
  alive,
  focusedSteamId,
  onHover,
  roundNumber,
  currentT,
}: {
  team: "ct" | "tt";
  teamName: string;
  score?: number;
  players: FramePlayer[];
  loadouts: Record<string, PlayerLoadout> | undefined;
  playerLookup: Map<string, PlayerStats>;
  pastEvents?: TimelineEvent[];
  alive: number;
  focusedSteamId: string | null;
  onHover?: (steamId: string | null) => void;
  roundNumber?: number;
  /**
   * Current playback time (seconds into the round). Used by
   * ``GrenadeSlots`` to keep a thrown grenade visible in the
   * inventory until it actually detonates (smoke puffs / molotov
   * ignites / HE explodes / flash pops) — without this the
   * round-start grenade gets subtracted the moment the player
   * releases the throw button, which is too early.
   */
  currentT?: number;
}) {
  void alive;
  // ─── Per-player "best primary seen this round" cache ────────────
  //
  // The parser's ``loadout.weapon`` snapshot is taken at ~5 s into
  // each round. If a player hasn't finished buying by then, the
  // snapshot captures a knife — and from the user's POV the row
  // looks "weaponless" forever even after the player buys an AK.
  //
  // To fix this without round-tripping through the parser we
  // accumulate evidence frame by frame: whenever any player's
  // LIVE weapon is a real firearm (not knife / not grenade), we
  // remember it. Later, when the same player is mid-flash-throw
  // and the live + loadout both look like utilities, we fall
  // back to the remembered firearm — so the rifle stays visible
  // through every utility / knife frame.
  //
  // Persists across re-renders via ``useRef`` (a plain JS Map
  // mutation doesn't trigger React state updates). Resets when
  // ``roundNumber`` changes so the cache doesn't leak the
  // previous round's primary into a new round where the player
  // might have died and started knife-only.
  const primaryCacheRef = useRef<Map<string, string>>(new Map());
  const lastRoundRef = useRef<number | undefined>(undefined);
  if (roundNumber !== lastRoundRef.current) {
    primaryCacheRef.current = new Map();
    lastRoundRef.current = roundNumber;
  }

  // Seed the cache from the round-start loadout when its weapon
  // happens to be a real firearm (most rounds the snapshot
  // catches the player AFTER they've bought). This gives the
  // cache something to fall back to even on the very first frame
  // a user opens.
  if (loadouts) {
    for (const p of players) {
      if (primaryCacheRef.current.has(p.steamId)) continue;
      const lw = loadouts[p.steamId]?.weapon;
      if (lw && !isUtility(lw)) {
        primaryCacheRef.current.set(p.steamId, lw);
      }
    }
  }

  // Update the cache from the current frame: any non-utility live
  // weapon is the freshest signal we can get of what the player
  // currently has as their primary.
  for (const p of players) {
    const lw = p.weapon;
    if (lw && !isUtility(lw)) {
      primaryCacheRef.current.set(p.steamId, lw);
    }
  }

  // Team-coloured border + accent on the outer panel + as the
  // per-player separator (HP bar). Matches the user's reference
  // mockup: each panel reads as a self-contained "team card"
  // outlined in its team colour, with HP bars between rows doubling
  // as separator lines.
  const borderClass = team === "ct" ? "border-ct/70" : "border-tt/70";
  return (
    <div
      className={cn(
        "w-full rounded-xl bg-[#0c0f14] shadow-2xl overflow-hidden flex flex-col border-2",
        borderClass,
      )}
    >
      {/* Header — team name on the left, score on the right, both
          white. A team-coloured underline separates the header from
          the player roster (mirrors the team-colour HP bars between
          each player below). */}
      <div className="h-9 px-3 flex items-center justify-between shrink-0 bg-surface-elevated/30">
        <span
          className="text-[12px] font-bold tracking-wide truncate text-white"
          title={teamName}
        >
          {teamName}
        </span>
        {score !== undefined && (
          <span className="font-display font-extrabold text-xl tabular-nums leading-none text-white">
            {score}
          </span>
        )}
      </div>

      {/* Player blocks. Between every pair of players we render an HP
          bar — the bar's WIDTH carries the current player's HP, and
          its COLOUR carries team identity. Two birds, one signal.
          The top player gets a header-touching HP bar (acts like
          the team-colour underline of the header too). */}
      <div className="flex flex-col">
        {players.map((p, idx) => (
          <LoadoutRow
            key={p.steamId}
            player={p}
            stats={playerLookup.get(p.steamId)}
            loadout={loadouts?.[p.steamId]}
            pastEvents={pastEvents}
            focused={focusedSteamId === p.steamId}
            onHover={onHover}
            isFirst={idx === 0}
            cachedPrimary={primaryCacheRef.current.get(p.steamId)}
            currentT={currentT}
          />
        ))}
      </div>
    </div>
  );
}

function LoadoutRow({
  player,
  stats,
  loadout,
  pastEvents,
  focused,
  onHover,
  isFirst,
  cachedPrimary,
  currentT,
}: {
  player: FramePlayer;
  stats: PlayerStats | undefined;
  loadout: PlayerLoadout | undefined;
  pastEvents?: TimelineEvent[];
  focused: boolean;
  onHover?: (steamId: string | null) => void;
  isFirst: boolean;
  /**
   * Round-scoped fallback: the most recent non-utility weapon the
   * parent ``TeamCard`` has seen this player hold during this
   * round. Used as the last resort when both ``player.weapon``
   * (live) and ``loadout.weapon`` (round-start snapshot) look
   * like utilities — so the rifle stays visible even on frames
   * where the player is mid-flash-throw and the snapshot caught
   * an early knife.
   */
  cachedPrimary?: string;
  /** Current playback time in seconds. Forwarded to ``GrenadeSlots``. */
  currentT?: number;
}) {
  const dead = !player.alive;
  const team = player.team;
  const armor = loadout?.armor ?? 0;
  const helmet = loadout?.helmet ?? false;
  const kit = loadout?.kit ?? false;
  const money = loadout?.money;
  const hp = dead ? 0 : Math.max(0, Math.min(100, player.hp ?? 100));
  // Weapon-to-show resolution — three-tier fallback.
  //
  // The weapon column ONLY ever shows a real firearm (rifle /
  // pistol / SMG / shotgun / sniper). Knives and grenades are
  // never displayed in this slot — per the user's spec "solo
  // queden las armas".
  //
  //   1. LIVE weapon, if it's a real firearm. Most up-to-date.
  //   2. LOADOUT primary (round-start snapshot), if it's a real
  //      firearm. Stable across mid-round throws.
  //   3. CACHED primary — the most recent non-utility weapon
  //      the parent ``TeamCard`` has seen this player hold this
  //      round. Catches the case where the parser snapshot at
  //      5 s into the round happened to land on a knife (player
  //      hadn't bought yet) but the player has since picked up a
  //      rifle. Without this tier the rifle would never appear.
  //   4. Empty column — no real firearm ever observed. The
  //      player is genuinely weaponless (just spawned with knife,
  //      hasn't bought).
  //
  // The grenade-in-hand state is communicated SEPARATELY via
  // ``heldGrenade``, which lights up the matching slot below.
  const liveWeapon = player.weapon ?? undefined;
  const fallbackWeapon = loadout?.weapon ?? undefined;
  const heldGrenade = liveGrenadeKey(liveWeapon);
  const liveIsUtility = heldGrenade !== null || isKnife(liveWeapon);
  const fallbackIsUtility = liveGrenadeKey(fallbackWeapon) !== null || isKnife(fallbackWeapon);
  // Sanity-filter the cache too — if a utility somehow slipped past
  // the earlier ``!isUtility`` guard during cache writes (e.g. a
  // parser variant the prefix fallback hadn't classified yet) we
  // refuse to display it here.
  const safeCachedPrimary = cachedPrimary && !isUtility(cachedPrimary) ? cachedPrimary : undefined;
  const weapon =
    liveWeapon && !liveIsUtility
      ? liveWeapon
      : fallbackWeapon && !fallbackIsUtility
        ? fallbackWeapon
        : safeCachedPrimary;
  const displayName = player.name || stats?.name || "—";
  const teamTextClass = team === "ct" ? "text-ct" : "text-tt";

  // --- Setpos copy — always available while the player is alive ---
  // Uses the player's current frame position (x, y, z) + yaw so you
  // can paste it in CS2 and land exactly where they stood at this moment.
  const [copied, setCopied] = useState(false);
  const lineupCmd = player.alive && player.x != null && player.y != null
    ? `setpos ${player.x} ${player.y} ${player.z ?? 0}; setang 0 ${player.yaw ?? 0}`
    : null;

  const copyLineup = () => {
    if (!lineupCmd) return;
    navigator.clipboard.writeText(lineupCmd).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  // Monochrome feed (user spec): every text element renders white;
  // the HP bar is the ONE coloured signal, tinted by team — blue for
  // CT, orange for TT. The bar therefore tells you both "this player's
  // health" AND "which side they're on" in a single visual.
  void teamTextClass;
  const teamBgClass = team === "ct" ? "bg-ct" : "bg-tt";
  const hpColor = teamBgClass; // CT → blue (bg-ct), TT → orange (bg-tt)

  // Ultra-compact 2-row layout (alive) / 1-row layout (dead).
  //
  //   ALIVE (~30 px):
  //   ┌────────────────────────────────────────┐
  //   │ NAME-team           $MONEY      [AK]   │ line 1 (~14 px)
  //   │ ▆▆▆ HP ▆▆ 87  🛡 🔧             ●●●●  │ line 2 (~14 px)
  //   └────────────────────────────────────────┘
  //
  //   DEAD (~22 px):
  //   ┌────────────────────────────────────────┐
  //   │ NAME-team (strike)              $0  ✕  │ single line
  //   └────────────────────────────────────────┘
  //
  // Natural heights via ``shrink-0`` — panel is sized to content in
  // locked mode, not stretched. Matches the cs2.cam-style reference
  // (tight stack, only the space it needs).
  // FIXED-HEIGHT row.
  //
  // We always render the same two-line skeleton (name + equipment)
  // regardless of alive state, so dead players don't make the panel
  // visibly shrink mid-round. Dead players show the same widgets
  // dimmed + with their values replaced by safe placeholders (HP=0
  // bar, armor/kit off, weapon icon swapped for the ✕ glyph,
  // grenade slots all faded). The user can still see "this player
  // had X" at a glance without the panel reshuffling on every kill.
  // New layout (mockup spec):
  //
  //   ┌───────────────────────────────────────────────┐
  //   │ IDONTKN0W                       [AK-47-icon]  │ line 1
  //   │ 🛡 $150                          ⬛ ⬛ ⬛       │ line 2
  //   │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │ HP bar = separator
  //   └───────────────────────────────────────────────┘
  //
  // The HP BAR doubles as the row separator. At 100 HP it spans the
  // full panel width, looking like a clean team-coloured rule
  // between players. As HP drops, the bar shortens from the right —
  // a tactically meaningful info packed into chrome that would
  // otherwise be purely decorative.
  return (
    <>
      {/* Optional first-row top separator — same colour + thickness
          as the HP bars below, so the header has a matching rule
          under it. (Top player's HP bar still sits at the BOTTOM of
          their row, between them and the next player.) */}
      {isFirst && (
        <div className="h-px w-full bg-border/40" aria-hidden />
      )}

      <div
        onMouseEnter={() => onHover?.(player.steamId)}
        onMouseLeave={() => onHover?.(null)}
        className={cn(
          "relative shrink-0 px-3 py-2 flex flex-col gap-1 cursor-default transition-colors",
          "hover:bg-surface-elevated/30",
          focused && "bg-surface-elevated/45",
          dead && "opacity-55",
        )}
      >
        {/* Focused accent: 2 px primary-coloured bar on the LEFT edge
            when the row is hovered from the map. */}
        {focused && (
          <span
            aria-hidden
            className="absolute left-0 top-0 bottom-0 w-[2px] bg-primary"
          />
        )}

        {/* Line 1: NAME (left) + WEAPON silhouette (right). */}
        <div className="flex items-center justify-between gap-2 min-w-0">
          <button
            onClick={lineupCmd ? copyLineup : undefined}
            className={cn(
              "font-bold uppercase tracking-wide text-[12px] truncate min-w-0 text-left",
              dead && "line-through opacity-70",
              lineupCmd && !copied && "text-white hover:text-primary transition-colors cursor-pointer",
              copied && "text-[hsl(142_70%_60%)]",
              !lineupCmd && "text-white cursor-default",
            )}
            title={
              copied
                ? "¡Copiado!"
                : lineupCmd
                  ? `${displayName} — Click para copiar lineup CS2`
                  : displayName
            }
          >
            {copied ? "¡Copiado!" : displayName}
          </button>
          {dead ? (
            <span className="text-white/80 text-[11px] font-bold">✕</span>
          ) : (
            <WeaponSilhouette weapon={weapon} />
          )}
        </div>

        {/* Line 2: ARMOR + $MONEY (left) ... GRENADE SLOTS (right). */}
        <div className="flex items-center gap-2 min-w-0">
          <ArmorIcon hasArmor={!dead && armor > 0} hasHelmet={!dead && helmet} />
          <span className="font-mono-rs tabular-nums text-[10px] font-medium text-white/90">
            {money !== undefined ? `$${money}` : "—"}
          </span>
          {!dead && kit && <KitIcon hasKit={kit} />}
          <div className="ml-auto">
            <GrenadeSlots
              loadout={dead ? undefined : loadout}
              steamId={player.steamId}
              pastEvents={pastEvents}
              heldKey={dead ? null : heldGrenade}
              currentT={currentT}
            />
          </div>
        </div>
      </div>

      {/* HP BAR = SEPARATOR. Renders below every player (including
          the LAST one, where it sits just inside the panel border —
          looks like a finishing rule). Width = HP percentage; full
          width when alive at 100 hp, shrinks to a stub when low,
          empty when dead. Colour = team. */}
      <div className="h-[2px] w-full bg-surface-elevated/30 overflow-hidden">
        <div
          className={cn("h-full transition-all duration-200", hpColor)}
          style={{ width: `${hp}%` }}
        />
      </div>
    </>
  );
}

// =========================================================================
// Equipment widgets
// =========================================================================

/**
 * Plain horizontal weapon silhouette — no chip background, no
 * weapon-class colour-coding. Just the iconlib.swf silhouette in
 * white, sized to fit the line-1 right slot. Matches the user's
 * mockup where the weapon hangs next to the player name like a
 * tactical tag rather than a UI chip.
 */
function WeaponSilhouette({ weapon }: { weapon: string | undefined }) {
  if (!weapon) {
    return null;
  }
  // Final defensive guard: if a utility name (knife / grenade
  // display variant) leaked through every earlier filter, hide
  // the column entirely rather than render its truncated text
  // chip ("HIGH" / "INCE" / "KARA" etc.). The user spec is
  // strict: weapons-only here.
  if (isUtility(weapon)) {
    return null;
  }
  const iconUrl = weaponIconUrl(weapon);
  if (!iconUrl) {
    // Fallback text — only fires when the weapon is not in the icon
    // map (rare; covers exotic / unknown weapons).
    return (
      <span
        className="font-mono-rs text-[9px] uppercase tracking-wider text-white/80"
        title={weapon}
      >
        {prettyWeapon(weapon)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={iconUrl}
      alt={weapon}
      title={weapon}
      className="h-5 w-auto object-contain shrink-0"
      style={{
        // Wider max so AWP-class long rifles still fit; pistols and
        // SMGs are naturally narrower (their viewBox is closer to
        // 1:1.6 vs rifles' 1:3.4) so they read smaller, but at
        // ``h-5`` (20 px) they're still clearly identifiable as
        // pistols.
        maxWidth: "110px",
        filter:
          "brightness(0) invert(1) drop-shadow(0 0 1px rgba(0,0,0,0.7))",
      }}
      draggable={false}
    />
  );
}

function WeaponBadge({ weapon }: { weapon: string | undefined }) {
  if (!weapon) {
    return (
      <span className="text-[9px] font-mono-rs text-muted-foreground/60 italic">
        no weapon
      </span>
    );
  }

  // Preferred path: a real weapon icon. If the public/weapons/ folder
  // has a mapping for this engine name we render the PNG with a
  // subtle team-tinted background so the chip still has visual weight
  // against the dark panel.
  const iconUrl = weaponIconUrl(weapon);
  const cls = classifyWeapon(weapon);
  const palette: Record<string, { bg: string; fg: string }> = {
    // Monochrome feed (user spec) — every chip uses the same neutral
    // dark-grey background + white foreground regardless of weapon
    // class. The previous palette colour-coded rifles / snipers /
    // smgs etc. which conflicted with "HP bar is the only colour".
    rifle:   { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    sniper:  { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    smg:     { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    pistol:  { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    shotgun: { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    knife:   { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    bomb:    { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    he:      { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    smoke:   { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    flash:   { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    molotov: { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    decoy:   { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
    other:   { bg: "hsl(220 8% 22% / 0.55)", fg: "hsl(0 0% 95%)" },
  };
  const p = palette[cls] ?? palette.other;

  if (iconUrl) {
    // Valve's iconlib.swf SVGs ship as black-fill silhouettes on a
    // transparent canvas (no background rectangle). To render them
    // white on the dark UI we apply ``filter: brightness(0)
    // invert(1)`` which recolours any source to pure white in a
    // single composite. The drop-shadow keeps the silhouette legible
    // against the team-tinted chip background.
    //
    // ``h-5`` (20 px) — earlier ``h-7`` made the chip dominate the
    // player row. 20 px is still wide enough to read AK vs M4 vs
    // AWP at a glance without crowding the rest of the row.
    return (
      <span
        className="inline-flex items-center justify-center px-1 py-0.5 rounded shrink-0"
        style={{ background: p.bg }}
        title={weapon}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={iconUrl}
          alt={weapon}
          className="h-5 w-auto object-contain"
          style={{
            maxWidth: "80px",
            filter:
              "brightness(0) invert(1) drop-shadow(0 0 1px rgba(0,0,0,0.7))",
          }}
          draggable={false}
        />
      </span>
    );
  }

  // Fallback: short text chip for weapons we don't have an icon for
  // yet (pistols, SMGs, shotguns, utility chips, etc.).
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider font-mono-rs"
      style={{ background: p.bg, color: p.fg }}
      title={weapon}
    >
      {prettyWeapon(weapon)}
    </span>
  );
}

function classifyWeapon(weapon: string): string {
  const w = weapon.toLowerCase().replace(/^weapon_/, "");
  if (["ak47", "m4a1", "m4a1_silencer", "famas", "galilar", "sg556", "aug"].includes(w)) return "rifle";
  if (["awp", "ssg08", "scar20", "g3sg1"].includes(w)) return "sniper";
  if (["mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon"].includes(w)) return "smg";
  if (["nova", "mag7", "sawedoff", "xm1014"].includes(w)) return "shotgun";
  if (["glock", "usp_silencer", "p2000", "p250", "fiveseven", "tec9", "cz75a", "deagle", "elite", "revolver"].includes(w)) return "pistol";
  if (w.includes("knife") || w === "bayonet") return "knife";
  if (w.includes("bomb") || w === "c4") return "bomb";
  // Utility grenades — distinct buckets so the chip lights up when a
  // player has the grenade in hand mid-round.
  if (w === "hegrenade") return "he";
  if (w === "smokegrenade") return "smoke";
  if (w === "flashbang") return "flash";
  if (w === "molotov" || w === "incgrenade") return "molotov";
  if (w === "decoy") return "decoy";
  return "other";
}

function prettyWeapon(weapon: string): string {
  const w = weapon.replace(/^weapon_/, "");
  const compact: Record<string, string> = {
    ak47: "AK",
    m4a1: "M4",
    m4a1_silencer: "M4S",
    awp: "AWP",
    deagle: "DEA",
    usp_silencer: "USP",
    p2000: "P2K",
    glock: "GLO",
    fiveseven: "5-7",
    tec9: "TEC",
    p250: "P250",
    famas: "FAM",
    galilar: "GAL",
    sg556: "SG",
    aug: "AUG",
    mac10: "MAC",
    mp9: "MP9",
    mp7: "MP7",
    mp5sd: "MP5",
    ump45: "UMP",
    p90: "P90",
    bizon: "BIZ",
    nova: "NOVA",
    mag7: "MAG",
    xm1014: "XM",
    sawedoff: "SAW",
    ssg08: "SCT",
    scar20: "SCAR",
    g3sg1: "G3",
    // Utility — readable codes for the chip when held in-hand.
    hegrenade: "HE",
    smokegrenade: "SMK",
    flashbang: "FLSH",
    molotov: "MOL",
    incgrenade: "MOL",
    decoy: "DEC",
    c4: "C4",
  };
  if (compact[w]) return compact[w];
  if (w.includes("knife") || w === "bayonet") return "KNF";
  return w.slice(0, 4).toUpperCase();
}

function ArmorIcon({ hasArmor, hasHelmet }: { hasArmor: boolean; hasHelmet: boolean }) {
  if (!hasArmor) {
    return <span className="text-[10px] text-muted-foreground/30">·</span>;
  }
  // Monochrome feed: vest (and helmet plate when present) drawn in
  // pure white at 90 % opacity. The vest-only vs vest+helmet
  // distinction is still visible via the extra helmet plate above
  // the body — no colour needed to disambiguate.
  return (
    <span
      title={hasHelmet ? "Vest + Helmet" : "Vest only"}
      className="inline-flex items-center justify-center w-3.5 h-3.5"
    >
      <svg viewBox="0 0 12 12" width="12" height="12">
        {hasHelmet && (
          <path
            d="M3 2 Q6 0 9 2 L9 4 L3 4 Z"
            fill="#ffffff"
            opacity="0.90"
          />
        )}
        <path
          d="M3 4 L9 4 L9 9 Q6 11 3 9 Z"
          fill="#ffffff"
          opacity="0.90"
        />
      </svg>
    </span>
  );
}

function KitIcon({ hasKit }: { hasKit: boolean }) {
  // ``Wrench`` reads as "tool / kit" the way the CS2 HUD does —
  // the previous ``Bomb`` glyph was misleading (it suggested
  // explosives, not the defuse kit). Matches the first icon in
  // the user's reference capture.
  return (
    <span
      title={hasKit ? "Defuse kit" : "No kit"}
      className="inline-flex items-center justify-center w-4 h-4"
    >
      <Wrench
        size={12}
        className={hasKit ? "text-white" : "text-muted-foreground/20"}
      />
    </span>
  );
}

/**
 * Per-grenade icon source.
 *
 * Mixed-format: the smoke / flash / incendiary slots use the user-
 * provided CS2 projectile webp icons (already coloured — blue smoke
 * canister, light-blue flash starburst, blue canister with white
 * flame), while HE / molotov / decoy keep the monochrome SVG
 * silhouettes from lexogrine + hand-styled sources. The
 * ``COLOURED_SLOTS`` set below tells the renderer which slots
 * should be drawn AS-IS (no brightness/invert filter) versus which
 * still get the white-silhouette treatment.
 *
 * Two paths share the same SVG file: ``molotov`` and ``incgrenade``
 * both used to fall back to ``/weapons/molotov.svg`` for the
 * molotov-style silhouette, but ``incgrenade`` now has its own
 * dedicated webp (CT incendiary canister) so the two are visually
 * distinguishable in the feed.
 */
const SLOT_ICONS: Record<string, string> = {
  smokegrenade: "/weapons/smokegrenade.webp",
  flashbang:    "/weapons/flashbang.webp",
  hegrenade:    "/weapons/hegrenade.svg",
  molotov:      "/weapons/molotov.svg",
  incgrenade:   "/weapons/incgrenade.webp",
  decoy:        "/weapons/decoy.svg",
};

// (Previously a ``COLOURED_SLOTS`` set let the webp icons keep their
// native CS2 palette. Per the latest user spec — "todas las
// granadas esten de color blanco" — every slot now goes through the
// brightness(0) + invert(1) white-silhouette filter unconditionally.
// The webp icons survive the filter as clean white silhouettes of
// the same shape they shipped with.)

const SLOT_TITLES: Record<string, string> = {
  smokegrenade: "Smoke",
  flashbang:    "Flashbang",
  hegrenade:    "HE",
  molotov:      "Molotov",
  incgrenade:   "Incendiary",
  decoy:        "Decoy",
};

// CS2 carry order on the buy screen, left → right. Used to render
// the slot icons in a consistent order regardless of inventory
// composition.
const SLOT_ORDER: Array<keyof NonNullable<PlayerLoadout["grenades"]>> = [
  "smokegrenade",
  "flashbang",
  "hegrenade",
  "molotov",
  "incgrenade",
  "decoy",
];

function GrenadeSlots({
  loadout,
  steamId,
  pastEvents,
  heldKey,
  currentT,
}: {
  loadout: PlayerLoadout | undefined;
  steamId: string;
  pastEvents?: TimelineEvent[];
  /**
   * When the player is currently holding a utility (live weapon is
   * a grenade), this is the canonical slot key for that grenade.
   * The matching slot lights up with a white glow so the viewer can
   * tell "this player has the smoke in hand RIGHT NOW" without the
   * grenade replacing their rifle in the weapon column.
   */
  heldKey?: GrenadeSlotKey | null;
  /**
   * Current playback time (seconds into the round). A thrown
   * grenade only counts as "subtracted from inventory" once it
   * actually detonates (``e.detonatedAt`` for smoke puff / molotov
   * fire / HE blast / flash pop). Without this the smoke FREQ is
   * mid-throw disappears from his slot the instant he releases the
   * button — but the user still sees the smoke in flight on the
   * map and reasonably expects it to be in the feed.
   */
  currentT?: number;
}) {
  // Real per-grenade inventory + accurate "thrown so far this round"
  // subtract. ``loadout.grenades`` is the round-start snapshot from
  // the parser; ``pastEvents`` gives us each grenade_thrown event by
  // this player up to the current playback time. We only count a
  // throw as subtracted once it has DETONATED (smoke cloud /
  // molotov fire / HE blast / flash pop). Until then the grenade
  // stays in the inventory display because, intuitively, the player
  // "still has" the grenade — it just happens to be mid-flight.
  //
  // Fallback: when ``loadout.grenades`` is missing (older
  // demoparser2, custom demos, dead row), render zero slots — empty
  // is the only honest signal.
  const initial = loadout?.grenades;
  // Some parser outputs omit ``detonatedAt`` (or set it equal to
  // throw time). For those we assume a 2.5 s grenade flight as a
  // safe default — that's longer than the in-flight time of a
  // pop-flash and shorter than the smoke / molotov detonation
  // window, so the slot stays around for the full visible arc.
  const FALLBACK_FLIGHT_SECONDS = 2.5;

  // Count grenades thrown by this player so far this round. The
  // timeline ``subtype`` field maps onto loadout keys via this
  // mini-table.
  const thrown: Record<string, number> = {
    smokegrenade: 0,
    flashbang: 0,
    hegrenade: 0,
    molotov: 0,
    incgrenade: 0,
    decoy: 0,
  };
  if (initial && pastEvents) {
    for (const e of pastEvents) {
      if (e.type !== "grenade_thrown") continue;
      if (e.player !== steamId) continue;
      // Skip the subtraction if the grenade hasn't detonated yet —
      // the player visibly still "has" it (it's in flight). Once
      // ``currentT`` reaches ``detonatedAt`` we treat the slot as
      // consumed.
      const detonateT =
        e.detonatedAt && e.detonatedAt > e.t
          ? e.detonatedAt
          : e.t + FALLBACK_FLIGHT_SECONDS;
      if (currentT !== undefined && currentT < detonateT) continue;
      switch (e.subtype) {
        case "smoke": thrown.smokegrenade++; break;
        case "flash": thrown.flashbang++; break;
        case "he":    thrown.hegrenade++; break;
        // The timeline emits "molotov" for both T molotov AND CT
        // incendiary throws. We subtract from whichever inventory
        // slot is non-zero (the player can only own one kind anyway).
        case "molotov":
          if ((initial.molotov ?? 0) > thrown.molotov) thrown.molotov++;
          else thrown.incgrenade++;
          break;
      }
    }
  }

  // Build the flat icon list in carry-order, one entry per grenade
  // the player still holds. Each entry only needs the slot key — the
  // ``GrenadeSlot`` component below resolves the PNG / SVG source
  // and applies fallback colours from ``SLOT_COLORS``.
  const icons: Array<{
    key: string;
    title: string;
    slotKey: string;
  }> = [];
  if (initial) {
    for (const key of SLOT_ORDER) {
      const remaining = Math.max(0, (initial[key] ?? 0) - (thrown[key] ?? 0));
      for (let i = 0; i < remaining; i++) {
        icons.push({
          key: `${key}-${i}`,
          title: SLOT_TITLES[key],
          slotKey: key,
        });
      }
    }
  }

  // Reserve a min-width equal to "4 slots + 3 gaps" so the row's
  // right-hand block doesn't shift width when players run out of
  // grenades. 4 × 20 + 3 × 4 = 92 px ≈ 95 px (round up for safety).
  //
  // PLACEHOLDER SLOTS (no grenade data available)
  // When ``loadout.grenades`` is missing — typical for demos parsed
  // before the parser learned to extract the ``inventory`` prop —
  // we render four DIM placeholder slots so the user at least sees
  // where utility info WOULD live. Re-processing the demo fills
  // them in with real counts.
  if (!initial) {
    return (
      <div
        className="flex items-center justify-end gap-1 shrink-0"
        style={{ minWidth: "95px" }}
      >
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            title="No grenade data — re-process demo to populate"
            className="inline-flex items-center justify-center w-5 h-5 rounded-sm bg-white/5 border border-white/10"
            aria-hidden
          />
        ))}
      </div>
    );
  }

  // Each slot is rendered ONCE per held grenade. ``onlyFirstHeldHighlighted``
  // makes sure that when a player owns multiple grenades of the same
  // type (e.g. two flashes), only the first slot of that type
  // receives the "in-hand" glow — the engine doesn't tell us which
  // physical grenade copy the player picked, just the class. Glowing
  // ALL flashes when only one is in hand would be visually misleading.
  const renderedHeld = { current: false };

  return (
    <div
      className="flex items-center justify-end gap-1 shrink-0"
      style={{ minWidth: "95px" }}
    >
      {icons.map((s) => {
        const isHeld = !!heldKey && s.slotKey === heldKey && !renderedHeld.current;
        if (isHeld) renderedHeld.current = true;
        return (
          <GrenadeSlot
            key={s.key}
            slotKey={s.slotKey}
            title={s.title}
            held={isHeld}
          />
        );
      })}
    </div>
  );
}

/**
 * One grenade slot icon.
 *
 * Rendered as a plain ``<img>`` from ``SLOT_ICONS[slotKey]`` with a
 * ``brightness(0) invert(1)`` filter — every slot comes out as a
 * pure-white silhouette regardless of whether the source asset was
 * a colourful webp or a monochrome SVG. The shape (canister,
 * starburst, frag, bottle, etc.) carries the identity; uniform
 * colour keeps the row tidy against the dark panel.
 *
 * When ``held`` is true (player currently holds THIS grenade), a
 * stacked white drop-shadow glow is added on top of the silhouette
 * filter so the held slot blooms without changing colour.
 */
function GrenadeSlot({
  slotKey,
  title,
  held,
}: {
  slotKey: string;
  title: string;
  held?: boolean;
}) {
  const src = SLOT_ICONS[slotKey];
  const baseFilter = "brightness(0) invert(1)";
  const heldGlow =
    "drop-shadow(0 0 4px rgba(255,255,255,0.95)) drop-shadow(0 0 2px rgba(255,255,255,0.8))";
  const filter = held ? `${baseFilter} ${heldGlow}` : baseFilter;

  return (
    <span
      title={title}
      className="inline-flex items-center justify-center w-5 h-5 shrink-0"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={title}
        className="w-5 h-5 object-contain"
        style={{ filter, transition: "filter 180ms ease-out" }}
        draggable={false}
      />
    </span>
  );
}
