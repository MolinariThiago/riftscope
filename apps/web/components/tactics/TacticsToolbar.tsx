"use client";

// Horizontal toolbar — cs2.cam style.
// Layout (single row, bottom of the screen):
//
//   [map | pen | trash | rect | circle | layer]  [util icons]
//   [color CT/T/yellow]  [C4]  [frames 1·2·3·4]  [reset]  [undo redo]
//
// Goal: maximise map space, every tool one click away, no nested menus.

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
import type { DrawTool, EntityKind } from "@/types/playbook";
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

// Colour swatches — CT blue, T orange, plus the brand burgundy + accents
const COLOR_SWATCHES: { value: number; label: string; ring: string }[] = [
  { value: 0x4a9eff, label: "CT", ring: "#4a9eff" },
  { value: 0xffb347, label: "T", ring: "#ffb347" },
  { value: 0xffe066, label: "Amarillo", ring: "#ffe066" },
  { value: 0x22c55e, label: "Verde", ring: "#22c55e" },
  { value: 0xff4d6d, label: "Rosa", ring: "#ff4d6d" },
  { value: 0xffffff, label: "Blanco", ring: "#ffffff" },
];

export function TacticsToolbar({ board: _board }: { board: TacticalBoardHandle | null }) {
  const tool = usePlaybook((s) => s.tool);
  const color = usePlaybook((s) => s.color);
  const frames = usePlaybook((s) => s.frames);
  const currentFrameId = usePlaybook((s) => s.currentFrameId);
  const canUndo = usePlaybook((s) => s.canUndo);
  const canRedo = usePlaybook((s) => s.canRedo);

  const setTool = usePlaybook((s) => s.setTool);
  const setColor = usePlaybook((s) => s.setColor);
  const addEntity = usePlaybook((s) => s.addEntity);
  const addPlayers = usePlaybook((s) => s.addPlayers);
  const setCurrentFrame = usePlaybook((s) => s.setCurrentFrame);
  const addFrame = usePlaybook((s) => s.addFrame);
  const undo = usePlaybook((s) => s.undo);
  const redo = usePlaybook((s) => s.redo);
  const clearAll = usePlaybook((s) => s.clearAll);

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-surface/95 backdrop-blur-xl px-3 py-2 shadow-2xl">
      {/* === Drawing tools === */}
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

      {/* === Utilities === */}
      <ToolGroup>
        {UTILITIES.map((u) => (
          <UtilBtn
            key={u.kind}
            src={u.src}
            label={u.label}
            onClick={() => addEntity(u.kind)}
          />
        ))}
      </ToolGroup>

      <Divider />

      {/* === Players (quick add) === */}
      <ToolGroup>
        <PlayerBtn label="CT" tint="#4a9eff" onClick={() => addEntity("player", "ct")} />
        <PlayerBtn label="T" tint="#ffb347" onClick={() => addEntity("player", "tt")} />
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

      {/* === Bomb === */}
      <button
        onClick={() => addEntity("bomb")}
        title="C4 / Bomba"
        className="h-9 w-9 flex items-center justify-center rounded-lg border border-border/60 bg-surface-elevated/40 text-loss hover:bg-loss/10 hover:border-loss/40 transition-colors"
      >
        <Bomb size={16} />
      </button>

      <Divider />

      {/* === Frames === */}
      <ToolGroup>
        {frames.map((f, i) => (
          <button
            key={f.id}
            onClick={() => setCurrentFrame(f.id)}
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

function UtilBtn({ src, label, onClick }: { src: string; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Agregar ${label}`}
      className="h-9 w-9 flex items-center justify-center rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated hover:border-primary/40 transition-colors"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={label}
        className="h-5 w-5 object-contain"
        style={{ filter: "brightness(0) invert(1)" }}
      />
    </button>
  );
}

function PlayerBtn({ label, tint, onClick }: { label: string; tint: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={`Agregar jugador ${label}`}
      className="h-9 px-2.5 flex items-center gap-1.5 rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated transition-colors"
    >
      <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-white" style={{ background: tint }} />
      <span className="text-xs font-bold" style={{ color: tint }}>{label}</span>
    </button>
  );
}
