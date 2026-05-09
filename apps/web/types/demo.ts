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
  /** Facing direction in degrees (0 = +X, CCW positive). Optional for back-compat. */
  yaw?: number;
  alive: boolean;
  /** Hit points 0-100 at this frame. Optional for back-compat. */
  hp?: number;
}

/** Per-player snapshot at the start of a round (weapon + economy + armor). */
export interface PlayerLoadout {
  weapon: string;
  armor: number;
  helmet: boolean;
  kit: boolean;
  money: number;
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
  | "grenade_thrown";

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
  // bomb
  site?: "A" | "B";
  // grenade
  subtype?: GrenadeSubtype;
  player?: string;
  team?: Team;
  expiresAt?: number;
  /** Effect radius in world units, when applicable (smoke / molotov). */
  radius?: number;
  /** Thrower position when the grenade was released (world coords). */
  throwerX?: number;
  throwerY?: number;
}

export interface RoundTimeline {
  roundNumber: number;
  fps: number;
  durationSeconds: number;
  frames: TimelineFrame[];
  events: TimelineEvent[];
  /** Per-player loadout for THIS round, keyed by Steam ID. */
  loadouts?: Record<string, PlayerLoadout>;
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
