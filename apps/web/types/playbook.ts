// Tactical-board / Playbook types. Mirrors apps/api/schemas/playbook.py.
//
// Coordinate convention: all positions and stroke points are NORMALIZED
// to [0..1] of the radar square (x→right, y→down). The board multiplies
// by `radarSize` to get world pixels, so a playbook is independent of the
// radar image resolution. Utility coverage radii are in CS GAME UNITS and
// are converted to pixels with the per-map `scale` (units per radar px).

export type Team = "ct" | "tt";

export type EntityKind =
  | "player"
  | "smoke"
  | "molotov"
  | "incendiary"
  | "flash"
  | "he"
  | "decoy"
  | "bomb";

export type DrawTool = "select" | "pen" | "arrow" | "rect" | "circle" | "eraser";

export interface Vec2 {
  x: number;
  y: number;
}

export interface BoardEntity {
  id: string;
  kind: EntityKind;
  team?: Team;
  /** Display label, e.g. "1".."5" for players or "A Smoke". */
  label?: string;
  /** Utilities only: gameplay coverage radius in CS game units. */
  radiusWorld?: number;
  /** Players only: facing/aim direction in degrees (0 = up). */
  rot?: number;
}

export interface BoardStroke {
  id: string;
  tool: "pen" | "arrow" | "rect" | "circle";
  color: number; // 0xRRGGBB
  /** Thickness as a fraction of radarSize (so it scales with the map). */
  width: number;
  /** normalized; pen = polyline, arrow/rect/circle = [start, end] */
  points: Vec2[];
}

export interface PlaybookFrame {
  id: string;
  name?: string;
  /** Transition time (ms) to reach THIS frame from the previous one. */
  durationMs: number;
  /** entityId → normalized position. Every entity has an entry. */
  positions: Record<string, Vec2>;
  /** entityIds hidden on this frame (e.g. a smoke not yet thrown). */
  hidden?: string[];
  strokes: BoardStroke[];
  /**
   * Recorded movement paths. ``paths[entityId]`` is the polyline (normalized
   * coords) the entity travels to reach ``positions[entityId]`` when
   * transitioning INTO this frame. Captured automatically whenever the user
   * drags an entity on the board. When absent, animations fall back to a
   * straight-line ease between this frame's position and the previous one.
   */
  paths?: Record<string, Vec2[]>;
}

export interface PlaybookData {
  schemaVersion: 1;
  entities: BoardEntity[];
  frames: PlaybookFrame[];
}

// Situation category for a tactic.
export type TacticType =
  | "execute"
  | "retake"
  | "default"
  | "eco"
  | "force"
  | "pistol"
  | "anti-eco";

// A Playbook item is either a hand-drawn board tactic or a saved demo round.
export type PlaybookKind = "tactic" | "round";

// A folder grouping Playbook items.
export interface PlaybookFolder {
  id: number;
  name: string;
  teamId: number | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

// ---- API shapes ----
export interface PlaybookSummary {
  id: number;
  title: string;
  map: string;
  side: Team | null;
  type: string | null;
  tags: string[];
  teamId: number | null;
  folderId: number | null;
  kind: PlaybookKind;
  demoId: number | null;
  roundNumber: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface PlaybookFull extends PlaybookSummary {
  data: PlaybookData;
}

export interface PlaybookWriteBody {
  title: string;
  map: string;
  side: Team | null;
  type: string | null;
  tags: string[];
  teamId: number | null;
  folderId?: number | null;
  kind?: PlaybookKind;
  demoId?: number | null;
  roundNumber?: number | null;
  data?: PlaybookData;
}

// A team the user belongs to (for sharing playbooks). `Team` is already
// the CT/T side alias above, so the entity is `TeamInfo`.
export interface TeamInfo {
  id: number;
  name: string;
  inviteCode: string;
  role: "owner" | "member";
  memberCount: number;
  createdAt: string;
}
