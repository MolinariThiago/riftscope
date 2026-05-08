"use client";

import { useMemo } from "react";

import type {
  GrenadeSubtype,
  PlayerStats,
  TimelineEvent,
  TimelineFrame,
} from "@/types/demo";

interface MapCanvasProps {
  mapName: string | null;
  frame: TimelineFrame | null;
  pastEvents: TimelineEvent[];
  currentTime: number;
  /** Highlights a specific player (e.g. when hovering kill feed) */
  focusedSteamId?: string | null;
  /** Resolve steamId -> PlayerStats for tooltips and kill labels */
  playerLookup?: Map<string, PlayerStats>;
}

/**
 * 2D round playback surface.
 *
 * Coordinate system: world coords are roughly in [-2000, 2000]; we project
 * them onto a 1000x1000 SVG viewbox. The `mapName` is used to render a
 * stylized backdrop with sites and labels — no real CS2 radar overlay yet
 * (that ships with Phase 3 along with the demoparser2 swap).
 */
export function MapCanvas({
  mapName,
  frame,
  pastEvents,
  currentTime,
  focusedSteamId,
  playerLookup,
}: MapCanvasProps) {
  const VB = 1000;

  // World [-2000, 2000] -> [0, 1000]
  const project = (x: number, y: number) => ({
    cx: ((x + 2000) / 4000) * VB,
    // Y inverted so positive-y is up like a tactical radar
    cy: VB - ((y + 2000) / 4000) * VB,
  });

  // Active grenades (smokes/molotovs that still cover ground)
  const activeGrenades = useMemo(() => {
    return pastEvents
      .filter(
        (e) =>
          e.type === "grenade_thrown" &&
          (e.subtype === "smoke" || e.subtype === "molotov") &&
          e.expiresAt !== undefined &&
          e.expiresAt > currentTime,
      );
  }, [pastEvents, currentTime]);

  // Kill markers (skull icons that fade after a few seconds)
  const recentKills = useMemo(() => {
    const FADE = 6;
    return pastEvents
      .filter((e) => e.type === "kill" && currentTime - e.t < FADE)
      .map((e) => ({ ...e, alpha: 1 - (currentTime - e.t) / FADE }));
  }, [pastEvents, currentTime]);

  // Bomb planted marker (sticky once planted, until end)
  const bombMarker = useMemo(() => {
    let planted: TimelineEvent | null = null;
    for (const e of pastEvents) {
      if (e.type === "bomb_planted") planted = e;
      if (e.type === "bomb_defused" || e.type === "bomb_exploded") {
        // Once defused/exploded, stop showing the planted marker
        return null;
      }
    }
    return planted;
  }, [pastEvents]);

  return (
    <div className="relative w-full max-w-[840px] mx-auto aspect-square">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        className="w-full h-full rounded-xl bg-surface-elevated border border-border"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="grid" width={VB / 16} height={VB / 16} patternUnits="userSpaceOnUse">
            <path
              d={`M ${VB / 16} 0 L 0 0 0 ${VB / 16}`}
              fill="none"
              stroke="hsl(220 14% 16%)"
              strokeWidth="1"
            />
          </pattern>
          <radialGradient id="smoke-grad">
            <stop offset="0%" stopColor="hsl(220 8% 75%)" stopOpacity="0.55" />
            <stop offset="70%" stopColor="hsl(220 8% 60%)" stopOpacity="0.35" />
            <stop offset="100%" stopColor="hsl(220 8% 50%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="molotov-grad">
            <stop offset="0%" stopColor="hsl(20 90% 55%)" stopOpacity="0.6" />
            <stop offset="100%" stopColor="hsl(15 80% 35%)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Background grid */}
        <rect width={VB} height={VB} fill="hsl(220 16% 9%)" />
        <rect width={VB} height={VB} fill="url(#grid)" />

        {/* Stylized A / B sites */}
        <SiteLabel x={project(1200, -800).cx} y={project(1200, -800).cy} label="A" />
        <SiteLabel x={project(-1100, 1300).cx} y={project(-1100, 1300).cy} label="B" />

        {/* Map name watermark */}
        {mapName && (
          <text
            x={VB / 2}
            y={28}
            textAnchor="middle"
            fontSize="14"
            fill="hsl(220 8% 50%)"
            fontFamily="var(--font-mono-rs, monospace)"
            letterSpacing="2"
          >
            {mapName.toUpperCase()}
          </text>
        )}

        {/* Active grenades behind players */}
        {activeGrenades.map((g, i) => {
          const { cx, cy } = project(g.x ?? 0, g.y ?? 0);
          return <GrenadeArea key={`gren-${i}`} cx={cx} cy={cy} subtype={g.subtype!} />;
        })}

        {/* Bomb planted */}
        {bombMarker && (
          <BombMarker
            cx={project(bombMarker.x ?? 0, bombMarker.y ?? 0).cx}
            cy={project(bombMarker.x ?? 0, bombMarker.y ?? 0).cy}
            site={bombMarker.site!}
          />
        )}

        {/* Kill markers (skulls fading out) */}
        {recentKills.map((k, i) => {
          const { cx, cy } = project(k.x ?? 0, k.y ?? 0);
          const killer = k.killer ? playerLookup?.get(k.killer) : undefined;
          const victim = k.victim ? playerLookup?.get(k.victim) : undefined;
          return (
            <KillMarker
              key={`kill-${i}`}
              cx={cx}
              cy={cy}
              alpha={k.alpha}
              label={killer && victim ? `${killer.name} → ${victim.name}` : ""}
            />
          );
        })}

        {/* Players */}
        {frame?.players.map((p) => {
          const { cx, cy } = project(p.x, p.y);
          const player = playerLookup?.get(p.steamId);
          return (
            <PlayerSprite
              key={p.steamId}
              cx={cx}
              cy={cy}
              team={p.team}
              alive={p.alive}
              name={p.name}
              focused={focusedSteamId === p.steamId}
              hp={player ? 100 : undefined}
            />
          );
        })}
      </svg>
    </div>
  );
}

