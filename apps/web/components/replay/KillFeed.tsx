"use client";

import { Bomb, Flame, Shield, Sparkles, Target, Wind, Zap } from "lucide-react";

import { cn } from "@/lib/utils";
import type { GrenadeSubtype, PlayerStats, TimelineEvent } from "@/types/demo";

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
      <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 p-3 flex items-center justify-center shadow-lg">
        <p className="text-[11px] text-muted-foreground">Killfeed</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 shadow-lg overflow-hidden">
      <h3 className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border/40 flex items-center gap-2">
        <span className="w-1 h-1 rounded-full bg-loss animate-pulse" />
        Killfeed
      </h3>
      <div className="max-h-[260px] overflow-y-auto p-1.5 space-y-1">
        {items.slice(0, 24).map((e, i) => (
          <FeedRow key={i} event={e} playerLookup={playerLookup} onHover={onHover} />
        ))}
      </div>
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
    const weaponLabel = (event.weapon ?? "?").replace(/^weapon_/, "").replace(/_/g, " ");

    return (
      <div
        className="grid grid-cols-[28px_1fr_auto_1fr] items-center gap-1.5 px-2 py-1 rounded hover:bg-surface-elevated transition-colors cursor-pointer text-[11px]"
        onMouseEnter={() => killer && onHover?.(killer.steamId)}
        onMouseLeave={() => onHover?.(null)}
      >
        <span className="font-mono-rs text-muted-foreground/70 text-[10px] tabular-nums">
          {formatTime(event.t)}
        </span>
        <span
          className={cn(
            "font-bold uppercase tracking-wide truncate",
            killer?.team === "ct" ? "text-ct" : "text-tt",
          )}
          title={killer?.name ?? "?"}
        >
          {killer?.name ?? "?"}
        </span>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-surface-elevated text-foreground/85 text-[9px] font-mono-rs uppercase tracking-wide">
          {event.headshot && <Target size={8} className="text-loss" />}
          {weaponLabel}
        </span>
        <span
          className={cn(
            "font-bold uppercase tracking-wide truncate text-right line-through",
            victim?.team === "ct" ? "text-ct/55" : "text-tt/55",
          )}
          title={victim?.name ?? "?"}
        >
          {victim?.name ?? "?"}
        </span>
      </div>
    );
  }

  if (event.type === "grenade_thrown") {
    const player = event.player ? playerLookup.get(event.player) : null;
    const subtype = event.subtype as GrenadeSubtype;
    const meta = grenadeMeta(subtype);
    return (
      <div
        className="grid grid-cols-[28px_auto_1fr] items-center gap-1.5 px-2 py-1 rounded text-[11px] opacity-80 hover:opacity-100 transition-opacity"
        onMouseEnter={() => player && onHover?.(player.steamId)}
        onMouseLeave={() => onHover?.(null)}
      >
        <span className="font-mono-rs text-muted-foreground/70 text-[10px] tabular-nums">
          {formatTime(event.t)}
        </span>
        <span
          className="inline-flex items-center justify-center w-4 h-4 rounded-full"
          style={{ background: meta.bg, color: meta.fg }}
          title={meta.label}
        >
          <meta.icon size={9} />
        </span>
        <span
          className={cn(
            "truncate text-[10px] font-mono-rs uppercase tracking-wider",
            player?.team === "ct" ? "text-ct/85" : "text-tt/85",
          )}
        >
          {player?.name ?? "?"} · <span className="text-muted-foreground">{meta.label}</span>
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

function grenadeMeta(subtype: GrenadeSubtype) {
  switch (subtype) {
    case "smoke":
      return { icon: Wind, label: "Smoke", bg: "hsl(220 8% 25%)", fg: "hsl(220 8% 90%)" };
    case "flash":
      return { icon: Sparkles, label: "Flash", bg: "hsl(50 100% 18%)", fg: "hsl(50 100% 75%)" };
    case "molotov":
      return { icon: Flame, label: "Molotov", bg: "hsl(20 95% 18%)", fg: "hsl(20 95% 70%)" };
    case "he":
    default:
      return { icon: Zap, label: "HE", bg: "hsl(15 90% 20%)", fg: "hsl(15 90% 70%)" };
  }
}

function formatTime(s: number): string {
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}
