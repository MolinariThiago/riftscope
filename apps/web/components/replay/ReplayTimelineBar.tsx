"use client";

import { useMemo } from "react";
import {
  Camera,
  Cloud,
  Headphones,
  Pause,
  Pencil,
  Play,
  Settings as Gear,
  Star,
  Timer,
  Trash2,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  PlaybackControls,
  PlaybackState,
} from "@/lib/hooks/useRoundPlayback";
import type {
  GrenadeSubtype,
  PlayerStats,
  Round,
  TimelineEvent,
} from "@/types/demo";

interface ReplayTimelineBarProps {
  rounds: Round[];
  currentRound: number;
  onRoundChange: (n: number) => void;

  state: PlaybackState;
  controls: PlaybackControls;
  duration: number;
  events: TimelineEvent[];

  /** Resolves steamId -> display name / team. Used for avatar tooltips. */
  playerLookup: Map<string, PlayerStats>;
  onHover?: (steamId: string | null) => void;

  /** Optional — wire these to actual handlers as they ship. */
  onToggleLayers?: () => void;
  onBookmark?: () => void;
}

/**
 * CS2.CAM-style unified bottom bar — round strip + integrated event timeline
 * + side toolbars. Rounds are always visible (flex-1, never scroll), events
 * render on the timeline with the killer/thrower avatar at the base.
 *
 *   ┌─────────┬────────────────────────────────────────┬─────────┐
 *   │ Notas   │  Round strip (1..N, color = winner)    │ ✏ 🗑    │
 *   │ 😎 75   │  Event timeline (scrubber + lanes)     │ 🎧 ⏱    │
 *   │ ⏵ play  │  ▲ utility · ❘ kill bar · ● bomb        │ ⚙ ⭐ 📹  │
 *   └─────────┴────────────────────────────────────────┴─────────┘
 */
