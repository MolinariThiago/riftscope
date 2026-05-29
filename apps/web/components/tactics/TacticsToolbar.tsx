"use client";

import {
  MousePointer2,
  Pencil,
  MoveUpRight,
  Square,
  Circle,
  Eraser,
  Trash2,
  Eye,
  EyeOff,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Camera,
  Undo2,
  Redo2,
  Bomb,
  type LucideIcon,
} from "lucide-react";

import { usePlaybook } from "@/lib/stores/playbook";
import type { DrawTool, EntityKind } from "@/types/playbook";
import { cn } from "@/lib/utils";
import type { TacticalBoardHandle } from "./TacticalBoard";

const TOOLS: { tool: DrawTool; icon: LucideIcon; label: string }[] = [
  { tool: "select", icon: MousePointer2, label: "Select / move (V)" },
  { tool: "pen", icon: Pencil, label: "Draw (P)" },
  { tool: "arrow", icon: MoveUpRight, label: "Arrow (A)" },
  { tool: "rect", icon: Square, label: "Rectangle (R)" },
  { tool: "circle", icon: Circle, label: "Circle (C)" },
  { tool: "eraser", icon: Eraser, label: "Erase (E)" },
];

const UTILITIES: { kind: EntityKind; src: string; label: string }[] = [
  { kind: "smoke", src: "/weapons/smokegrenade.webp", label: "Smoke" },
  { kind: "molotov", src: "/weapons/molotov.svg", label: "Molotov" },
  { kind: "incendiary", src: "/weapons/incgrenade.webp", label: "Incendiary" },
  { kind: "flash", src: "/weapons/flashbang.webp", label: "Flash" },
  { kind: "he", src: "/weapons/hegrenade.svg", label: "HE grenade" },
  { kind: "decoy", src: "/weapons/decoy.svg", label: "Decoy" },
];

const COLORS = [0x0ddde8, 0xffffff, 0x4a9eff, 0xffb347, 0xff4d6d, 0x22c55e, 0xffe066];

// Line thickness presets. `px` is just the on-button preview height.
const WIDTHS: { w: number; label: string; px: number }[] = [
  { w: 0.003, label: "S", px: 2 },
  { w: 0.006, label: "M", px: 4 },
  { w: 0.01, label: "L", px: 7 },
];

