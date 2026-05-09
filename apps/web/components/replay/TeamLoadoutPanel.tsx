"use client";

import { Bomb } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  FramePlayer,
  PlayerLoadout,
  PlayerStats,
  TimelineFrame,
} from "@/types/demo";

interface TeamLoadoutPanelProps {
  frame: TimelineFrame | null;
  loadouts: Record<string, PlayerLoadout> | undefined;
  playerLookup: Map<string, PlayerStats>;
  ctAlive?: number;
  ttAlive?: number;
  ctScore?: number;
  ttScore?: number;
  ctName?: string;
  ttName?: string;
  focusedSteamId?: string | null;
  onHover?: (steamId: string | null) => void;
}

/**
 * cs2.cam-style team loadout panels — one card per team with a per-player
 * row showing nick on the left, weapon icon + cash on the right, and a
 * compact equipment strip (helmet / kit / 4 grenade slots) below.
 *
 *   ┌─ CYBERSHOKE ────────── 1 ┐
 *   │ alpha--               $50 │
 *   │ AK47   🛡 🔧 ◯ ◯ ◯ ◯       │
 *   ├──────────────────────────┤
 *   │ ...                       │
 *   └──────────────────────────┘
 */
export function TeamLoadoutPanel({
  frame,
  loadouts,
  playerLookup,
  ctAlive,
  ttAlive,
  ctScore,
  ttScore,
  ctName = "Team CT",
  ttName = "Team T",
  focusedSteamId,
  onHover,
}: TeamLoadoutPanelProps) {
  const teamCt: FramePlayer[] = [];
  const teamTt: FramePlayer[] = [];

  const fromFrame = frame?.players;
  if (fromFrame && fromFrame.length > 0) {
    for (const p of fromFrame) (p.team === "ct" ? teamCt : teamTt).push(p);
  } else {
    playerLookup.forEach((p) => {
      const ghost: FramePlayer = {
        steamId: p.steamId,
        team: p.team,
        name: p.name,
        x: 0,
        y: 0,
        alive: true,
        hp: 100,
      };
      (p.team === "ct" ? teamCt : teamTt).push(ghost);
    });
  }

  return (
    <div className="space-y-2">
      <TeamCard
        team="ct"
        teamName={ctName}
        score={ctScore}
        players={teamCt}
        loadouts={loadouts}
        playerLookup={playerLookup}
        alive={ctAlive ?? teamCt.filter((p) => p.alive).length}
        focusedSteamId={focusedSteamId ?? null}
        onHover={onHover}
      />
      <TeamCard
        team="tt"
        teamName={ttName}
        score={ttScore}
        players={teamTt}
        loadouts={loadouts}
        playerLookup={playerLookup}
        alive={ttAlive ?? teamTt.filter((p) => p.alive).length}
        focusedSteamId={focusedSteamId ?? null}
        onHover={onHover}
      />
    </div>
  );
}

function TeamCard({
  team,
  teamName,
  score,
  players,
  loadouts,
  playerLookup,
  alive,
  focusedSteamId,
  onHover,
}: {
  team: "ct" | "tt";
  teamName: string;
  score?: number;
  players: FramePlayer[];
  loadouts: Record<string, PlayerLoadout> | undefined;
  playerLookup: Map<string, PlayerStats>;
  alive: number;
  focusedSteamId: string | null;
  onHover?: (steamId: string | null) => void;
}) {
  const accent = team === "ct" ? "text-ct" : "text-tt";
  return (
    <div
      className={cn(
        "rounded-xl bg-surface/75 backdrop-blur-md border-l-2 shadow-lg overflow-hidden",
        team === "ct" ? "border-l-ct" : "border-l-tt",
      )}
    >
      {/* Header: team name + score */}
      <div className={cn("px-3 py-2 flex items-center justify-between border-b border-border/30", accent)}>
        <span className="text-xs font-bold uppercase tracking-wider truncate">
          {teamName}
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono-rs text-muted-foreground">
            {alive} / {players.length}
          </span>
          {score !== undefined && (
            <span className="font-display font-bold text-base tabular-nums">
              {score}
            </span>
          )}
        </div>
      </div>

      {/* Player rows */}
      <div className="divide-y divide-border-subtle/40">
        {players.map((p) => (
          <LoadoutRow
            key={p.steamId}
            player={p}
            stats={playerLookup.get(p.steamId)}
            loadout={loadouts?.[p.steamId]}
            focused={focusedSteamId === p.steamId}
            onHover={onHover}
          />
        ))}
      </div>
    </div>
  );
}

