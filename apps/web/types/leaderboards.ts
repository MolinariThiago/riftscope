// Wire shape for /leaderboards — mirrors apps/api/schemas/leaderboards.py.
// Keep the two in sync (TS field names match Pydantic camelCase aliases).

export interface LeaderboardEntry {
  rank: number;
  steamId: string;
  name: string;
  clan: string | null;
  demos: number;
  rounds: number;
  // Rating + per-round rates. All computed server-side from raw
  // counters so the same demo aggregated across map filters returns
  // self-consistent numbers.
  rating: number;
  adr: number;
  kd: number;
  kpr: number;
  dpr: number;
  kast: number;
  udr: number;
  far: number;
  // Raw counters (for tooltips / drill-downs).
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
}

export interface LeaderboardFilters {
  map: string | null;
  since: string | null;
  minRounds: number;
  limit: number;
}

export interface LeaderboardResponse {
  filters: LeaderboardFilters;
  entries: LeaderboardEntry[];
  total: number;
}

export interface LeaderboardQuery {
  map?: string;
  since?: string;
  minRounds?: number;
  limit?: number;
}
