"use client";

import { useState } from "react";
import { Camera, Clock, UserCheck, UserX } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlayerStats } from "@/types/demo";

interface ReplayToolsPanelProps {
  /** Roster (CT + TT). Used to populate the Follow selector. */
  players: PlayerStats[];
  /** Currently followed steamId (null = camera free). */
  followSteamId: string | null;
  onFollowChange: (steamId: string | null) => void;
  /** Current playback time in seconds (for showing in the jump input). */
  currentTime: number;
  /** Total duration of the round in seconds. */
  duration: number;
  onJumpTo: (seconds: number) => void;
  /** Trigger a PNG screenshot of the map. */
  onScreenshot: () => void;
}

/**
 * Floating tools panel for the replay viewport — the cs2.cam-style
 * "operator" controls that don't fit in the bottom timeline bar:
 *
 *   • Follow Player — camera auto-recenters on the chosen player every
 *     frame. Pick anyone alive in the round.
 *   • Jump to Time — type "1:23" / "83" and the playback head snaps
 *     there. Useful for sharing exact moments.
 *   • Screenshot — exports the current map view as a watermarked PNG.
 *
 * Lives in the top-center of the replay viewport (under the round
 * timer). Compact + collapsible so it doesn't obstruct the map.
 */
export function ReplayToolsPanel({
  players,
  followSteamId,
  onFollowChange,
  currentTime,
  duration,
  onJumpTo,
  onScreenshot,
}: ReplayToolsPanelProps) {
  const [jumpInput, setJumpInput] = useState("");
  const [jumpError, setJumpError] = useState<string | null>(null);
  const [showFollowMenu, setShowFollowMenu] = useState(false);

  const followedPlayer = followSteamId
    ? players.find((p) => p.steamId === followSteamId)
    : null;

  const handleJumpSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const seconds = parseTimeInput(jumpInput);
    if (seconds === null) {
      setJumpError("Use MM:SS or seconds");
      return;
    }
    if (seconds < 0 || seconds > duration) {
      setJumpError(`0 – ${formatTime(duration)}`);
      return;
    }
    setJumpError(null);
    onJumpTo(seconds);
    setJumpInput("");
  };

  // Group players by team for the Follow dropdown.
  const ct = players.filter((p) => p.team === "ct");
  const tt = players.filter((p) => p.team === "tt");

  return (
    <div className="flex items-center gap-1 rounded-md bg-background/85 backdrop-blur-md border border-border/50 px-2 py-1 shadow-lg pointer-events-auto">
      {/* ---- Follow Player ---- */}
      <div className="relative">
        <button
          onClick={() => setShowFollowMenu((v) => !v)}
          title={followedPlayer ? `Following ${followedPlayer.name}` : "Follow a player"}
          className={cn(
            "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono-rs uppercase tracking-wider transition-colors",
            followedPlayer
              ? "bg-primary-dim text-primary"
              : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
          )}
        >
          {followedPlayer ? <UserCheck size={12} /> : <UserX size={12} />}
          <span className="max-w-[80px] truncate">
            {followedPlayer ? followedPlayer.name : "Follow"}
          </span>
        </button>
        {showFollowMenu && (
          <div className="absolute top-full mt-1 left-0 z-30 w-56 rounded-lg bg-surface/95 backdrop-blur-md border border-border/60 shadow-2xl overflow-hidden">
            <button
              onClick={() => {
                onFollowChange(null);
                setShowFollowMenu(false);
              }}
              className="w-full text-left px-3 py-1.5 text-[11px] font-mono-rs uppercase tracking-wide text-muted-foreground hover:bg-surface-elevated hover:text-foreground border-b border-border/30"
            >
              ↺ Free camera
            </button>
            <FollowSection
              label="Counter-Terrorist"
              players={ct}
              activeId={followSteamId}
              onPick={(id) => {
                onFollowChange(id);
                setShowFollowMenu(false);
              }}
              accent="text-ct"
            />
            <FollowSection
              label="Terrorist"
              players={tt}
              activeId={followSteamId}
              onPick={(id) => {
                onFollowChange(id);
                setShowFollowMenu(false);
              }}
              accent="text-tt"
            />
          </div>
        )}
      </div>

      <div className="w-px h-4 bg-border/40" />

      {/* ---- Jump to Time ---- */}
      <form onSubmit={handleJumpSubmit} className="flex items-center gap-1">
        <Clock size={12} className="text-muted-foreground" />
        <input
          type="text"
          value={jumpInput}
          onChange={(e) => {
            setJumpInput(e.target.value);
            if (jumpError) setJumpError(null);
          }}
          placeholder={formatTime(currentTime)}
          title="Jump to time — type MM:SS or seconds (e.g. 1:23 or 83)"
          className={cn(
            "w-14 bg-transparent text-[11px] font-mono-rs tabular-nums tracking-wider outline-none border-b transition-colors",
            jumpError
              ? "border-loss text-loss"
              : "border-border/40 focus:border-primary/60 text-foreground placeholder:text-muted-foreground/50",
          )}
        />
        <button
          type="submit"
          disabled={!jumpInput.trim()}
          className="px-1.5 py-0.5 text-[10px] font-mono-rs uppercase tracking-wider text-primary hover:bg-surface-elevated rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Go
        </button>
      </form>

      <div className="w-px h-4 bg-border/40" />

      {/* ---- Screenshot ---- */}
      <button
        onClick={onScreenshot}
        title="Save screenshot (PNG)"
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono-rs uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors"
      >
        <Camera size={12} />
        <span>Shot</span>
      </button>
    </div>
  );
}

function FollowSection({
  label,
  players,
  activeId,
  onPick,
  accent,
}: {
  label: string;
  players: PlayerStats[];
  activeId: string | null;
  onPick: (steamId: string) => void;
  accent: string;
}) {
  if (players.length === 0) return null;
  return (
    <div className="py-1 border-b border-border/20 last:border-b-0">
      <div className={cn("px-3 pt-1 pb-0.5 text-[9px] font-mono-rs uppercase tracking-widest", accent)}>
        {label}
      </div>
      {players.map((p) => (
        <button
          key={p.steamId}
          onClick={() => onPick(p.steamId)}
          className={cn(
            "w-full text-left px-3 py-1 text-[11px] uppercase tracking-wide truncate flex items-center justify-between gap-2 transition-colors",
            activeId === p.steamId
              ? "bg-primary-dim text-primary"
              : "text-foreground/85 hover:bg-surface-elevated",
          )}
        >
          <span className="truncate">{p.name}</span>
          <span className="text-[9px] font-mono-rs text-muted-foreground tabular-nums">
            {p.rating.toFixed(2)}
          </span>
        </button>
      ))}
    </div>
  );
}

// Accept "M:SS", "MM:SS", or raw seconds — returns the seconds value
// or null if the input is malformed.
function parseTimeInput(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.includes(":")) {
    const [mm, ss] = s.split(":");
    const m = parseInt(mm, 10);
    const sec = parseInt(ss, 10);
    if (!isFinite(m) || !isFinite(sec) || sec < 0 || sec >= 60) return null;
    return m * 60 + sec;
  }
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
