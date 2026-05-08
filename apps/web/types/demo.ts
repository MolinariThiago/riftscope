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
  alive: boolean;
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
  // common optional payloads
  x?: number;
  y?: number;
  // kill
  killer?: string;
  victim?: string;
  weapon?: string;
  headshot?: boolean;
  // bomb
  site?: "A" | "B";
  // grenade
  subtype?: GrenadeSubtype;
  player?: string;
  team?: Team;
  expiresAt?: number;
}

export interface RoundTimeline {
  roundNumber: number;
  fps: number;
  durationSeconds: number;
  frames: TimelineFrame[];
  events: TimelineEvent[];
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
