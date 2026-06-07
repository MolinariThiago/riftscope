"use client";

// Horizontal toolbar — cs2.cam style + drag-and-drop placement.
// Every "Add to board" item (utilities, players, bomb) is a drag source.
// You drag the icon onto the map; the drop position becomes the spawn
// position. Drops outside the map are cancelled.
//
// Frame buttons trigger an animated 1.5s transition via the board's
// animateToFrame handle — clicking a frame plays back the movement
// instead of snapping.

import {
  MousePointer2,
  Pencil,
  Eraser,
  Square,
  Circle,
  Layers,
  Bomb,
  Undo2,
  Redo2,
  RotateCcw,
  Plus,
  type LucideIcon,
} from "lucide-react";

import { usePlaybook } from "@/lib/stores/playbook";
import type { DrawTool, EntityKind, Team } from "@/types/playbook";
import { cn } from "@/lib/utils";
import type { TacticalBoardHandle } from "./TacticalBoard";

const TOOLS: { tool: DrawTool; icon: LucideIcon; label: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Seleccionar / mover (V)" },
  { tool: "pen", icon: Pencil, label: "Dibujar (P)" },
  { tool: "eraser", icon: Eraser, label: "Borrar (E)" },
  { tool: "rect", icon: Square, label: "Rectángulo (R)" },
  { tool: "circle", icon: Circle, label: "Círculo (C)" },
];

const UTILITIES: { kind: EntityKind; src: string; label: string }[] = [
  { kind: "smoke", src: "/weapons/smokegrenade.webp", label: "Humo" },
  { kind: "molotov", src: "/weapons/molotov.svg", label: "Molotov" },
  { kind: "flash", src: "/weapons/flashbang.webp", label: "Flash" },
  { kind: "he", src: "/weapons/hegrenade.svg", label: "HE" },
  { kind: "incendiary", src: "/weapons/incgrenade.webp", label: "Incendiaria" },
  { kind: "decoy", src: "/weapons/decoy.svg", label: "Decoy" },
];

const COLOR_SWATCHES: { value: number; label: string }[] = [
  { value: 0x4a9eff, label: "CT" },
  { value: 0xffb347, label: "T" },
  { value: 0xffe066, label: "Amarillo" },
  { value: 0x22c55e, label: "Verde" },
  { value: 0xff4d6d, label: "Rosa" },
  { value: 0xffffff, label: "Blanco" },
];

// Default per-step transition duration when clicking a frame button.
const FRAME_TRANSITION_MS = 1500;

// Payload encoded in dataTransfer when dragging a board item.
type DragPayload = { kind: EntityKind; team?: Team };

function encodeDrag(p: DragPayload): string {
  return JSON.stringify(p);
}

