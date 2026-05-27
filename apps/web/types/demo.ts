// Core demo types — mirror apps/api/schemas/demo.py.

export type Team = "ct" | "tt";
export type RoundEndReason = "elimination" | "defuse" | "explode" | "time" | "surrender";
export type DemoStatus = "uploaded" | "queued" | "processing" | "completed" | "failed";

export interface DemoSummary {
  id: string;
  filename: string;
  status: DemoStatus;
  uploadedAt: string;
  processedAt: string | null;
  processingProgress: number;
  errorMessage: string | null;
  map: string | null;
  tickrate: number | null;
  durationSeconds: number | null;
  roundCount: number | null;
  score: [number, number] | null;
}

export type Demo = DemoSummary;

export interface DemoUploadResponse {
  id: string;
  filename: string;
  status: DemoStatus;
  uploadedAt: string;
}

export interface DemoStatusPayload {
  id: string;
  status: DemoStatus;
  progress: number;
  errorMessage: string | null;
}

export interface PlayerStats {
  steamId: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  adr: number;
  kast: number;
  hsPercent: number;
  rating: number;
  openingKills: number;
  openingDeaths: number;
  clutchWins: number;
  clutchAttempts: number;
  utilityDamage: number;
  flashAssists: number;
  mvpRounds: number;
}

export interface Kill {
  tick: number;
  round: number;
  killer: string;
  victim: string;
  weapon: string;
  headshot: boolean;
  throughSmoke: boolean;
  blinded: boolean;
  isOpeningKill: boolean;
  killerPos: [number, number, number];
  victimPos: [number, number, number];
}

export interface Round {
  number: number;
  half: 1 | 2;
  winner: Team;
  endReason: RoundEndReason;
  durationSeconds: number;
  startTick: number;
  endTick: number;
  ctEquipmentValue: number;
  ttEquipmentValue: number;
  bombPlanted: boolean;
  bombSite: "A" | "B" | null;
}

export interface ClutchSituation {
  round: number;
  player: string;
  enemies: number;
  won: boolean;
  hpLeft?: number;
}

export interface HeatmapPoint {
  x: number;
  y: number;
  weight: number;
  type: "kill" | "death" | "smoke" | "flash" | "he" | "molotov";
}

export interface EconomyRound {
  round: number;
  ctBankBefore: number;
  ttBankBefore: number;
  ctSpent: number;
  ttSpent: number;
  ctType: "full" | "eco" | "force" | "semi";
  ttType: "full" | "eco" | "force" | "semi";
}

// =========================================================================
// 2D Replay timeline
// =========================================================================

export interface TimelineRoundMeta {
  roundNumber: number;
  durationSeconds: number;
  frameCount: number;
  eventCount: number;
  /**
   * Bounds of the actual play portion inside the full extended
   * (freeze + play + post) timeline, in seconds from t=0.
   * Optional for backwards compatibility with demos parsed
   * before the freeze/post extension landed — those will have
   * playStartT = 0 and playEndT = durationSeconds.
   */
  playStartT?: number;
  playEndT?: number;
}

export interface TimelineMeta {
  fps: number;
  rounds: TimelineRoundMeta[];
}

export interface FramePlayer {
  steamId: string;
  team: Team;
  name: string;
  x: number;
  y: number;
  /** Vertical world coordinate — used for height-based effects (jumping). */
  z?: number;
  /** Facing direction in degrees (0 = +X, CCW positive). Optional for back-compat. */
  yaw?: number;
  alive: boolean;
  /** Hit points 0-100 at this frame. Optional for back-compat. */
  hp?: number;
  /** Active weapon name as emitted by demoparser2 (e.g. "ak47", "awp"). */
  weapon?: string | null;
  /** True when the player is mid-jump (vertical velocity above threshold). */
  isJumping?: boolean;
}

/**
 * Grenades a player owns at the START of a round, by type.
 *
 *   CS2 caps: ``flashbang`` ≤ 2, every other key ≤ 1.
 *   The parser may omit this object for older demoparser2 versions
 *   that don't expose the ``inventory`` prop — the UI must treat
 *   missing as "no data yet" (render empty slots).
 */
export interface GrenadeInventory {
  hegrenade: number;
  flashbang: number;
  smokegrenade: number;
  molotov: number;
  incgrenade: number;
  decoy: number;
}

/** Per-player snapshot at the start of a round (weapon + economy + armor + grenades). */
export interface PlayerLoadout {
  weapon: string;
  armor: number;
  helmet: boolean;
  kit: boolean;
  money: number;
  grenades?: GrenadeInventory;
}

export interface TimelineFrame {
  t: number; // seconds since round start
  players: FramePlayer[];
}

export type TimelineEventType =
  | "kill"
  | "bomb_planted"
  | "bomb_defused"
  | "bomb_exploded"
  | "grenade_thrown"
  | "shot";

export type GrenadeSubtype = "smoke" | "flash" | "he" | "molotov";

