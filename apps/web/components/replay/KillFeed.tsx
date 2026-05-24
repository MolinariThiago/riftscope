"use client";

import {
  Bomb,
  Crosshair,
  Flame,
  Scissors,
  Shield,
  Sparkles,
  Swords,
  Target,
  Wind,
  Zap,
} from "lucide-react";

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
        <WeaponChip weapon={event.weapon ?? null} headshot={!!event.headshot} />
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

// ============================================================================
// Weapon chip — class-based icon + compact code, mirrors TeamLoadoutPanel.
// ============================================================================
function WeaponChip({ weapon, headshot }: { weapon: string | null; headshot: boolean }) {
  const meta = weaponMeta(weapon);
  const Icon = meta.icon;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono-rs uppercase tracking-wide"
      style={{ background: meta.bg, color: meta.fg }}
      title={weapon ?? "unknown"}
    >
      {headshot && <Target size={8} className="text-loss" />}
      <Icon size={9} />
      <span>{meta.label}</span>
    </span>
  );
}

function weaponMeta(weapon: string | null): {
  icon: typeof Crosshair;
  label: string;
  bg: string;
  fg: string;
} {
  if (!weapon) {
    return { icon: Swords, label: "?", bg: "hsl(220 8% 25%)", fg: "hsl(220 8% 75%)" };
  }
  const w = weapon.toLowerCase().replace(/^weapon_/, "");
  // Knife
  if (w.includes("knife") || w === "bayonet") {
    return { icon: Scissors, label: "KNF", bg: "hsl(220 8% 30%)", fg: "hsl(220 8% 88%)" };
  }
  // Bomb / explosion
  if (w === "c4" || w.includes("bomb") || w === "hegrenade") {
    return { icon: Bomb, label: w === "hegrenade" ? "HE" : "C4", bg: "hsl(0 80% 20%)", fg: "hsl(0 80% 70%)" };
  }
  // Fire
  if (w === "molotov" || w === "incgrenade" || w === "inferno") {
    return { icon: Flame, label: "MOL", bg: "hsl(20 95% 18%)", fg: "hsl(20 95% 70%)" };
  }
  // Sniper
  if (["awp", "ssg08", "scar20", "g3sg1"].includes(w)) {
    return { icon: Crosshair, label: compactName(w), bg: "hsl(280 80% 22%)", fg: "hsl(280 80% 78%)" };
  }
  // Rifles
  if (["ak47", "m4a1", "m4a1_silencer", "famas", "galilar", "sg556", "aug"].includes(w)) {
    return { icon: Swords, label: compactName(w), bg: "hsl(213 70% 22%)", fg: "hsl(213 100% 78%)" };
  }
  // SMGs
  if (["mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon"].includes(w)) {
    return { icon: Swords, label: compactName(w), bg: "hsl(160 60% 18%)", fg: "hsl(160 70% 70%)" };
  }
  // Shotguns
  if (["nova", "mag7", "sawedoff", "xm1014"].includes(w)) {
    return { icon: Swords, label: compactName(w), bg: "hsl(15 80% 22%)", fg: "hsl(15 90% 72%)" };
  }
  // Pistols
  if (
    ["glock", "usp_silencer", "p2000", "p250", "fiveseven", "tec9", "cz75a", "deagle", "elite", "revolver"].includes(w)
  ) {
    return { icon: Swords, label: compactName(w), bg: "hsl(40 80% 22%)", fg: "hsl(40 90% 75%)" };
  }
  return { icon: Swords, label: compactName(w), bg: "hsl(220 8% 25%)", fg: "hsl(220 8% 85%)" };
}

function compactName(w: string): string {
  const m: Record<string, string> = {
    ak47: "AK",
    m4a1: "M4",
    m4a1_silencer: "M4S",
    awp: "AWP",
    deagle: "DEA",
    usp_silencer: "USP",
    p2000: "P2K",
    glock: "GLO",
    fiveseven: "5-7",
    tec9: "TEC",
    p250: "P250",
    cz75a: "CZ",
    elite: "DUA",
    revolver: "R8",
    famas: "FAM",
    galilar: "GAL",
    sg556: "SG",
    aug: "AUG",
    mac10: "MAC",
    mp9: "MP9",
    mp7: "MP7",
    mp5sd: "MP5",
    ump45: "UMP",
    p90: "P90",
    bizon: "BIZ",
    nova: "NOVA",
    mag7: "MAG",
    xm1014: "XM",
    sawedoff: "SAW",
    ssg08: "SCT",
    scar20: "SCAR",
    g3sg1: "G3",
  };
  return m[w] ?? w.slice(0, 4).toUpperCase();
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
