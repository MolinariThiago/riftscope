"use client";

// Compact frame controller — playback transport only.
// Frame buttons themselves live in the main TacticsToolbar (bottom centred).
// This bar handles play / pause / restart / speed / loop + scrub.

import {
  Play,
  Pause,
  SkipBack,
  Repeat,
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
  const setPlaying = usePlaybook((s) => s.setPlaying);
  const setLoop = usePlaybook((s) => s.setLoop);
  const setSpeed = usePlaybook((s) => s.setSpeed);
  const setPlayhead = usePlaybook((s) => s.setPlayhead);

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

  // Don't render the whole transport if there's just one frame — nothing to play.
  if (!multi) return null;

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl px-3 py-2 shadow-2xl w-[min(420px,80vw)]">
      <button
        onClick={restart}
        title="Reiniciar"
        className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors flex-shrink-0"
      >
        <SkipBack size={14} />
      </button>
      <button
        onClick={() => setPlaying(!isPlaying)}
        title={isPlaying ? "Pausa" : "Reproducir"}
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex-shrink-0"
      >
        {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
      </button>

      {/* Scrub bar */}
      <div className="relative flex-1 h-6 flex items-center min-w-0">
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
          onChange={(e) => onScrub(Number(e.target.value))}
          className="rs-scrubber absolute inset-x-0 w-full"
        />
      </div>

      <button
        onClick={() => setLoop(!loop)}
        title="Loop"
        className={cn(
          "flex h-8 w-8 items-center justify-center rounded-lg transition-colors flex-shrink-0",
          loop
            ? "bg-primary-dim/60 text-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
        )}
      >
        <Repeat size={13} />
      </button>
      <button
        onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length] ?? 1)}
        title="Velocidad"
        className="h-8 px-2 rounded-lg text-xs font-mono-rs text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors flex-shrink-0"
      >
        {speed}×
      </button>
    </div>
  );
}