export function TacticsToolbar({ board }: { board: TacticalBoardHandle | null }) {
  const tool = usePlaybook((s) => s.tool);
  const color = usePlaybook((s) => s.color);
  const frames = usePlaybook((s) => s.frames);
  const currentFrameId = usePlaybook((s) => s.currentFrameId);
  const canUndo = usePlaybook((s) => s.canUndo);
  const canRedo = usePlaybook((s) => s.canRedo);

  const setTool = usePlaybook((s) => s.setTool);
  const setColor = usePlaybook((s) => s.setColor);
  const addPlayers = usePlaybook((s) => s.addPlayers);
  const addFrame = usePlaybook((s) => s.addFrame);
  const undo = usePlaybook((s) => s.undo);
  const redo = usePlaybook((s) => s.redo);
  const clearAll = usePlaybook((s) => s.clearAll);

  // Frame click — animate via the board instead of snapping. Falls back to
  // a plain frame switch if the board isn't mounted yet (e.g. very early
  // mount race) so nothing is lost.
  const goToFrame = (id: string) => {
    if (!board || id === currentFrameId) {
      usePlaybook.getState().setCurrentFrame(id);
      return;
    }
    board.animateToFrame(id, FRAME_TRANSITION_MS);
  };

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-surface/95 backdrop-blur-xl px-3 py-2 shadow-2xl">
      {/* === Drawing tools (click-to-activate) === */}
      <ToolGroup>
        {TOOLS.map((t) => (
          <IconBtn
            key={t.tool}
            icon={t.icon}
            title={t.label}
            active={tool === t.tool}
            onClick={() => setTool(t.tool)}
          />
        ))}
        <IconBtn icon={Layers} title="Capas" onClick={() => {}} />
      </ToolGroup>

      <Divider />

      {/* === Utilities (drag-to-place) === */}
      <ToolGroup>
        {UTILITIES.map((u) => (
          <DragUtilBtn key={u.kind} kind={u.kind} src={u.src} label={u.label} />
        ))}
      </ToolGroup>

      <Divider />

      {/* === Players (drag-to-place + Quick 5v5) === */}
      <ToolGroup>
        <DragPlayerBtn team="ct" label="CT" tint="#4a9eff" />
        <DragPlayerBtn team="tt" label="T" tint="#ffb347" />
        <button
          onClick={() => {
            addPlayers("ct", 5);
            addPlayers("tt", 5);
          }}
          title="Setup 5v5 rápido"
          className="h-9 px-2.5 rounded-lg border border-dashed border-border/70 text-[11px] font-mono-rs text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        >
          5v5
        </button>
      </ToolGroup>

      <Divider />

      {/* === Colors === */}
      <ToolGroup>
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c.value}
            title={c.label}
            onClick={() => setColor(c.value)}
            className={cn(
              "h-7 w-7 rounded-full transition-transform",
              color === c.value
                ? "ring-2 ring-white ring-offset-2 ring-offset-surface scale-110"
                : "ring-1 ring-border hover:ring-muted-foreground hover:scale-105",
            )}
            style={{ background: `#${c.value.toString(16).padStart(6, "0")}` }}
          />
        ))}
      </ToolGroup>

      <Divider />

      {/* === Bomb (drag-to-place) === */}
      <DragBombBtn />

      <Divider />

      {/* === Frames (click animates 1.5s) === */}
      <ToolGroup>
        {frames.map((f, i) => (
          <button
            key={f.id}
            onClick={() => goToFrame(f.id)}
            title={f.name ?? `Paso ${i + 1}`}
            className={cn(
              "h-9 min-w-[2.25rem] px-2 rounded-lg border text-xs font-mono-rs font-bold transition-colors",
              f.id === currentFrameId
                ? "border-primary/60 bg-primary text-primary-foreground"
                : "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
            )}
          >
            {i + 1}
          </button>
        ))}
        <button
          onClick={addFrame}
          title="Agregar paso"
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-dashed border-border/60 text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        >
          <Plus size={14} />
        </button>
      </ToolGroup>

      <Divider />

      {/* === Reset / undo / redo === */}
      <ToolGroup>
        <IconBtn icon={RotateCcw} title="Limpiar todo" onClick={clearAll} danger />
        <IconBtn icon={Undo2} title="Deshacer (Ctrl+Z)" onClick={undo} disabled={!canUndo} />
        <IconBtn icon={Redo2} title="Rehacer (Ctrl+Shift+Z)" onClick={redo} disabled={!canRedo} />
      </ToolGroup>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Atoms
// ---------------------------------------------------------------------------
function ToolGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function Divider() {
  return <div className="h-7 w-px bg-border/60 mx-0.5" />;
}

function IconBtn({
  icon: Icon,
  title,
  active,
  disabled,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-9 w-9 flex items-center justify-center rounded-lg border transition-colors",
        disabled
          ? "border-border/40 bg-surface-elevated/20 text-muted-foreground/30 cursor-not-allowed"
          : danger
            ? "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-loss hover:border-loss/40 hover:bg-loss/10"
            : active
              ? "border-primary/60 bg-primary-dim/60 text-primary"
              : "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={16} />
    </button>
  );
}

// ---------------------------------------------------------------------------
// Drag sources — utilities / players / bomb
// ---------------------------------------------------------------------------
function setDragData(e: React.DragEvent<HTMLElement>, payload: DragPayload) {
  e.dataTransfer.setData("application/x-riftscope-entity", encodeDrag(payload));
  e.dataTransfer.effectAllowed = "copy";
}

function DragUtilBtn({ kind, src, label }: { kind: EntityKind; src: string; label: string }) {
  return (
    <button
      draggable
      onDragStart={(e) => setDragData(e, { kind })}
      title={`Arrastrá ${label} al mapa`}
      className="h-9 w-9 flex items-center justify-center rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        className="h-5 w-5 object-contain pointer-events-none select-none"
        style={{ filter: "brightness(0) invert(1)" }}
        draggable={false}
      />
    </button>
  );
}

function DragPlayerBtn({ team, label, tint }: { team: Team; label: string; tint: string }) {
  return (
    <button
      draggable
      onDragStart={(e) => setDragData(e, { kind: "player", team })}
      title={`Arrastrá un jugador ${label} al mapa`}
      className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated transition-colors cursor-grab active:cursor-grabbing"
    >
      <span
        className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white pointer-events-none"
        style={{ background: tint }}
      />
      <span className="text-xs font-bold pointer-events-none" style={{ color: tint }}>{label}</span>
    </button>
  );
}

function DragBombBtn() {
  return (
    <button
      draggable
      onDragStart={(e) => setDragData(e, { kind: "bomb" })}
      title="Arrastrá la C4 al mapa"
      className="h-9 w-9 flex items-center justify-center rounded-lg border border-border/60 bg-surface-elevated/40 text-loss hover:bg-loss/10 hover:border-loss/40 transition-colors cursor-grab active:cursor-grabbing"
    >
      <Bomb size={16} className="pointer-events-none" />
    </button>
  );
}
