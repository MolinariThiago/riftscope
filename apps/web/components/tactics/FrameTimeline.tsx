"use client";

import { useState } from "react";
import {
  Play,
  Pause,
  SkipBack,
  Plus,
  Copy,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Repeat,
  Settings2,
} from "lucide-react";

import { usePlaybook } from "@/lib/stores/playbook";
import { cn } from "@/lib/utils";
import type { TacticalBoardHandle } from "./TacticalBoard";

const SPEEDS = [0.5, 1, 2];

export function FrameTimeline({ board }: { board: TacticalBoardHandle | null }) {
  const frames = usePlaybook((s) => s.frames);
  const currentFrameId = usePlaybook((s) => s.currentFrameId);
  const isPlaying = usePlaybook((s) => s.isPlaying);
  const loop = usePlaybook((s) => s.loop);
  const speed = usePlaybook((s) => s.speed);
  const playhead = usePlaybook((s) => s.playhead);

  const setCurrentFrame = usePlaybook((s) => s.setCurrentFrame);
  const addFrame = usePlaybook((s) => s.addFrame);
  const duplicateFrame = usePlaybook((s) => s.duplicateFrame);
  const deleteFrame = usePlaybook((s) => s.deleteFrame);
  const moveFrame = usePlaybook((s) => s.moveFrame);
  const setFrameDuration = usePlaybook((s) => s.setFrameDuration);
  const renameFrame = usePlaybook((s) => s.renameFrame);
  const setPlaying = usePlaybook((s) => s.setPlaying);
  const setLoop = usePlaybook((s) => s.setLoop);
  const setSpeed = usePlaybook((s) => s.setSpeed);
  const setPlayhead = usePlaybook((s) => s.setPlayhead);

  const [settingsOpen, setSettingsOpen] = useState(false);

  const current = frames.find((f) => f.id === currentFrameId);
  const currentIdx = frames.findIndex((f) => f.id === currentFrameId);
  const multi = frames.length > 1;

  // Step boundary fractions for the scrub ticks.
  const total = frames.slice(1).reduce((s, f) => s + f.durationMs, 0);
  const tickFractions: number[] = [0];
  {
    let acc = 0;
    for (let i = 1; i < frames.length; i++) {
      acc += frames[i].durationMs;
      tickFractions.push(total > 0 ? acc / total : 0);
    }
  }

  const onScrub = (v: number) => {
    if (isPlaying) setPlaying(false);
    const t = v / 1000;
    setPlayhead(t);
    board?.seek(t);
  };

  const restart = () => {
    setPlaying(false);
    setPlayhead(0);
    if (frames[0]) setCurrentFrame(frames[0].id);
    board?.seek(0);
  };

  return (
    <div className="relative w-[min(640px,90vw)] rounded-xl border border-border/60 bg-background/90 backdrop-blur-md px-3 py-2.5 shadow-xl">
      {/* Step settings popover */}
      {settingsOpen && current && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border border-border bg-surface shadow-2xl p-3 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground">
              Step {currentIdx + 1} settings
            </span>
            <button onClick={() => setSettingsOpen(false)} className="text-muted-foreground hover:text-foreground text-xs">✕</button>
          </div>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Name</span>
            <input
              value={current.name ?? ""}
              onChange={(e) => renameFrame(current.id, e.target.value)}
              placeholder={`Step ${currentIdx + 1}`}
              className="mt-1 w-full bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-muted-foreground">Transition time (s)</span>
            <input
              type="number"
              min={0.1}
              step={0.1}
              value={+(current.durationMs / 1000).toFixed(1)}
              onChange={(e) => setFrameDuration(current.id, (Number(e.target.value) || 0.1) * 1000)}
              className="mt-1 w-full bg-surface-elevated border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60"
            />
          </label>
          <div className="grid grid-cols-4 gap-1.5">
            <MiniBtn icon={ChevronLeft} title="Move left" onClick={() => moveFrame(current.id, -1)} />
            <MiniBtn icon={ChevronRight} title="Move right" onClick={() => moveFrame(current.id, 1)} />
            <MiniBtn icon={Copy} title="Duplicate" onClick={() => duplicateFrame(current.id)} />
            <MiniBtn icon={Trash2} title="Delete" disabled={frames.length <= 1} onClick={() => deleteFrame(current.id)} />
          </div>
        </div>
      )}

      {/* Steps row */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2">
        {frames.map((f, i) => (
          <button
            key={f.id}
            onClick={() => setCurrentFrame(f.id)}
            title={f.name ?? `Step ${i + 1}`}
            className={cn(
              "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs whitespace-nowrap transition-colors flex-shrink-0",
              f.id === currentFrameId
                ? "border-primary/60 bg-primary-dim/40 text-foreground"
                : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
            )}
          >
            <span className="font-mono-rs text-primary">{String(i + 1).padStart(2, "0")}</span>
            {f.name && <span className="font-medium max-w-[90px] truncate">{f.name}</span>}
          </button>
        ))}
        <button
          onClick={addFrame}
          title="Add step (duplicates current)"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground hover:text-primary hover:border-primary/50 transition-colors flex-shrink-0"
        >
          <Plus size={14} />
        </button>
        <button
          onClick={() => setSettingsOpen((v) => !v)}
          title="Step settings (name, duration, reorder…)"
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg border transition-colors flex-shrink-0 ml-auto",
            settingsOpen
              ? "border-primary/50 bg-primary-dim/40 text-primary"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
          )}
        >
          <Settings2 size={14} />
        </button>
      </div>

      {/* Transport row */}
      <div className="flex items-center gap-2">
        <button
          onClick={restart}
          title="Restart"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors flex-shrink-0"
        >
          <SkipBack size={15} />
        </button>
        <button
          onClick={() => setPlaying(!isPlaying)}
          disabled={!multi}
          title={!multi ? "Add a second step to play" : isPlaying ? "Pause" : "Play"}
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg transition-colors flex-shrink-0",
            !multi
              ? "bg-surface-elevated text-muted-foreground/40 cursor-not-allowed"
              : "bg-primary text-primary-foreground hover:bg-primary/90",
          )}
        >
          {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
        </button>

        {/* Scrub bar */}
        <div className="relative flex-1 h-6 flex items-center">
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface-elevated" />
          <div
            className="absolute left-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary"
            style={{ width: `${playhead * 100}%` }}
          />
          {tickFractions.map((f, i) => (
            <div
              key={i}
              className="absolute top-1/2 -translate-y-1/2 w-0.5 h-2.5 bg-border"
              style={{ left: `${f * 100}%` }}
            />
          ))}
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(playhead * 1000)}
            disabled={!multi}
            onChange={(e) => onScrub(Number(e.target.value))}
            className="rs-scrubber absolute inset-x-0 w-full"
          />
        </div>

        <button
          onClick={() => setLoop(!loop)}
          title="Loop"
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors flex-shrink-0",
            loop
              ? "border-primary/50 bg-primary-dim/40 text-primary"
              : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
          )}
        >
          <Repeat size={14} />
        </button>
        <button
          onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}
          title="Playback speed"
          className="h-8 px-2 rounded-lg border border-border/60 text-xs font-mono-rs text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors flex-shrink-0"
        >
          {speed}×
        </button>
      </div>
    </div>
  );
}

function MiniBtn({
  icon: Icon,
  title,
  onClick,
  disabled,
}: {
  icon: typeof ChevronLeft;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "h-8 flex items-center justify-center rounded-md border transition-colors",
        disabled
          ? "border-border/40 text-muted-foreground/30 cursor-not-allowed"
          : "border-border/60 text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={14} />
    </button>
  );
}
