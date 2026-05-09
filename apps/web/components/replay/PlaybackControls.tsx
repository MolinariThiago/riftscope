"use client";

import { useMemo } from "react";
import { Pause, Play, RotateCcw, SkipBack, SkipForward } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlaybackControls, PlaybackSpeed, PlaybackState } from "@/lib/hooks/useRoundPlayback";
import type { GrenadeSubtype, TimelineEvent } from "@/types/demo";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4];

interface PlaybackControlsBarProps {
  state: PlaybackState;
  controls: PlaybackControls;
  duration: number;
  events: TimelineEvent[];
}

/**
 * Replay playback bar — CS2.CAM-style.
 *
 * The scrubber renders THREE event lanes:
 *   • Top lane:  utility throws (▲ triangles, color-coded by grenade subtype)
 *   • Middle:    bomb plant / defuse / explode markers
 *   • Bottom:    kill bars colored by killer team (CT blue / T orange)
 */
export function PlaybackControlsBar({
  state,
  controls,
  duration,
  events,
}: PlaybackControlsBarProps) {
  return (
    <div className="rounded-xl bg-surface-elevated/50 border border-border/40 backdrop-blur-sm overflow-hidden">
      <Scrubber
        time={state.time}
        duration={duration}
        events={events}
        onSeek={controls.seek}
      />

      <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border/40">
        <div className="flex items-center gap-1">
          <ControlButton onClick={controls.reset} title="Restart">
            <RotateCcw size={14} />
          </ControlButton>
          <ControlButton onClick={() => controls.step(-5)} title="Back 5s">
            <SkipBack size={14} />
          </ControlButton>
          <button
            onClick={controls.toggle}
            className="w-11 h-11 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center justify-center shadow-lg shadow-primary/20"
            title={state.playing ? "Pause" : "Play"}
          >
            {state.playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <ControlButton onClick={() => controls.step(5)} title="Forward 5s">
            <SkipForward size={14} />
          </ControlButton>
        </div>

        <div className="flex items-center gap-2 font-mono-rs text-sm">
          <span className="text-foreground tabular-nums">{formatTime(state.time)}</span>
          <span className="text-muted-foreground">/</span>
          <span className="text-muted-foreground tabular-nums">{formatTime(duration)}</span>
        </div>

        <div className="flex items-center gap-1">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => controls.setSpeed(s)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-mono-rs transition-colors",
                state.speed === s
                  ? "bg-primary-dim text-primary"
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

// =========================================================================
// Scrubber with utility triangles + kill bars
// =========================================================================

const GRENADE_COLOR: Record<GrenadeSubtype, string> = {
  smoke:   "hsl(220 8% 80%)",
  flash:   "hsl(50 100% 65%)",
  he:      "hsl(15 90% 55%)",
  molotov: "hsl(20 95% 60%)",
};

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

  const { utilities, kills, bombs } = useMemo(() => {
    const utilities: TimelineEvent[] = [];
    const kills: TimelineEvent[] = [];
    const bombs: TimelineEvent[] = [];
    for (const e of events) {
      if (e.type === "grenade_thrown") utilities.push(e);
      else if (e.type === "kill") kills.push(e);
      else if (
        e.type === "bomb_planted" ||
        e.type === "bomb_defused" ||
        e.type === "bomb_exploded"
      ) {
        bombs.push(e);
      }
    }
    return { utilities, kills, bombs };
  }, [events]);

  return (
    <div className="px-4 pt-3 pb-2 space-y-1.5">
      {/* Lane 1: utility triangles ABOVE the scrubber */}
      <div className="relative h-4 mx-1">
        {utilities.map((e, i) => {
          if (duration === 0) return null;
          const left = (e.t / duration) * 100;
          const color = GRENADE_COLOR[e.subtype as GrenadeSubtype] ?? "hsl(220 8% 70%)";
          return (
            <div
              key={`u-${i}`}
              className="absolute top-0 -translate-x-1/2"
              style={{ left: `${left}%` }}
              title={`${formatTime(e.t)} · ${e.subtype}`}
            >
              <Triangle color={color} />
            </div>
          );
        })}
        {bombs.map((e, i) => {
          if (duration === 0) return null;
          const left = (e.t / duration) * 100;
          const color = bombColor(e.type);
          return (
            <div
              key={`b-${i}`}
              className="absolute -bottom-1 -translate-x-1/2 w-2 h-2 rounded-full ring-2 ring-background"
              style={{ left: `${left}%`, background: color }}
              title={`${formatTime(e.t)} · ${e.type}`}
            />
          );
        })}
      </div>

      {/* Scrubber line */}
      <div className="relative">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-surface" />
        <div
          className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-gradient-to-r from-primary to-primary/70"
          style={{ width: `${pct}%` }}
        />
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

      {/* Lane 2: kill bars BELOW the scrubber */}
      <div className="relative h-4 mx-1">
        {kills.map((e, i) => {
          if (duration === 0) return null;
          const left = (e.t / duration) * 100;
          // Color by killer team — fall back to red if unknown.
          const color = killColor(e);
          const past = e.t <= time;
          return (
            <div
              key={`k-${i}`}
              className="absolute top-0 -translate-x-1/2 w-[3px] h-full rounded-sm transition-opacity"
              style={{ left: `${left}%`, background: color, opacity: past ? 1 : 0.6 }}
              title={`${formatTime(e.t)} · kill (${e.weapon ?? "?"})`}
            />
          );
        })}
      </div>
    </div>
  );
}

function Triangle({ color }: { color: string }) {
  // Down-pointing triangle: utility throws displayed above the timeline.
  return (
    <svg width="10" height="10" viewBox="0 0 10 10">
      <polygon points="5,9 0,1 10,1" fill={color} stroke="hsl(220 16% 6%)" strokeWidth="0.5" />
    </svg>
  );
}

function killColor(e: TimelineEvent): string {
  // The kill event itself doesn't carry the killer's team in the timeline,
  // but headshots get a brighter shade to highlight them.
  if (e.headshot) return "hsl(0 95% 65%)";
  return "hsl(350 80% 55%)";
}

function bombColor(type: TimelineEvent["type"]): string {
  if (type === "bomb_defused") return "hsl(150 70% 55%)";
  if (type === "bomb_exploded") return "hsl(20 95% 55%)";
  return "hsl(0 80% 55%)"; // planted
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