function LoadoutRow({
  player,
  stats,
  loadout,
  focused,
  onHover,
}: {
  player: FramePlayer;
  stats: PlayerStats | undefined;
  loadout: PlayerLoadout | undefined;
  focused: boolean;
  onHover?: (steamId: string | null) => void;
}) {
  const hp = player.hp ?? (player.alive ? 100 : 0);
  const dead = !player.alive;
  const team = player.team;
  const armor = loadout?.armor ?? 0;
  const helmet = loadout?.helmet ?? false;
  const kit = loadout?.kit ?? false;
  const money = loadout?.money;
  const weapon = loadout?.weapon;
  const displayName = player.name || stats?.name || "—";

  return (
    <div
      onMouseEnter={() => onHover?.(player.steamId)}
      onMouseLeave={() => onHover?.(null)}
      className={cn(
        "px-3 py-2 transition-colors cursor-default",
        dead && "opacity-40",
        focused && "bg-surface-elevated",
      )}
    >
      {/* Row 1: name + money */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "text-[12px] font-bold uppercase tracking-wide truncate flex-1",
            dead && "line-through",
          )}
          title={displayName}
        >
          {displayName}
        </span>
        {money !== undefined && (
          <span
            className={cn(
              "text-[11px] font-mono-rs tabular-nums shrink-0",
              money <= 800 ? "text-loss" : money >= 3500 ? "text-win" : "text-foreground/80",
            )}
          >
            ${money}
          </span>
        )}
      </div>

      {/* Row 2: HP bar */}
      <div className="mt-1.5 flex items-center gap-2">
        <div className="flex-1 h-1 bg-surface-elevated rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              hp > 60 ? (team === "ct" ? "bg-ct" : "bg-tt") : hp > 25 ? "bg-primary" : "bg-loss",
            )}
            style={{ width: `${Math.max(0, Math.min(100, hp))}%` }}
          />
        </div>
        <span className="text-[10px] font-mono-rs text-muted-foreground tabular-nums w-6 text-right">
          {hp}
        </span>
      </div>

      {/* Row 3: weapon icon + equipment strip */}
      <div className="mt-1.5 flex items-center gap-2">
        <WeaponBadge weapon={weapon} />
        <div className="flex items-center gap-1 ml-auto">
          <ArmorIcon hasArmor={armor > 0} hasHelmet={helmet} />
          <KitIcon hasKit={kit} />
          <GrenadeSlots loadout={loadout} />
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Equipment widgets
// =========================================================================

function WeaponBadge({ weapon }: { weapon: string | undefined }) {
  if (!weapon) {
    return (
      <span className="text-[9px] font-mono-rs text-muted-foreground/60 italic">
        no weapon
      </span>
    );
  }
  const cls = classifyWeapon(weapon);
  const palette: Record<string, { bg: string; fg: string }> = {
    rifle:   { bg: "hsl(213 100% 65% / 0.15)", fg: "hsl(213 100% 75%)" },
    sniper:  { bg: "hsl(280 80% 65% / 0.15)",  fg: "hsl(280 80% 75%)" },
    smg:     { bg: "hsl(160 70% 50% / 0.15)",  fg: "hsl(160 70% 60%)" },
    pistol:  { bg: "hsl(40 90% 55% / 0.15)",   fg: "hsl(40 90% 65%)" },
    shotgun: { bg: "hsl(15 90% 55% / 0.15)",   fg: "hsl(15 90% 65%)" },
    knife:   { bg: "hsl(220 8% 50% / 0.15)",   fg: "hsl(220 8% 75%)" },
    bomb:    { bg: "hsl(0 80% 55% / 0.15)",    fg: "hsl(0 80% 65%)" },
    other:   { bg: "hsl(220 8% 30% / 0.20)",   fg: "hsl(220 8% 75%)" },
  };
  const p = palette[cls] ?? palette.other;
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider font-mono-rs"
      style={{ background: p.bg, color: p.fg }}
      title={weapon}
    >
      {prettyWeapon(weapon)}
    </span>
  );
}

