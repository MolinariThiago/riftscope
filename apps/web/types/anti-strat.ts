// Anti-strat scouting types — mirror of apps/api/schemas/anti_strat.py.
// One auto-detected T-side play per round, aggregated per team → map →
// (site, type).

export type TacticKind = "execute" | "default" | "fake";

export interface AntiStratTeam {
  name: string;
  /** Distinct demos this team appears in. */
  demos: number;
  /** T-side rounds we classified for them. */
  rounds: number;
  maps: string[];
}

export interface PlayRound {
  demoId: number;
  roundNumber: number;
  won: boolean;
  plantTime: number | null;
}

export interface PlayGroup {
  site: "A" | "B" | null;
  type: TacticKind;
  count: number;
  wins: number;
  winRate: number;
  avgPlantTime: number | null;
  /** WHEN the play lands: 10 s buckets 0-10 … 50-60, 60+ (7 buckets). */
  timing: number[];
  rounds: PlayRound[];
}

export interface MapReport {
  map: string;
  rounds: number;
  plays: PlayGroup[];
}

export interface TeamReport {
  team: string;
  totalRounds: number;
  maps: MapReport[];
}

// ---- Phase 2 (Vetos) + Phase 3 (Pre-match) ----

export interface MapStrength {
  map: string;
  played: number;
  wins: number;
  winRate: number;
  roundsWon: number;
  roundsPlayed: number;
  ctRoundWinRate: number | null;
  tRoundWinRate: number | null;
}

export interface PlayerStat {
  name: string;
  steamId: string;
  demos: number;
  rating: number;
  adr: number;
  kast: number;
  openingKills: number;
}

export interface SignaturePlay {
  map: string;
  site: "A" | "B" | null;
  type: TacticKind;
  count: number;
  winRate: number;
}

export interface PreMatchReport {
  team: string;
  demos: number;
  totalRounds: number;
  maps: MapStrength[];
  players: PlayerStat[];
  signaturePlays: SignaturePlay[];
}
