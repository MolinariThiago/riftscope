"use client";

import { create } from "zustand";

import type {
  BoardEntity,
  BoardStroke,
  DrawTool,
  EntityKind,
  PlaybookData,
  PlaybookFrame,
  PlaybookFull,
  Team,
  Vec2,
} from "@/types/playbook";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Default coverage radius (CS game units) per utility kind. */
const UTILITY_RADIUS: Partial<Record<EntityKind, number>> = {
  smoke: 144,
  molotov: 150,
  incendiary: 150,
  he: 96,
};

function seedPosition(kind: EntityKind, team: Team | undefined, idx: number): Vec2 {
  if (kind === "player") {
    const y = team === "tt" ? 0.26 : 0.74;
    return { x: 0.3 + 0.1 * (idx % 5), y };
  }
  // utilities cluster near centre with a small fan-out
  return { x: 0.5 + 0.04 * ((idx % 5) - 2), y: 0.5 };
}

// Start with an EMPTY cast — the user places players/utilities themselves
// from the toolbar. (Previously this seeded 5 CT + 5 TT automatically.)
function makeDefaultEntities(): BoardEntity[] {
  return [];
}

function makeInitialFrame(entities: BoardEntity[]): PlaybookFrame {
  const positions: Record<string, Vec2> = {};
  const ctSeen = { n: 0 };
  const ttSeen = { n: 0 };
  entities.forEach((e) => {
    let idx = 0;
    if (e.kind === "player") {
      idx = e.team === "tt" ? ttSeen.n++ : ctSeen.n++;
    }
    positions[e.id] = seedPosition(e.kind, e.team, idx);
  });
  return { id: uid(), name: "Setup", durationMs: 1000, positions, strokes: [], hidden: [] };
}

function cloneFrame(src: PlaybookFrame, name: string): PlaybookFrame {
  return {
    id: uid(),
    name,
    durationMs: 1000,
    positions: { ...src.positions },
    hidden: [...(src.hidden ?? [])],
    strokes: src.strokes.map((s) => ({ ...s, id: uid(), points: s.points.map((p) => ({ ...p })) })),
  };
}

interface PlaybookState {
  // identity
  playbookId: number | null;
  title: string;
  map: string;
  side: Team | null;
  type: string | null;
  tags: string[];
  teamId: number | null; // null = personal; set = shared with that team

  // document
  entities: BoardEntity[];
  frames: PlaybookFrame[];
  currentFrameId: string;

  // editor ui
  tool: DrawTool;
  color: number;
  strokeWidth: number;
  selectedEntityId: string | null;
  /** Entity currently following the cursor for placement (click to drop). */
  placingId: string | null;

  // playback / transport (not persisted)
  isPlaying: boolean;
  loop: boolean;
  speed: number;
  playhead: number; // 0..1 across the whole step sequence

  dirty: boolean;
  canUndo: boolean;
  canRedo: boolean;

  // ---- identity actions ----
  newPlaybook: (map?: string) => void;
  loadPlaybook: (full: PlaybookFull) => void;
  markSaved: (id: number) => void;
  setTitle: (t: string) => void;
  setMap: (m: string) => void;
  setSide: (s: Team | null) => void;
  setType: (t: string | null) => void;
  setTags: (tags: string[]) => void;
  setTeamId: (id: number | null) => void;

  // ---- editor ui actions ----
  setTool: (t: DrawTool) => void;
  setColor: (c: number) => void;
  setStrokeWidth: (w: number) => void;
  selectEntity: (id: string | null) => void;
  setPlacing: (id: string | null) => void;

  // ---- entity actions ----
  addEntity: (kind: EntityKind, team?: Team) => void;
  addPlayers: (team: Team, n: number) => void;
  rotateEntity: (id: string, deltaDeg: number) => void;
  removeEntity: (id: string) => void;
  setEntityPosition: (entityId: string, pos: Vec2) => void;
  toggleEntityHidden: (entityId: string) => void;

  // ---- stroke actions ----
  addStroke: (stroke: Omit<BoardStroke, "id">) => void;
  removeStroke: (strokeId: string) => void;
  clearStrokes: () => void;

