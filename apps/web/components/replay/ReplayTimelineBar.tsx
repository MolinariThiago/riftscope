"use client";

import { useMemo, useState } from "react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Pause,
  Pencil,
  Play,
  Settings as Gear,
  Star,
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

  playerLookup: Map<string, PlayerStats>;
  onHover?: (steamId: string | null) => void;

  onToggleLayers?: () => void;
  onBookmark?: () => void;
  drawingMode?: boolean;
  onToggleDrawing?: () => void;
  onClearDrawings?: () => void;
}

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
  drawingMode = false,
  onToggleDrawing,
  onClearDrawings,
}: ReplayTimelineBarProps) {
  const halfPoint = Math.ceil(rounds.length / 2);
  const currentIdx = rounds.findIndex((r) => r.number === currentRound);

  const goPrev = () => {
    if (currentIdx > 0) onRoundChange(rounds[currentIdx - 1].number);
  };
  const goNext = () => {
    if (currentIdx < rounds.length - 1) onRoundChange(rounds[currentIdx + 1].number);
  };

  return (
    <div className="flex flex-col bg-[hsl(220_16%_8%/0.35)] backdrop-blur-md border-t border-border/30">
      {/* ====== Row 1: Round strip ====== */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border/30">
        <button
          onClick={goPrev}
          disabled={currentIdx <= 0}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ChevronLeft size={14} />
        </button>

        <div className="flex-1 flex items-center justify-center gap-[3px]">
          {rounds.map((r, idx) => {
            const active = r.number === currentRound;
            const ctWon = r.winner === "ct";
            const isHalf = idx === halfPoint;
            return (
              <div key={r.number} className="contents">
                {isHalf && (
                  <div className="w-[2px] self-stretch mx-0.5 rounded-full bg-border/50" />
                )}
                <button
                  onClick={() => onRoundChange(r.number)}
                  className={cn(
                    "relative w-7 h-7 flex items-center justify-center rounded transition-all text-[11px] font-mono-rs tabular-nums",
                    active
                      ? "bg-primary text-primary-foreground font-bold shadow-md shadow-primary/30"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated/60",
                  )}
                  title={`Round ${r.number} — ${r.winner.toUpperCase()} (${r.endReason})`}
                >
                  {r.number}
                  {/* Winner color bar at the bottom */}
                  <span
                    className={cn(
                      "absolute bottom-0 inset-x-1 h-[2.5px] rounded-full",
                      active ? "opacity-0" : "opacity-90",
                    )}
                    style={{
                      background: ctWon
                        ? "hsl(213 100% 62%)"
                        : "hsl(33 100% 60%)",
                    }}
                  />
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={goNext}
          disabled={currentIdx >= rounds.length - 1}
          className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ChevronRight size={14} />
        </button>
      </div>

      {/* ====== Row 2: Playback controls + event timeline + tools ====== */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        {/* Play / speed / time */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={controls.toggle}
            className="w-8 h-8 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 flex items-center justify-center transition-colors"
            title={state.playing ? "Pause" : "Play"}
          >
            {state.playing ? (
              <Pause size={14} fill="currentColor" />
            ) : (
              <Play size={14} fill="currentColor" className="ml-0.5" />
            )}
          </button>

          <div className="flex items-center gap-0.5">
            {[0.5, 1, 2, 4].map((s) => (
              <button
                key={s}
                onClick={() => controls.setSpeed(s as 0.5 | 1 | 2 | 4)}
                className={cn(
                  "px-1 py-0.5 rounded text-[10px] font-mono-rs transition-colors",
                  state.speed === s
                    ? "bg-primary-dim text-primary font-bold"
                    : "text-muted-foreground/60 hover:text-muted-foreground",
                )}
              >
                {s}x
              </button>
            ))}
          </div>

          <div className="font-mono-rs text-[11px] text-muted-foreground tabular-nums ml-1 min-w-[68px]">
            <span className="text-foreground">{formatTime(state.time)}</span>
            <span className="mx-0.5 opacity-50">/</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Event timeline */}
        <div className="flex-1 min-w-0">
          <EventTimeline
            time={state.time}
            duration={duration}
            events={events}
            onSeek={controls.seek}
            playerLookup={playerLookup}
            onHover={onHover}
          />
        </div>

        {/* Right tools */}
        <div className="flex items-center gap-0.5 flex-shrink-0">
          <ToolBtn
            icon={Pencil}
            title={drawingMode ? "Exit drawing" : "Draw"}
            active={drawingMode}
            onClick={onToggleDrawing}
          />
          <ToolBtn icon={Trash2} title="Clear drawings" onClick={onClearDrawings} />
          <ToolBtn icon={Gear} title="Layers" onClick={onToggleLayers} />
          <ToolBtn icon={Star} title="Save round" onClick={onBookmark} />
          <ToolBtn icon={Camera} title="Screenshot" />
        </div>
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
  active = false,
}: {
  icon: React.ElementType;
  title: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "w-7 h-7 rounded-md transition-colors flex items-center justify-center",
        active
          ? "bg-primary-dim text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={13} />
    </button>
  );
}

// =========================================================================
// Event timeline — scrubber + kill bars (top) + utility triangles (bottom)
// =========================================================================

// Weapon silhouettes used as CSS masks — the shape is taken from the image,
// the color comes entirely from background-color (team color), so the
// original image color (black/white/grey) never matters.
const GRENADE_IMG: Record<GrenadeSubtype, string> = {
  smoke:   "/weapons/smokegrenade.webp",
  flash:   "/weapons/flashbang.webp",
  he:      "/weapons/hegrenade.svg",
  molotov: "/weapons/molotov.svg",
};

const CT_COLOR  = "hsl(213 100% 62%)";
const TT_COLOR  = "hsl(33  100% 60%)";

/** Build the CS2 lineup command from a grenade throw event. */
function buildLineupCmd(e: TimelineEvent): string | null {
  const x = e.throwerX;
  const y = e.throwerY;
  const z = e.throwerZ;
  const pitch = e.throwerPitch;
  const yaw = e.throwerYaw;
  if (x == null || y == null || z == null || pitch == null || yaw == null) return null;
  return `setpos ${x} ${y} ${z}; setang ${pitch} ${yaw}`;
}

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
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleUtilClick = (e: TimelineEvent, i: number) => {
    const cmd = buildLineupCmd(e);
    if (!cmd) return;
    navigator.clipboard.writeText(cmd).then(() => {
      setCopiedIdx(i);
      setTimeout(() => setCopiedIdx(null), 1800);
    });
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
    <div className="relative h-9 group rounded-lg bg-surface/40">
      {/* Track */}
      <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-border/30" />

      {/* Played */}
      <div
        className="absolute top-1/2 -translate-y-1/2 h-[3px] rounded-full bg-primary/70"
        style={{ width: `${pct}%` }}
      />

      {/* Kill bars — above center line */}
      {kills.map((e, i) => {
        if (duration === 0) return null;
        const left = (e.t / duration) * 100;
        const past = e.t <= time;
        // Prefer the per-round side baked into the event (correct across the
        // halftime swap); fall back to the summary team for older demos.
        const team = e.team ?? playerLookup.get(e.killer ?? "")?.team;
        const isCt = team === "ct";
        const color = isCt ? "hsl(213 100% 62%)" : "hsl(33 100% 60%)";
        return (
          <div
            key={`k-${i}`}
            className="absolute -translate-x-1/2 flex flex-col items-center"
            style={{ left: `${left}%`, bottom: "50%", opacity: past ? 1 : 0.4 }}
            onMouseEnter={() => e.killer && onHover?.(e.killer)}
            onMouseLeave={() => onHover?.(null)}
          >
            <div
              className="w-[2.5px] rounded-sm"
              style={{
                background: color,
                height: e.headshot ? "14px" : "10px",
                boxShadow: past ? `0 0 4px ${color}` : "none",
              }}
              title={`${formatTime(e.t)} · ${playerLookup.get(e.killer ?? "")?.name ?? "?"} → ${playerLookup.get(e.victim ?? "")?.name ?? "?"} (${e.weapon ?? "?"})${e.headshot ? " HS" : ""}`}
            />
          </div>
        );
      })}

      {/* Utility icons — below center line, real CS2 weapon images */}
      {utilities.map((e, i) => {
        if (duration === 0) return null;
        const left = (e.t / duration) * 100;
        const subtype = (e.subtype ?? "smoke") as GrenadeSubtype;
        const past = e.t <= time;
        const player = playerLookup.get(e.player ?? "");
        const thrower = player?.name ?? "?";
        // e.team is now baked correctly by the parser (per-round side).
        const isCt = (e.team ?? player?.team) === "ct";
        const teamColor = isCt ? CT_COLOR : TT_COLOR;
        const src = GRENADE_IMG[subtype] ?? GRENADE_IMG.he;
        const cmd = buildLineupCmd(e);
        const copied = copiedIdx === i;
        return (
          <div
            key={`u-${i}`}
            className="absolute -translate-x-1/2"
            style={{
              left: `${left}%`,
              top: "50%",
              marginTop: "3px",
            }}
            onMouseEnter={() => e.player && onHover?.(e.player)}
            onMouseLeave={() => onHover?.(null)}
          >
            <span
              onClick={cmd ? () => handleUtilClick(e, i) : undefined}
              style={{
                display: "block",
                width: 14,
                height: 14,
                backgroundColor: copied ? "hsl(142 70% 60%)" : teamColor,
                WebkitMaskImage: `url(${src})`,
                maskImage: `url(${src})`,
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskPosition: "center",
                maskPosition: "center",
                opacity: past ? 1 : 0.45,
                cursor: cmd ? "pointer" : "default",
                transition: "background-color 0.2s",
              }}
              title={
                copied
                  ? "¡Copiado!"
                  : cmd
                    ? `${formatTime(e.t)} · ${subtype} · ${thrower}\nClick → copiar comando CS2`
                    : `${formatTime(e.t)} · ${subtype} · ${thrower}`
              }
            />
          </div>
        );
      })}

      {/* Bomb events — on the center line */}
      {bombs.map((e, i) => {
        if (duration === 0) return null;
        const left = (e.t / duration) * 100;
        const color =
          e.type === "bomb_defused"
            ? "hsl(150 70% 55%)"
            : e.type === "bomb_exploded"
              ? "hsl(20 95% 55%)"
              : "hsl(0 80% 55%)";
        return (
          <div
            key={`b-${i}`}
            className="absolute -translate-x-1/2 top-1/2 -translate-y-1/2 w-2 h-2 rounded-full ring-[1.5px] ring-[hsl(220_16%_8%)] z-10"
            style={{ left: `${left}%`, background: color }}
            title={`${formatTime(e.t)} · ${e.type.replace("bomb_", "")}`}
          />
        );
      })}

      {/* Playhead */}
      <div
        className="absolute top-0 bottom-0 w-px bg-foreground/80 pointer-events-none z-20"
        style={{ left: `${pct}%` }}
      >
        <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-foreground shadow-sm" />
      </div>

      {/* Scrubber */}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.05}
        value={time}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-30"
      />
    </div>
  );
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