export function ReplayTimelineBar({
  rounds,
  currentRound,
  onRoundChange,
  state,
  controls,
  duration,
  events,
  playerLookup,
  onHover,
  onToggleLayers,
  onBookmark,
}: ReplayTimelineBarProps) {
  const halfPoint = Math.floor(rounds.length / 2);

  return (
    <div className="flex items-stretch bg-surface/80 backdrop-blur-md border-t border-border/50">
      {/* ============================================================
          LEFT TOOLS — Notas, emojis, play/pause
          ============================================================ */}
      <div className="flex flex-col items-stretch gap-1.5 px-2.5 py-2 border-r border-border/40 min-w-[120px]">
        <button
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors"
          title="Notes (coming soon)"
        >
          <Cloud size={11} />
          Notas
        </button>
        <div className="flex items-center gap-1.5">
          <EmojiBadge emoji="🤓" count={rounds.length} />
          <EmojiBadge emoji="🥶" count={Math.max(0, events.filter((e) => e.type === "kill").length)} />
        </div>
        <button
          onClick={controls.toggle}
          className="mt-1 inline-flex items-center justify-center h-9 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-md shadow-primary/20"
          title={state.playing ? "Pause" : "Play"}
        >
          {state.playing ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" className="ml-0.5" />}
        </button>
      </div>

      {/* ============================================================
          CENTER — Round strip on top, event timeline below
          ============================================================ */}
      <div className="flex-1 min-w-0 flex flex-col px-3 py-2 gap-1.5">
        {/* Round strip */}
        <div className="flex items-center gap-[2px] w-full">
          {rounds.map((r, idx) => {
            const active = r.number === currentRound;
            const ctWon = r.winner === "ct";
            const showHalfBreak = idx === halfPoint && idx > 0;
            return (
              <div key={r.number} className="flex items-center flex-1 min-w-0">
                {showHalfBreak && (
                  <div className="self-stretch w-px bg-border/60 mx-1" aria-hidden />
                )}
                <RoundCell round={r} active={active} ctWon={ctWon} onSelect={onRoundChange} />
              </div>
            );
          })}
        </div>

        {/* Event timeline (scrubber + utility/kill markers + avatars) */}
        <EventTimeline
          time={state.time}
          duration={duration}
          events={events}
          onSeek={controls.seek}
          playerLookup={playerLookup}
          onHover={onHover}
        />

        {/* Time + speed */}
        <div className="flex items-center justify-between gap-3 px-1">
          <div className="flex items-center gap-2 font-mono-rs text-xs">
            <span className="text-foreground tabular-nums">{formatTime(state.time)}</span>
            <span className="text-muted-foreground">/</span>
            <span className="text-muted-foreground tabular-nums">{formatTime(duration)}</span>
          </div>
          <div className="flex items-center gap-1">
            {[0.5, 1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => controls.setSpeed(s as 0.5 | 1 | 2 | 4)}
                className={cn(
                  "px-2 py-0.5 rounded text-[11px] font-mono-rs transition-colors",
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

      {/* ============================================================
          RIGHT TOOLS — annotation + utility actions
          ============================================================ */}
      <div className="flex items-center gap-0.5 px-2 py-2 border-l border-border/40">
        <ToolBtn icon={Pencil} title="Drawing mode (coming soon)" />
        <ToolBtn icon={Trash2} title="Clear annotations (coming soon)" />
        <ToolBtn icon={Headphones} title="Demo audio (coming soon)" />
        <ToolBtn icon={Timer} title="Jump to time (coming soon)" />
        <ToolBtn icon={Gear} title="Layers / settings" onClick={onToggleLayers} />
        <ToolBtn icon={Star} title="Bookmark this moment" onClick={onBookmark} />
        <ToolBtn icon={Camera} title="Export clip (coming soon)" />
      </div>
    </div>
  );
}

// =========================================================================
// Pieces
// =========================================================================

function ToolBtn({
  icon: Icon,
  title,
  onClick,
}: {
  icon: React.ElementType;
  title: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="w-9 h-9 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors flex items-center justify-center"
    >
      <Icon size={14} />
    </button>
  );
}

function EmojiBadge({ emoji, count }: { emoji: string; count: number }) {
  return (
    <div
      className="inline-flex items-center justify-center h-6 w-7 rounded-full bg-surface-elevated border border-border/40 text-[12px] leading-none cursor-default"
      title={`${count}`}
    >
      <span className="-translate-y-px">{emoji}</span>
    </div>
  );
}

function RoundCell({
  round: r,
  active,
  ctWon,
  onSelect,
}: {
  round: Round;
  active: boolean;
  ctWon: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(r.number)}
      className={cn(
        "relative flex-1 h-7 min-w-0 flex items-center justify-center rounded-sm font-mono-rs",
        "transition-all duration-150 group",
        active
          ? "bg-surface-elevated text-foreground font-bold"
          : "text-muted-foreground hover:bg-surface-elevated/60 hover:text-foreground",
      )}
      title={`Round ${r.number} — ${r.winner.toUpperCase()} ${r.endReason}${r.bombPlanted ? ` · bomb ${r.bombSite}` : ""}`}
    >
      <span className="text-[11px] tabular-nums leading-none">{r.number}</span>
      {/* underline shows the winner */}
      <span
        className={cn(
          "absolute bottom-0 left-1/2 -translate-x-1/2 h-[2px] rounded-full transition-all",
          active ? "w-full" : "w-3/4",
          ctWon ? "bg-ct" : "bg-tt",
          active ? "opacity-100" : "opacity-80",
        )}
      />
      {r.bombPlanted && (
        <span
          className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full bg-loss"
          title={`Bomb planted on ${r.bombSite ?? "?"}`}
        />
      )}
    </button>
  );
}

// =========================================================================
// Event timeline — scrubber + utility triangles + kill bars + avatars
// =========================================================================

const GRENADE_COLOR: Record<GrenadeSubtype, string> = {
  smoke: "hsl(220 8% 80%)",
  flash: "hsl(50 100% 65%)",
  he: "hsl(15 90% 55%)",
  molotov: "hsl(20 95% 60%)",
};

function EventTimeline({
  time,
  duration,
  events,
  onSeek,
  playerLookup,
  onHover,
}: {
  time: number;
  duration: number;
  events: TimelineEvent[];
  onSeek: (t: number) => void;
  playerLookup: Map<string, PlayerStats>;
  onHover?: (steamId: string | null) => void;
}) {
  const pct = duration > 0 ? (time / duration) * 100 : 0;

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
    <div className="relative h-12 group">
      {/* Track background */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1 rounded-full bg-surface/70" />

      {/* Played portion */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-1 rounded-full bg-gradient-to-r from-primary/80 to-primary"
        style={{ width: `${pct}%` }}
      />

      {/* Tick marks every 10% — subtle */}
      {[10, 20, 30, 40, 50, 60, 70, 80, 90].map((p) => (
        <div
          key={p}
          className="absolute top-1/2 -translate-y-1/2 w-px h-3 bg-border/50"
          style={{ left: `${p}%` }}
          aria-hidden
        />
      ))}

      {/* Kill bars (TOP HALF — above the track) */}
      {kills.map((e, i) => {
        if (duration === 0) return null;
        const left = (e.t / duration) * 100;
        const past = e.t <= time;
        const team = playerLookup.get(e.killer ?? "")?.team;
        const color = team === "ct" ? "hsl(213 100% 65%)" : team === "tt" ? "hsl(33 100% 64%)" : "hsl(350 80% 60%)";
        const headshot = e.headshot;
        return (
          <div
            key={`k-${i}`}
            className="absolute -translate-x-1/2 top-0 flex flex-col items-center"
            style={{ left: `${left}%` }}
            onMouseEnter={() => e.killer && onHover?.(e.killer)}
            onMouseLeave={() => onHover?.(null)}
          >
            <div
              className={cn(
                "w-[3px] rounded-sm shadow",
                "transition-opacity",
              )}
              style={{
                background: color,
                height: headshot ? "20px" : "16px",
                opacity: past ? 1 : 0.55,
                boxShadow: past ? `0 0 6px ${color}` : "none",
              }}
              title={`${formatTime(e.t)} · ${playerLookup.get(e.killer ?? "")?.name ?? "?"} → ${playerLookup.get(e.victim ?? "")?.name ?? "?"} (${e.weapon ?? "?"})${headshot ? " · HS" : ""}`}
            />
          </div>
        );
      })}

      {/* Utility markers (BOTTOM HALF — below the track) — triangle + avatar */}
      {utilities.map((e, i) => {
        if (duration === 0) return null;
        const left = (e.t / duration) * 100;
        const subtype = (e.subtype ?? "smoke") as GrenadeSubtype;
        const color = GRENADE_COLOR[subtype];
        const player = playerLookup.get(e.player ?? "");
        const past = e.t <= time;
        return (
          <div
            key={`u-${i}`}
            className="absolute -translate-x-1/2 bottom-0 flex flex-col items-center"
            style={{ left: `${left}%`, opacity: past ? 1 : 0.55 }}
            onMouseEnter={() => e.player && onHover?.(e.player)}
            onMouseLeave={() => onHover?.(null)}
          >
            <Triangle color={color} />
            {player && (
              <PlayerDot
                name={player.name}
                team={player.team}
              />
            )}
          </div>
        );
      })}

      {/* Bomb dots — center of track, larger ring */}
      {bombs.map((e, i) => {
        if (duration === 0) return null;
        const left = (e.t / duration) * 100;
        const color = e.type === "bomb_defused"
          ? "hsl(150 70% 55%)"
          : e.type === "bomb_exploded"
            ? "hsl(20 95% 55%)"
            : "hsl(0 80% 55%)";
        return (
          <div
            key={`b-${i}`}
            className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full ring-2 ring-background z-10"
            style={{ left: `${left}%`, background: color }}
            title={`${formatTime(e.t)} · ${e.type.replace("bomb_", "")}`}
          />
        );
      })}

      {/* Playhead (vertical white line) */}
      <div
        className="absolute top-0 bottom-0 w-px bg-foreground pointer-events-none z-20"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground" />
      </div>

      {/* Range slider for seeking */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.05}
        value={time}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer rs-scrubber z-30"
      />
    </div>
  );
}

function Triangle({ color }: { color: string }) {
  return (
    <svg width="9" height="8" viewBox="0 0 9 8">
      <polygon
        points="4.5,0 0,7 9,7"
        fill={color}
        stroke="hsl(220 16% 6%)"
        strokeWidth="0.6"
      />
    </svg>
  );
}

function PlayerDot({ name, team }: { name: string; team: "ct" | "tt" }) {
  const color = team === "ct" ? "hsl(213 100% 65%)" : "hsl(33 100% 64%)";
  // First glyph from a name with possible emoji prefix — strip non-letter
  // characters so the avatar reads as a normal initial.
  const letter = (() => {
    for (const ch of name) {
      if (/[A-Za-z0-9]/.test(ch)) return ch.toUpperCase();
    }
    return "?";
  })();
  return (
    <span
      title={name}
      className="mt-0.5 flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] font-bold leading-none"
      style={{
        background: color,
        color: "hsl(220 16% 8%)",
        boxShadow: "0 0 0 1.5px hsl(220 16% 6%)",
      }}
    >
      {letter}
    </span>
  );
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