  // ---- history / bulk ----
  undo: () => void;
  redo: () => void;
  clearAll: () => void;

  // ---- frame actions ----
  addFrame: () => void;
  duplicateFrame: (id: string) => void;
  deleteFrame: (id: string) => void;
  setCurrentFrame: (id: string) => void;
  moveFrame: (id: string, dir: -1 | 1) => void;
  setFrameDuration: (id: string, ms: number) => void;
  renameFrame: (id: string, name: string) => void;

  // ---- playback ----
  setPlaying: (b: boolean) => void;
  setLoop: (b: boolean) => void;
  setSpeed: (n: number) => void;
  setPlayhead: (t: number) => void;

  // ---- serialize ----
  toData: () => PlaybookData;
}

// ---- Undo/redo history (module-level, recorded via store subscription) ----
type Snapshot = { entities: BoardEntity[]; frames: PlaybookFrame[] };
const _past: Snapshot[] = [];
const _future: Snapshot[] = [];
let _recording = true; // false while applying an undo/redo
let _suppress = false; // true while resetting (new/load) so we don't record

export const usePlaybook = create<PlaybookState>((set, get) => {
  const initEntities = makeDefaultEntities();
  const initFrame = makeInitialFrame(initEntities);
  return {
    playbookId: null,
    title: "Untitled tactic",
    map: "de_mirage",
    side: null,
    type: null,
    tags: [],
    teamId: null,
    entities: initEntities,
    frames: [initFrame],
    currentFrameId: initFrame.id,
    tool: "select",
    color: 0x0ddde8,
    strokeWidth: 0.004,
    selectedEntityId: null,
    placingId: null,
    isPlaying: false,
    loop: false,
    speed: 1,
    playhead: 0,
    dirty: false,
    canUndo: false,
    canRedo: false,

    newPlaybook: (map = "de_mirage") => {
      const entities = makeDefaultEntities();
      const frame = makeInitialFrame(entities);
      _suppress = true;
      set({
        playbookId: null,
        title: "Untitled tactic",
        map,
        side: null,
        type: null,
        tags: [],
        teamId: null,
        entities,
        frames: [frame],
        currentFrameId: frame.id,
        selectedEntityId: null,
        placingId: null,
        isPlaying: false,
        tool: "select",
        dirty: false,
        canUndo: false,
        canRedo: false,
      });
      _past.length = 0;
      _future.length = 0;
      _suppress = false;
    },

    loadPlaybook: (full) => {
      const data = full.data;
      const frames = data.frames?.length ? data.frames : [makeInitialFrame(data.entities ?? [])];
      _suppress = true;
      set({
        playbookId: full.id,
        title: full.title,
        map: full.map,
        side: full.side,
        type: full.type ?? null,
        tags: full.tags ?? [],
        teamId: full.teamId ?? null,
        entities: data.entities ?? [],
        frames,
        currentFrameId: frames[0].id,
        selectedEntityId: null,
        placingId: null,
        isPlaying: false,
        tool: "select",
        dirty: false,
        canUndo: false,
        canRedo: false,
      });
      _past.length = 0;
      _future.length = 0;
      _suppress = false;
    },

    markSaved: (id) => set({ playbookId: id, dirty: false }),
    setTitle: (t) => set({ title: t, dirty: true }),
    setMap: (m) => set({ map: m, dirty: true }),
    setSide: (s) => set({ side: s, dirty: true }),
    setType: (t) => set({ type: t, dirty: true }),
    setTags: (tags) => set({ tags, dirty: true }),
    setTeamId: (id) => set({ teamId: id, dirty: true }),

    setTool: (t) => set({ tool: t }),
    setColor: (c) => set({ color: c }),
    setStrokeWidth: (w) => set({ strokeWidth: w }),
    selectEntity: (id) => set({ selectedEntityId: id }),
    setPlacing: (id) => set({ placingId: id }),

    addEntity: (kind, team) => {
      const { entities, frames } = get();
      const sameGroup = entities.filter(
        (e) => e.kind === kind && (kind !== "player" || e.team === team),
      ).length;
      const label =
        kind === "player" ? String(sameGroup + 1) : kind.toUpperCase();
      const entity: BoardEntity = {
        id: uid(),
        kind,
        team,
        label,
        radiusWorld: UTILITY_RADIUS[kind],
        rot: kind === "player" ? 0 : undefined,
      };
      const pos = seedPosition(kind, team, sameGroup);
      set({
        entities: [...entities, entity],
        frames: frames.map((f) => ({
          ...f,
          positions: { ...f.positions, [entity.id]: { ...pos } },
        })),
        selectedEntityId: entity.id,
        placingId: entity.id, // follows the cursor until the user clicks to drop
        tool: "select",
        dirty: true,
      });
    },

    addPlayers: (team, n) => {
      const { entities, frames } = get();
      const base = entities.filter((e) => e.kind === "player" && e.team === team).length;
      const newEntities: BoardEntity[] = [];
      const newPositions: Record<string, Vec2> = {};
      for (let i = 0; i < n; i++) {
        const id = uid();
        newEntities.push({ id, kind: "player", team, label: String(base + i + 1), rot: 0 });
        newPositions[id] = seedPosition("player", team, base + i);
      }
      set({
        entities: [...entities, ...newEntities],
        frames: frames.map((f) => ({
          ...f,
          positions: { ...f.positions, ...newPositions },
        })),
        placingId: null,
        dirty: true,
      });
    },

    rotateEntity: (id, deltaDeg) => {
      const { entities } = get();
      set({
        entities: entities.map((e) =>
          e.id === id ? { ...e, rot: (e.rot ?? 0) + deltaDeg } : e,
        ),
        dirty: true,
      });
    },

    removeEntity: (id) => {
      const { entities, frames, selectedEntityId, placingId } = get();
      set({
        entities: entities.filter((e) => e.id !== id),
        frames: frames.map((f) => {
          const positions = { ...f.positions };
          delete positions[id];
          return {
            ...f,
            positions,
            hidden: (f.hidden ?? []).filter((h) => h !== id),
          };
        }),
        selectedEntityId: selectedEntityId === id ? null : selectedEntityId,
        placingId: placingId === id ? null : placingId,
        dirty: true,
      });
    },

    setEntityPosition: (entityId, pos) => {
      const { frames, currentFrameId } = get();
      set({
        frames: frames.map((f) =>
          f.id === currentFrameId
            ? { ...f, positions: { ...f.positions, [entityId]: pos } }
            : f,
        ),
        dirty: true,
      });
    },

    toggleEntityHidden: (entityId) => {
      const { frames, currentFrameId } = get();
      set({
        frames: frames.map((f) => {
          if (f.id !== currentFrameId) return f;
          const cur = f.hidden ?? [];
          const hidden = cur.includes(entityId)
            ? cur.filter((h) => h !== entityId)
            : [...cur, entityId];
          return { ...f, hidden };
        }),
        dirty: true,
      });
    },

    addStroke: (stroke) => {
      const { frames, currentFrameId } = get();
      set({
        frames: frames.map((f) =>
          f.id === currentFrameId
            ? { ...f, strokes: [...f.strokes, { ...stroke, id: uid() }] }
            : f,
        ),
        dirty: true,
      });
    },

    removeStroke: (strokeId) => {
      const { frames, currentFrameId } = get();
      set({
        frames: frames.map((f) =>
          f.id === currentFrameId
            ? { ...f, strokes: f.strokes.filter((s) => s.id !== strokeId) }
            : f,
        ),
        dirty: true,
      });
    },

    clearStrokes: () => {
      const { frames, currentFrameId } = get();
      set({
        frames: frames.map((f) =>
          f.id === currentFrameId ? { ...f, strokes: [] } : f,
        ),
        dirty: true,
      });
    },

    undo: () => {
      if (_past.length === 0) return;
      const snap = _past.pop()!;
      _future.push({ entities: get().entities, frames: get().frames });
      _recording = false;
      const keepCurrent = snap.frames.some((f) => f.id === get().currentFrameId);
      set({
        entities: snap.entities,
        frames: snap.frames,
        currentFrameId: keepCurrent ? get().currentFrameId : snap.frames[0].id,
        selectedEntityId: null,
        isPlaying: false,
        dirty: true,
        canUndo: _past.length > 0,
        canRedo: true,
      });
      _recording = true;
    },

    redo: () => {
      if (_future.length === 0) return;
      const snap = _future.pop()!;
      _past.push({ entities: get().entities, frames: get().frames });
      _recording = false;
      const keepCurrent = snap.frames.some((f) => f.id === get().currentFrameId);
      set({
        entities: snap.entities,
        frames: snap.frames,
        currentFrameId: keepCurrent ? get().currentFrameId : snap.frames[0].id,
        selectedEntityId: null,
        isPlaying: false,
        dirty: true,
        canUndo: true,
        canRedo: _future.length > 0,
      });
      _recording = true;
    },

    clearAll: () => {
      const { frames } = get();
      set({
        entities: [],
        frames: frames.map((f) => ({ ...f, positions: {}, hidden: [], strokes: [] })),
        selectedEntityId: null,
        dirty: true,
      });
    },

    addFrame: () => {
      const { frames, currentFrameId } = get();
      const idx = frames.findIndex((f) => f.id === currentFrameId);
      const src = frames[idx] ?? frames[frames.length - 1];
      const next = cloneFrame(src, `Step ${frames.length + 1}`);
      const out = [...frames];
      out.splice(idx + 1, 0, next);
      set({ frames: out, currentFrameId: next.id, dirty: true });
    },

    duplicateFrame: (id) => {
      const { frames } = get();
      const idx = frames.findIndex((f) => f.id === id);
      if (idx < 0) return;
      const next = cloneFrame(frames[idx], `${frames[idx].name ?? "Step"} copy`);
      const out = [...frames];
      out.splice(idx + 1, 0, next);
      set({ frames: out, currentFrameId: next.id, dirty: true });
    },

    deleteFrame: (id) => {
      const { frames, currentFrameId } = get();
      if (frames.length <= 1) return;
      const idx = frames.findIndex((f) => f.id === id);
      const out = frames.filter((f) => f.id !== id);
      let current = currentFrameId;
      if (currentFrameId === id) {
        current = out[Math.max(0, idx - 1)].id;
      }
      set({ frames: out, currentFrameId: current, dirty: true });
    },

    setCurrentFrame: (id) => set({ currentFrameId: id, isPlaying: false }),

    moveFrame: (id, dir) => {
      const { frames } = get();
      const idx = frames.findIndex((f) => f.id === id);
      const j = idx + dir;
      if (idx < 0 || j < 0 || j >= frames.length) return;
      const out = [...frames];
      [out[idx], out[j]] = [out[j], out[idx]];
      set({ frames: out, dirty: true });
    },

    setFrameDuration: (id, ms) => {
      const { frames } = get();
      set({
        frames: frames.map((f) =>
          f.id === id ? { ...f, durationMs: Math.max(100, ms) } : f,
        ),
        dirty: true,
      });
    },

    renameFrame: (id, name) => {
      const { frames } = get();
      set({ frames: frames.map((f) => (f.id === id ? { ...f, name } : f)), dirty: true });
    },

    setPlaying: (b) => set({ isPlaying: b }),
    setLoop: (b) => set({ loop: b }),
    setSpeed: (n) => set({ speed: n }),
    setPlayhead: (t) => set({ playhead: Math.max(0, Math.min(1, t)) }),

    toData: () => {
      const { entities, frames } = get();
      return { schemaVersion: 1, entities, frames };
    },
  };
});

// Record undo history whenever the document (entities/frames) changes.
// Captures the PREVIOUS snapshot so undo restores the state before the edit.
usePlaybook.subscribe((s, p) => {
  if (!_recording || _suppress) return;
  if (s.entities !== p.entities || s.frames !== p.frames) {
    _past.push({ entities: p.entities, frames: p.frames });
    if (_past.length > 60) _past.shift();
    _future.length = 0;
    usePlaybook.setState({ canUndo: true, canRedo: false });
  }
});