// =========================================================================
// Sub-components
// =========================================================================

function SiteLabel({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r={70} fill="hsl(213 100% 65% / 0.07)" stroke="hsl(213 100% 65% / 0.4)" strokeDasharray="4 4" />
      <text
        x={x}
        y={y + 8}
        textAnchor="middle"
        fontSize="36"
        fontWeight="700"
        fill="hsl(213 100% 65% / 0.45)"
        fontFamily="var(--font-display, system-ui)"
      >
        {label}
      </text>
    </g>
  );
}

function PlayerSprite({
  cx,
  cy,
  team,
  alive,
  name,
  focused,
  hp,
}: {
  cx: number;
  cy: number;
  team: "ct" | "tt";
  alive: boolean;
  name: string;
  focused: boolean;
  hp?: number;
}) {
  const teamColor = team === "ct" ? "hsl(213 100% 65%)" : "hsl(33 100% 64%)";
  const r = focused ? 14 : 11;

  if (!alive) {
    // Dead body marker
    return (
      <g opacity={0.55}>
        <line x1={cx - 8} y1={cy - 8} x2={cx + 8} y2={cy + 8} stroke={teamColor} strokeWidth="2.5" />
        <line x1={cx - 8} y1={cy + 8} x2={cx + 8} y2={cy - 8} stroke={teamColor} strokeWidth="2.5" />
      </g>
    );
  }

  return (
    <g>
      {focused && (
        <circle cx={cx} cy={cy} r={r + 8} fill="none" stroke={teamColor} strokeOpacity={0.5} strokeWidth="2" />
      )}
      <circle cx={cx} cy={cy} r={r} fill={teamColor} stroke="hsl(220 16% 9%)" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={r * 0.4} fill="hsl(220 16% 9%)" />
      <text
        x={cx}
        y={cy - r - 6}
        textAnchor="middle"
        fontSize="11"
        fill="hsl(0 0% 95%)"
        fontWeight="600"
        style={{ pointerEvents: "none" }}
      >
        {name}
      </text>
    </g>
  );
}

function KillMarker({ cx, cy, alpha, label }: { cx: number; cy: number; alpha: number; label: string }) {
  return (
    <g opacity={alpha}>
      <circle cx={cx} cy={cy} r="22" fill="hsl(350 80% 55% / 0.15)" />
      <text x={cx} y={cy + 6} textAnchor="middle" fontSize="20" fill="hsl(350 80% 65%)">
        ☠
      </text>
      {label && (
        <text x={cx} y={cy + 32} textAnchor="middle" fontSize="10" fill="hsl(0 0% 80%)">
          {label}
        </text>
      )}
    </g>
  );
}

function GrenadeArea({ cx, cy, subtype }: { cx: number; cy: number; subtype: GrenadeSubtype }) {
  if (subtype === "smoke") {
    return <circle cx={cx} cy={cy} r="60" fill="url(#smoke-grad)" />;
  }
  if (subtype === "molotov") {
    return <circle cx={cx} cy={cy} r="40" fill="url(#molotov-grad)" />;
  }
  return null;
}

function BombMarker({ cx, cy, site }: { cx: number; cy: number; site: string }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r="14" fill="hsl(0 80% 55% / 0.25)" stroke="hsl(0 80% 55%)" strokeWidth="2">
        <animate attributeName="r" values="14;20;14" dur="1.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="1;0.4;1" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <text x={cx} y={cy - 22} textAnchor="middle" fontSize="11" fill="hsl(0 80% 70%)" fontWeight="700">
        BOMB · {site}
      </text>
    </g>
  );
}