export function TacticsToolbar({ board }: { board: TacticalBoardHandle | null }) {
  const tool = usePlaybook((s) => s.tool);
  const color = usePlaybook((s) => s.color);
  const strokeWidth = usePlaybook((s) => s.strokeWidth);
  const selectedEntityId = usePlaybook((s) => s.selectedEntityId);
  const entities = usePlaybook((s) => s.entities);
  const frames = usePlaybook((s) => s.frames);
  const currentFrameId = usePlaybook((s) => s.currentFrameId);
  const canUndo = usePlaybook((s) => s.canUndo);
  const canRedo = usePlaybook((s) => s.canRedo);

  const setTool = usePlaybook((s) => s.setTool);
  const setColor = usePlaybook((s) => s.setColor);
  const setStrokeWidth = usePlaybook((s) => s.setStrokeWidth);
  const addEntity = usePlaybook((s) => s.addEntity);
  const addPlayers = usePlaybook((s) => s.addPlayers);
  const rotateEntity = usePlaybook((s) => s.rotateEntity);
  const removeEntity = usePlaybook((s) => s.removeEntity);
  const toggleHidden = usePlaybook((s) => s.toggleEntityHidden);
  const clearStrokes = usePlaybook((s) => s.clearStrokes);
  const undo = usePlaybook((s) => s.undo);
  const redo = usePlaybook((s) => s.redo);
  const clearAll = usePlaybook((s) => s.clearAll);

  const selected = entities.find((e) => e.id === selectedEntityId);
  const currentFrame = frames.find((f) => f.id === currentFrameId);
  const selectedHidden = selected
    ? (currentFrame?.hidden ?? []).includes(selected.id)
    : false;

  const ctCount = entities.filter((e) => e.kind === "player" && e.team === "ct").length;
  const ttCount = entities.filter((e) => e.kind === "player" && e.team === "tt").length;

  return (
    <div className="w-[216px] rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl shadow-2xl divide-y divide-border/50">
      {/* Tools */}
      <Section label="Tools">
        <div className="grid grid-cols-3 gap-1.5">
          {TOOLS.map((t) => (
            <SqBtn key={t.tool} icon={t.icon} title={t.label} active={tool === t.tool} onClick={() => setTool(t.tool)} />
          ))}
        </div>
      </Section>

      {/* History */}
      <Section label="History">
        <div className="grid grid-cols-2 gap-1.5">
          <SqBtn icon={Undo2} title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo} />
          <SqBtn icon={Redo2} title="Redo (Ctrl+Shift+Z)" disabled={!canRedo} onClick={redo} />
        </div>
        <button
          onClick={clearAll}
          className="mt-1.5 w-full h-8 rounded-lg border border-border/60 text-[11px] font-mono-rs text-muted-foreground hover:text-loss hover:border-loss/40 transition-colors"
        >
          Clear board
        </button>
      </Section>

      {/* Add */}
      <Section label="Add to board">
        <div className="grid grid-cols-2 gap-1.5">
          <PlayerAddBtn label="CT" count={ctCount} tint="#4a9eff" onClick={() => addEntity("player", "ct")} />
          <PlayerAddBtn label="T" count={ttCount} tint="#ffb347" onClick={() => addEntity("player", "tt")} />
        </div>
        <button
          onClick={() => {
            addPlayers("ct", 5);
            addPlayers("tt", 5);
          }}
          className="mt-1.5 w-full h-8 rounded-lg border border-dashed border-border text-[11px] font-mono-rs text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors"
        >
          Quick 5v5
        </button>
        <div className="grid grid-cols-3 gap-1.5 mt-1.5">
          {UTILITIES.map((u) => (
            <button
              key={u.kind}
              title={`Add ${u.label}`}
              onClick={() => addEntity(u.kind)}
              className="h-9 flex items-center justify-center rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated transition-colors"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u.src} alt={u.label} className="h-5 w-5 object-contain" style={{ filter: "brightness(0) invert(1)" }} />
            </button>
          ))}
        </div>
        <button
          onClick={() => addEntity("bomb")}
          title="Add C4 / bomb"
          className="mt-1.5 w-full h-8 flex items-center justify-center gap-1.5 rounded-lg border border-border/60 bg-surface-elevated/40 text-xs font-semibold text-loss hover:bg-surface-elevated transition-colors"
        >
          <Bomb size={13} /> C4 / Bomb
        </button>
      </Section>

      {/* Selected entity */}
      {selected && (
        <Section label={`Selected · ${selected.kind === "player" ? `${selected.team?.toUpperCase()} ${selected.label}` : selected.kind}`}>
          {selected.kind === "player" && (
            <div className="grid grid-cols-2 gap-1.5 mb-1.5">
              <WideBtn icon={RotateCcw} label="Aim L" onClick={() => rotateEntity(selected.id, -15)} />
              <WideBtn icon={RotateCw} label="Aim R" onClick={() => rotateEntity(selected.id, 15)} />
            </div>
          )}
          <div className="grid grid-cols-2 gap-1.5">
            <WideBtn
              icon={selectedHidden ? EyeOff : Eye}
              label={selectedHidden ? "Hidden" : "Visible"}
              active={selectedHidden}
              onClick={() => toggleHidden(selected.id)}
            />
            <WideBtn icon={Trash2} label="Delete" danger onClick={() => removeEntity(selected.id)} />
          </div>
        </Section>
      )}

      {/* Color */}
      <Section label="Draw color">
        <div className="flex flex-wrap gap-2">
          {COLORS.map((c) => (
            <button
              key={c}
              title="Stroke color"
              onClick={() => setColor(c)}
              className={cn(
                "h-6 w-6 rounded-full ring-offset-2 ring-offset-surface transition-all",
                color === c ? "ring-2 ring-white scale-105" : "ring-1 ring-border hover:ring-muted-foreground",
              )}
              style={{ background: `#${c.toString(16).padStart(6, "0")}` }}
            />
          ))}
        </div>
      </Section>

      {/* Line width — thickness of pen / arrow / shapes */}
      <Section label="Line width">
        <div className="grid grid-cols-3 gap-1.5">
          {WIDTHS.map((x) => {
            const active = Math.abs(strokeWidth - x.w) < 1e-4;
            return (
              <button
                key={x.label}
                title={`${x.label} line`}
                onClick={() => setStrokeWidth(x.w)}
                className={cn(
                  "h-9 flex items-center justify-center rounded-lg border transition-colors",
                  active
                    ? "border-primary/50 bg-primary-dim/50 text-primary"
                    : "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
                )}
              >
                <span className="rounded-full" style={{ height: `${x.px}px`, width: "62%", background: "currentColor" }} />
              </button>
            );
          })}
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground/60 leading-tight">Pen, arrow & shapes</p>
        <button
          onClick={clearStrokes}
          className="mt-1.5 w-full h-7 rounded-lg border border-border/60 text-[11px] font-mono-rs text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors"
        >
          Clear drawings (step)
        </button>
      </Section>

      {/* View */}
      <Section label="View">
        <div className="grid grid-cols-4 gap-1.5">
          <SqBtn icon={ZoomIn} title="Zoom in" onClick={() => board?.zoomBy(1.4)} />
          <SqBtn icon={ZoomOut} title="Zoom out" onClick={() => board?.zoomBy(1 / 1.4)} />
          <SqBtn icon={RotateCcw} title="Reset view" onClick={() => board?.resetView()} />
          <SqBtn icon={Camera} title="Screenshot" onClick={() => board?.screenshot()} />
        </div>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="p-3">
      <div className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground/70 mb-2 truncate">
        {label}
      </div>
      {children}
    </div>
  );
}

function SqBtn({
  icon: Icon,
  title,
  active,
  disabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-9 flex items-center justify-center rounded-lg border transition-colors",
        disabled
          ? "border-border/40 bg-surface-elevated/20 text-muted-foreground/30 cursor-not-allowed"
          : active
            ? "border-primary/50 bg-primary-dim/50 text-primary"
            : "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={16} />
    </button>
  );
}

function PlayerAddBtn({
  label,
  count,
  tint,
  onClick,
}: {
  label: string;
  count: number;
  tint: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={`Add ${label} player`}
      className="flex items-center justify-center gap-2 h-9 rounded-lg border border-border/60 bg-surface-elevated/40 hover:bg-surface-elevated transition-colors text-xs font-semibold"
    >
      <span className="inline-block h-4 w-4 rounded-full border-2 border-white" style={{ background: tint }} />
      <span style={{ color: tint }}>{label}</span>
      {count > 0 && <span className="text-[10px] font-mono-rs text-muted-foreground">{count}</span>}
    </button>
  );
}

function WideBtn({
  icon: Icon,
  label,
  active,
  danger,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center justify-center gap-1.5 h-9 rounded-lg border text-xs font-medium transition-colors",
        danger
          ? "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-loss hover:border-loss/40 hover:bg-loss/10"
          : active
            ? "border-primary/50 bg-primary-dim/50 text-primary"
            : "border-border/60 bg-surface-elevated/40 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={14} />
      {label}
    </button>
  );
}
