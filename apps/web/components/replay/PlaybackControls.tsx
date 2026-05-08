"use client";

import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlaybackControls, PlaybackSpeed, PlaybackState } from "@/lib/hooks/useRoundPlayback";
import type { TimelineEvent } from "@/types/demo";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4];

interface PlaybackControlsBarProps {
  state: PlaybackState;
  controls: PlaybackControls;
  duration: number;
  events: TimelineEvent[];
}

export function PlaybackControlsBar({
  state,
  controls,
  duration,
  events,
}: PlaybackControlsBarProps) {
  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <Scrubber
        time={state.time}
        duration={duration}
        events={events}
        onSeek={controls.seek}
      />

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1">
          <ControlButton onClick={controls.reset} title="Restart">
            <RotateCcw size={14} />
          </ControlButton>
          <ControlButton onClick={() => controls.step(-5)} title="Back 5s">
            <SkipBack size={14} />
          </ControlButton>
          <button
            onClick={controls.toggle}
            className="w-10 h-10 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center"
            title={state.playing ? "Pause" : "Play"}
          >
            {state.playing ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
          </button>
          <ControlButton onClick={() => controls.step(5)} title="Forward 5s">
            <SkipForward size={14} />
          </ControlButton>
        </div>

        <div className="flex items-center gap-3 font-mono-rs text-xs">
          <span>
            <span className="text-foreground">{formatTime(state.time)}</span>
            <span className="text-muted-foreground"> / {formatTime(duration)}</span>
          </span>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => controls.setSpeed(s)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-mono-rs transition-colors",
                state.speed === s
                  ? "bg-surface-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ControlButton({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded-full text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors flex items-center justify-center"
    >
      {children}
    </button>
  );
}

function Scrubber({
  time,
  duration,
  events,
  onSeek,
}: {
  time: number;
  duration: number;
  events: TimelineEvent[];
  onSeek: (t: number) => void;
}) {
  const pct = duration > 0 ? (time / duration) * 100 : 0;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onSeek(parseFloat(e.target.value));
  };

  return (
    <div className="relative">
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface-elevated" />
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-primary"
        style={{ width: `${pct}%` }}
      />

      {/* Event markers (kills, bombs) along the scrubber */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 pointer-events-none">
        {events.map((e, i) => {
          if (duration === 0) return null;
          const left = (e.t / duration) * 100;
          const color = eventMarkerColor(e);
          if (!color) return null;
          return (
            <div
              key={i}
              className="absolute -translate-x-1/2 -top-0.5 w-1 h-2.5 rounded-sm"
              style={{ left: `${left}%`, backgroundColor: color }}
              title={`${formatTime(e.t)} · ${e.type}`}
            />
          );
        })}
      </div>

      <input
        type="range"
        min={0}
        max={duration}
        step={0.05}
        value={time}
        onChange={handleChange}
        className="relative w-full h-1.5 appearance-none bg-transparent cursor-pointer rs-scrubber"
      />
    </div>
  );
}

function eventMarkerColor(e: TimelineEvent): string | null {
  if (e.type === "kill") return "hsl(350 80% 60%)";
  if (e.type === "bomb_planted") return "hsl(0 80% 55%)";
  if (e.type === "bomb_defused") return "hsl(150 60% 50%)";
  if (e.type === "bomb_exploded") return "hsl(20 90% 55%)";
  return null;
}

function formatTime(s: number): string {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
