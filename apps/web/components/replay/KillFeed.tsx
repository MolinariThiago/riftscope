"use client";

import { Bomb, Shield, Skull } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlayerStats, TimelineEvent } from "@/types/demo";

interface KillFeedProps {
  events: TimelineEvent[];
  playerLookup: Map<string, PlayerStats>;
  onHover?: (steamId: string | null) => void;
}

export function KillFeed({ events, playerLookup, onHover }: KillFeedProps) {
  // Reverse chronological so most recent is on top
  const items = [...events].reverse();

  if (items.length === 0) {
    return (
      <div className="glass-card rounded-xl p-4 h-full flex items-center justify-center">
        <p className="text-xs text-muted-foreground">No events yet</p>
      </div>
    );
  }

  return (
    <div className="glass-card rounded-xl p-3 max-h-[480px] overflow-y-auto space-y-1.5">
      <h3 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground sticky top-0 bg-surface/95 backdrop-blur-sm py-1">
        Kill feed
      </h3>
      {items.map((e, i) => (
        <FeedRow key={i} event={e} playerLookup={playerLookup} onHover={onHover} />
      ))}
    </div>
  );
}

function FeedRow({
  event,
  playerLookup,
  onHover,
}: {
  event: TimelineEvent;
  playerLookup: Map<string, PlayerStats>;
  onHover?: (steamId: string | null) => void;
}) {
  if (event.type === "kill") {
    const killer = event.killer ? playerLookup.get(event.killer) : null;
    const victim = event.victim ? playerLookup.get(event.victim) : null;

    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-elevated transition-colors cursor-pointer text-xs"
        onMouseEnter={() => killer && onHover?.(killer.steamId)}
        onMouseLeave={() => onHover?.(null)}
      >
        <span className="font-mono-rs text-muted-foreground w-10 flex-shrink-0">
          {formatTime(event.t)}
        </span>
        <span
          className={cn(
            "font-semibold truncate",
            killer?.team === "ct" ? "text-ct" : "text-tt",
          )}
        >
          {killer?.name ?? "?"}
        </span>
        <span className="text-muted-foreground flex-shrink-0">
          [{event.weapon}]
        </span>
        {event.headshot && <Skull size={10} className="text-loss flex-shrink-0" />}
        <span
          className={cn(
            "font-semibold truncate ml-auto",
            victim?.team === "ct" ? "text-ct/70 line-through" : "text-tt/70 line-through",
          )}
        >
          {victim?.name ?? "?"}
        </span>
      </div>
    );
  }

  if (event.type === "bomb_planted") {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-loss/10">
        <span className="font-mono-rs text-muted-foreground w-10 flex-shrink-0">
          {formatTime(event.t)}
        </span>
        <Bomb size={11} className="text-loss" />
        <span className="text-loss font-semibold">Bomb planted on {event.site}</span>
      </div>
    );
  }

  if (event.type === "bomb_defused") {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-win/10">
        <span className="font-mono-rs text-muted-foreground w-10 flex-shrink-0">
          {formatTime(event.t)}
        </span>
        <Shield size={11} className="text-win" />
        <span className="text-win font-semibold">Bomb defused</span>
      </div>
    );
  }

  if (event.type === "bomb_exploded") {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs bg-loss/15">
        <span className="font-mono-rs text-muted-foreground w-10 flex-shrink-0">
          {formatTime(event.t)}
        </span>
        <Bomb size={11} className="text-loss animate-pulse" />
        <span className="text-loss font-semibold">Bomb exploded</span>
      </div>
    );
  }

  return null;
}

function formatTime(s: number): string {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