function classifyWeapon(weapon: string): string {
  const w = weapon.toLowerCase().replace(/^weapon_/, "");
  if (["ak47", "m4a1", "m4a1_silencer", "famas", "galilar", "sg556", "aug"].includes(w)) return "rifle";
  if (["awp", "ssg08", "scar20", "g3sg1"].includes(w)) return "sniper";
  if (["mac10", "mp9", "mp7", "mp5sd", "ump45", "p90", "bizon"].includes(w)) return "smg";
  if (["nova", "mag7", "sawedoff", "xm1014"].includes(w)) return "shotgun";
  if (["glock", "usp_silencer", "p2000", "p250", "fiveseven", "tec9", "cz75a", "deagle", "elite", "revolver"].includes(w)) return "pistol";
  if (w.includes("knife") || w === "bayonet") return "knife";
  if (w.includes("bomb") || w === "c4") return "bomb";
  return "other";
}

function prettyWeapon(weapon: string): string {
  const w = weapon.replace(/^weapon_/, "");
  const compact: Record<string, string> = {
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
    famas: "FAM",
    galilar: "GAL",
    sg556: "SG",
    aug: "AUG",
    mac10: "MAC",
    mp9: "MP9",
    mp7: "MP7",
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
  if (compact[w]) return compact[w];
  if (w.includes("knife") || w === "bayonet") return "KNF";
  return w.slice(0, 4).toUpperCase();
}

function ArmorIcon({ hasArmor, hasHelmet }: { hasArmor: boolean; hasHelmet: boolean }) {
  if (!hasArmor) {
    return <span className="text-[10px] text-muted-foreground/30">·</span>;
  }
  // Vest (has armor only) vs vest+helmet (has helmet)
  return (
    <span
      title={hasHelmet ? "Vest + Helmet" : "Vest only"}
      className="inline-flex items-center justify-center w-3.5 h-3.5"
    >
      <svg viewBox="0 0 12 12" width="12" height="12">
        {hasHelmet && (
          <path
            d="M3 2 Q6 0 9 2 L9 4 L3 4 Z"
            fill="hsl(213 100% 65%)"
            opacity="0.85"
          />
        )}
        <path
          d="M3 4 L9 4 L9 9 Q6 11 3 9 Z"
          fill={hasHelmet ? "hsl(213 100% 65%)" : "hsl(220 8% 75%)"}
          opacity="0.85"
        />
      </svg>
    </span>
  );
}

function KitIcon({ hasKit }: { hasKit: boolean }) {
  return (
    <span
      title={hasKit ? "Defuse kit" : "No kit"}
      className="inline-flex items-center justify-center w-3.5 h-3.5"
    >
      <Bomb
        size={10}
        className={hasKit ? "text-win" : "text-muted-foreground/20"}
      />
    </span>
  );
}

function GrenadeSlots({ loadout }: { loadout: PlayerLoadout | undefined }) {
  // The stub doesn't track per-grenade counts; render 4 slots and dim them
  // unless the player has a primary weapon (rough proxy that they bought
  // utility along with it). When real grenade counts ship, this maps 1:1.
  const hasUtility = !!loadout?.weapon && !["glock", "usp_silencer", "p2000", "deagle", "knife"].some((k) => (loadout.weapon || "").includes(k));
  const slots: { color: string; filled: boolean; title: string }[] = [
    { color: "hsl(220 8% 75%)", filled: hasUtility, title: "Smoke" },
    { color: "hsl(50 100% 65%)", filled: hasUtility, title: "Flashbang" },
    { color: "hsl(15 90% 55%)",  filled: hasUtility, title: "HE" },
    { color: "hsl(20 95% 60%)",  filled: hasUtility, title: "Molotov" },
  ];
  return (
    <div className="flex items-center gap-0.5">
      {slots.map((s, i) => (
        <span
          key={i}
          title={s.title}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: s.filled ? s.color : "transparent",
            border: `1px solid ${s.filled ? s.color : "hsl(var(--border))"}`,
            opacity: s.filled ? 1 : 0.4,
          }}
        />
      ))}
    </div>
  );
}