export interface TimelineEvent {
  t: number;
  type: TimelineEventType;
  // common optional payloads — for kills/grenades this is the VICTIM/landing pos
  x?: number;
  y?: number;
  // kill
  killer?: string;
  victim?: string;
  weapon?: string;
  headshot?: boolean;
  /** Killer position at the moment of the kill (world coords). */
  killerX?: number;
  killerY?: number;
  // shot (weapon_fire) — populated only when type === "shot"
  shooter?: string;
  /** View angle in degrees at the moment of firing (0 = east, 90 = north). */
  yaw?: number;
  // bomb
  site?: "A" | "B";
  // grenade
  subtype?: GrenadeSubtype;
  player?: string;
  team?: Team;
  /**
   * For grenades: when the projectile DETONATES (smoke cloud appears,
   * molotov starts burning, HE explodes). `t` itself is the THROW time.
   * Defaults to `t` if the parser couldn't recover the throw tick.
   */
  detonatedAt?: number;
  expiresAt?: number;
  /** Effect radius in world units, when applicable (smoke / molotov). */
  radius?: number;
  /** Thrower position when the grenade was released (world coords). */
  throwerX?: number;
  throwerY?: number;
  /** Per-tick projectile path during flight — used by the trajectory renderer. */
  trajectory?: { x: number; y: number; t: number }[] | null;
  /**
   * Per-patch spread positions for molotov / incendiary events.
   *
   * Each entry is one ``inferno_startburn`` event the engine emitted
   * as the fire spread across the ground — a single molotov produces
   * ~10-15 patches over ~0.4-0.6 s. ``x``/``y`` are world coords;
   * ``t`` is the patch's start time in seconds from round start.
   *
   * When present the renderer should draw the molotov as one fire
   * puff per patch at the actual demo-recorded positions, instead
   * of a fixed geometric cluster around the landing point. Falls
   * back to the cluster render if missing (older demos parsed
   * before the patch extraction landed).
   */
  patches?: { x: number; y: number; t: number }[];
  /**
   * Actual grenade weapon type resolved from the demo file.
   * `"incgrenade"` = CT incendiary, `"molotov"` = T molotov.
   * Present on all molotov/incendiary events parsed by the real parser.
   * Falls back to team-based inference when absent (older demos / stub parser).
   */
  weaponType?: "incgrenade" | "molotov";
}

export interface RoundTimeline {
  roundNumber: number;
  fps: number;
  durationSeconds: number;
  frames: TimelineFrame[];
  events: TimelineEvent[];
  /** Per-player loadout for THIS round, keyed by Steam ID. */
  loadouts?: Record<string, PlayerLoadout>;
  /**
   * Where the actual PLAY portion sits inside the extended
   * freeze + play + post timeline. ``playStartT`` is the
   * round_freeze_end second (when buy time ends and gameplay
   * begins); ``playEndT`` is the round_end second (when the win
   * condition was met). Used to clamp playback when the user
   * toggles off the "show freeze + post" layer.
   */
  playStartT?: number;
  playEndT?: number;
}

// =========================================================================
// Analysis (without heavy frames — just timeline metadata)
// =========================================================================

export interface DemoAnalysis {
  demo: DemoSummary;
  players: PlayerStats[];
  rounds: Round[];
  kills: Kill[];
  clutches: ClutchSituation[];
  economy: EconomyRound[];
  heatmapPoints: HeatmapPoint[];
  timeline: TimelineMeta;
}

export interface PlayerSearchResult {
  steamId: string;
  name: string;
  demosPlayed: number;
  totalKills: number;
  totalDeaths: number;
  avgRating: number;
  avgAdr: number;
}

export interface PlayerSearchResponse {
  query: string;
  total: number;
  results: PlayerSearchResult[];
}

// =========================================================================
// Insights (precomputed heuristic analytics)
// =========================================================================

export type InsightSeverity = "info" | "good" | "bad";
export type InsightKind =
  | "opening_duel"
  | "trade"
  | "fast_plant"
  | "eco_win"
  | "anti_eco_loss"
  | "defuse"
  | "explode";

export interface RoundInsight {
  kind: InsightKind | string;
  round: number;
  team: Team | null;
  severity: InsightSeverity;
  title: string;
  summary: string;
  evidence: Record<string, unknown>;
}

export interface RoundInsightGroup {
  round: number;
  winner: Team | null;
  endReason: string | null;
  bombSite: "A" | "B" | null;
  insights: RoundInsight[];
}

export interface PlayerInsightRollup {
  steamId: string;
  name: string;
  team: Team;
  kills: number;
  deaths: number;
  assists: number;
  rating: number;
  adr: number;
  kast: number;
  openingKills: number;
  openingDeaths: number;
  tradesMade: number;
  timesTraded: number;
}

export interface DemoInsights {
  engineVersion: string;
  summary: {
    rounds: number;
    ctWins: number;
    ttWins: number;
    totalKills: number;
    headshots: number;
    fastPlants: number;
    ecoWins: number;
    tradeKills: number;
    openingDuels: number;
    topPerformer: { name: string; team: Team; rating: number } | null;
  };
  rounds: RoundInsightGroup[];
  players: PlayerInsightRollup[];
  heatmap: {
    grid: number;
    worldBounds?: [number, number, number, number];
    cells: { x: number; y: number; kill: number; death: number }[];
    max: number;
  };
  computedAt: string | null;
}

// =========================================================================
// Map metadata (Phase 3A)
// =========================================================================

export interface MapCallout {
  name: string;
  x: number;
  y: number;
  radius: number;
}

export interface MapMetadata {
  name: string;
  displayName: string;

  // Radar projection (Valve overview <map>.txt constants).
  // radarPx = (world - posXY) / scale
  posX: number;
  posY: number;
  scale: number;
  radarSize: number;

  // Asset URLs (relative to the web root).
  radarUrl: string;
  radarUrlLower: string | null;
  lowerThresholdZ: number | null;

  // World bounds (derived from radar projection).
  worldMinX: number;
  worldMaxX: number;
  worldMinY: number;
  worldMaxY: number;

  // Anchors in WORLD coordinates.
  siteA: [number, number];
  siteB: [number, number];
  spawnCt: [number, number];
  spawnTt: [number, number];
  callouts: MapCallout[];
}

