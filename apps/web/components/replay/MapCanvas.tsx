"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import type {
  GrenadeSubtype,
  MapMetadata,
  PlayerStats,
  TimelineEvent,
  TimelineFrame,
} from "@/types/demo";

export interface ReplayLayers {
  callouts: boolean;
  sites: boolean;
  trajectories: boolean;
  heatmap: boolean;
  grenades: boolean;
  killMarkers: boolean;
  viewArrows: boolean;
  bomb: boolean;
  /** Show the SimpleRadar / Valve radar overlay as the canvas backdrop. */
  radarOverlay: boolean;
  /** Show the procedural grid behind everything. */
  grid: boolean;
}

export const DEFAULT_LAYERS: ReplayLayers = {
  callouts: true,
  sites: true,
  trajectories: false,
  heatmap: false,
  grenades: true,
  killMarkers: true,
  viewArrows: true,
  bomb: true,
  radarOverlay: true,
  grid: false,
};

interface MapCanvasProps {
  mapName: string | null;
  /** Per-map metadata (radar projection + sites + callouts). */
  mapMeta?: MapMetadata | null;
  frame: TimelineFrame | null;
  pastEvents: TimelineEvent[];
  currentTime: number;
  /** All frames of the round (used by the trajectories + heatmap layers). */
  allFrames?: TimelineFrame[];
  focusedSteamId?: string | null;
  playerLookup?: Map<string, PlayerStats>;
  layers?: ReplayLayers;
  /** When true, the canvas fills its parent (no max width / no fixed aspect). */
  fullBleed?: boolean;
}

const FALLBACK_RADAR_SIZE = 1024;
const FALLBACK_POS_X = -2000;
const FALLBACK_POS_Y = 2000;
const FALLBACK_SCALE = 4.0;

/**
 * 2D round playback surface — Phase 3A.1.
 *
 * Uses the per-map ``pos_x / pos_y / scale`` constants (extracted from
 * Valve's ``overviews/<map>.txt``) to project world coordinates onto the
 * SimpleRadar overlay. The transform matches what professional viewers
 * (Skybox, CS2.CAM) use, so any world coordinate from a real demo lands
 * in the correct radar pixel.
 *
 * For two-level maps (Nuke, Vertigo) a level toggle lets the user pick
 * which floor the radar shows. Once demoparser2 surfaces per-frame Z
 * elevation we'll auto-switch based on the focused player.
 */
export function MapCanvas({
  mapName,
  mapMeta,
  frame,
  pastEvents,
  currentTime,
  allFrames,
  focusedSteamId,
  playerLookup,
  layers = DEFAULT_LAYERS,
  fullBleed = false,
}: MapCanvasProps) {
  const radarSize = mapMeta?.radarSize ?? FALLBACK_RADAR_SIZE;
  const posX = mapMeta?.posX ?? FALLBACK_POS_X;
  const posY = mapMeta?.posY ?? FALLBACK_POS_Y;
  const scale = mapMeta?.scale ?? FALLBACK_SCALE;

  // Two-level handling — only Nuke / Vertigo for now.
  const hasLowerLevel = !!mapMeta?.radarUrlLower;
  const [showLower, setShowLower] = useState(false);
  const radarUrl = showLower && mapMeta?.radarUrlLower
    ? mapMeta.radarUrlLower
    : mapMeta?.radarUrl ?? null;

  // ----- Zoom / pan state (radar-pixel space) ---------------------------
  // viewBox is dynamic: zoom 1 = full radar; zoom > 1 reveals less area.
  // pan is in radar pixel offsets (centred on container midpoint).
  // In fullBleed mode we start slightly zoomed-in (1.18) so the empty
  // border of the radar PNG (letterbox around the playable area) gets
  // cropped — the map then visually fills the available container.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const initialZoom = fullBleed ? 1.18 : 1;
  const [zoom, setZoom] = useState(initialZoom);
  const initialPan = useMemo(() => {
    if (!fullBleed) return { x: 0, y: 0 };
    const view = radarSize / initialZoom;
    return { x: (radarSize - view) / 2, y: (radarSize - view) / 2 };
  }, [fullBleed, radarSize, initialZoom]);
  const [pan, setPan] = useState<{ x: number; y: number }>(initialPan);
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const minZoom = 1;
  const maxZoom = 6;

  const setZoomAt = useCallback(
    (newZoom: number, focusFrac?: { fx: number; fy: number }) => {
      const z = Math.max(minZoom, Math.min(maxZoom, newZoom));
      setZoom((prev) => {
        if (focusFrac && z !== prev && prev > 0) {
          // Zoom centred on the cursor: keep the cursor's world point fixed.
          const view = radarSize / prev;
          const cursorX = pan.x + focusFrac.fx * view;
          const cursorY = pan.y + focusFrac.fy * view;
          const newView = radarSize / z;
          const newPanX = cursorX - focusFrac.fx * newView;
          const newPanY = cursorY - focusFrac.fy * newView;
          setPan({
            x: clampPan(newPanX, radarSize, newView),
            y: clampPan(newPanY, radarSize, newView),
          });
        } else if (z === minZoom) {
          setPan({ x: 0, y: 0 });
        }
        return z;
      });
    },
    [pan, radarSize],
  );

  const onWheel = useCallback(
    (e: React.WheelEvent<HTMLDivElement>) => {
      // Avoid trapping the page scroll if there's no zooming intent.
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
      const rect = containerRef.current?.getBoundingClientRect();
      const fx = rect ? (e.clientX - rect.left) / rect.width : 0.5;
      const fy = rect ? (e.clientY - rect.top) / rect.height : 0.5;
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      setZoomAt(zoom * factor, { fx, fy });
    },
    [zoom, setZoomAt],
  );

  // Block native scroll when wheeling over the map (passive listeners would
  // otherwise scroll the page). Attach via DOM since React's wheel handler
  // is registered as passive in modern React.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    const handler = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) < 1) return;
      e.preventDefault();
    };
    node.addEventListener("wheel", handler, { passive: false });
    return () => node.removeEventListener("wheel", handler);
  }, []);

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (zoom <= 1) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
  };
  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!dragging || !dragStart.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const dx = (e.clientX - dragStart.current.x) / rect.width * (radarSize / zoom);
    const dy = (e.clientY - dragStart.current.y) / rect.height * (radarSize / zoom);
    const view = radarSize / zoom;
    setPan({
      x: clampPan(dragStart.current.px - dx, radarSize, view),
      y: clampPan(dragStart.current.py - dy, radarSize, view),
    });
  };
  const onMouseUp = () => {
    setDragging(false);
    dragStart.current = null;
  };

  const view = radarSize / zoom;
  const viewBox = `${pan.x} ${pan.y} ${view} ${view}`;

  // World -> radar pixel.
  // radarPxX = (worldX - posX) / scale
  // radarPxY = (posY - worldY) / scale   (Y inverted: north = top)
  const project = (x: number, y: number) => ({
    cx: (x - posX) / scale,
    cy: (posY - y) / scale,
  });
  const projectScalar = (units: number) => units / scale;

  const sitePoints = useMemo(() => {
    const a = mapMeta ? project(mapMeta.siteA[0], mapMeta.siteA[1]) : project(1100, -800);
    const b = mapMeta ? project(mapMeta.siteB[0], mapMeta.siteB[1]) : project(-1100, 1300);
    return { a, b };
  }, [mapMeta, posX, posY, scale]);

  // Active grenades (smokes / molotovs that still cover ground)
  const activeGrenades = useMemo(
    () =>
      pastEvents.filter(
        (e) =>
          e.type === "grenade_thrown" &&
          (e.subtype === "smoke" || e.subtype === "molotov") &&
          e.expiresAt !== undefined &&
          e.expiresAt > currentTime,
      ),
    [pastEvents, currentTime],
  );

  // Dropped weapons on the floor — show from death until picked up or round ends.
  // Each pickup can "consume" at most one drop (closest in time) so spawning
  // pistols / multiple drops of the same weapon are tracked correctly.
  const droppedWeapons = useMemo(() => {
    const drops = pastEvents
      .filter((e) => e.type === "weapon_drop" && e.t <= currentTime)
      .map((e, i) => ({ ...e, _idx: i, _consumed: false }));
    const pickups = pastEvents.filter(
      (e) => e.type === "weapon_pickup" && e.t <= currentTime,
    );
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const weaponMatches = (dropW: string, pickW: string) => {
      const d = norm(dropW);
      const p = norm(pickW);
      if (!d || !p) return false;
      // Glock-18 ↔ glock, USP-S ↔ usp_silencer, AK-47 ↔ ak47, etc.
      if (d === p) return true;
      if (d.includes(p) || p.includes(d)) return true;
      // Specific aliases
      const aliases: Record<string, string[]> = {
        glock18: ["glock"],
        usps: ["uspsilencer", "usp"],
        m4a4: ["m4a1"],
        m4a1s: ["m4a1silencer", "m4a1"],
        deserteagle: ["deagle"],
      };
      return (aliases[d] ?? []).includes(p) || (aliases[p] ?? []).includes(d);
    };
    // Consume drops greedily by pickups (sorted by time)
    const sortedPickups = [...pickups].sort((a, b) => a.t - b.t);
    for (const pu of sortedPickups) {
      const match = drops.find(
        (d) => !d._consumed && d.t <= pu.t && weaponMatches(d.weapon ?? "", pu.weapon ?? ""),
      );
      if (match) match._consumed = true;
    }
    return drops.filter((d) => !d._consumed);
  }, [pastEvents, currentTime]);

  // Recent flash / he pops — show a brief ring at impact
  const recentPops = useMemo(() => {
    const FADE = 1.4;
    return pastEvents
      .filter(
        (e) =>
          e.type === "grenade_thrown" &&
          (e.subtype === "flash" || e.subtype === "he") &&
          currentTime - e.t < FADE,
      )
      .map((e) => ({ ...e, alpha: 1 - (currentTime - e.t) / FADE }));
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
        return null;
      }
    }
    return planted;
  }, [pastEvents]);

  // Trajectories — per-player polyline up to the current frame.
  const trajectories = useMemo(() => {
    if (!layers.trajectories || !allFrames || allFrames.length === 0) return [];
    const totalT = allFrames[allFrames.length - 1].t || 1;
    const fps = allFrames.length / Math.max(1, totalT);
    const cutoff = Math.min(allFrames.length - 1, Math.floor(currentTime * fps));
    const slice = allFrames.slice(0, cutoff + 1);
    if (slice.length < 2) return [];

    const byPlayer = new Map<string, { team: "ct" | "tt"; points: string[] }>();
    for (const f of slice) {
      for (const p of f.players) {
        if (!p.alive) continue;
        const { cx, cy } = project(p.x, p.y);
        let entry = byPlayer.get(p.steamId);
        if (!entry) {
          entry = { team: p.team, points: [] };
          byPlayer.set(p.steamId, entry);
        }
        entry.points.push(`${cx.toFixed(1)},${cy.toFixed(1)}`);
      }
    }
    return Array.from(byPlayer.entries()).map(([sid, v]) => ({
      sid,
      team: v.team,
      d: v.points.join(" "),
    }));
  }, [layers.trajectories, allFrames, currentTime, posX, posY, scale]);

  // Heatmap — accumulated density of player presence, sampled at low rate.
  const heatBlobs = useMemo(() => {
    if (!layers.heatmap || !allFrames || allFrames.length === 0) return [];
    const STEP = Math.max(1, Math.floor(allFrames.length / 60));
    const points: { cx: number; cy: number; team: "ct" | "tt" }[] = [];
    for (let i = 0; i < allFrames.length; i += STEP) {
      const f = allFrames[i];
      for (const p of f.players) {
        if (!p.alive) continue;
        const { cx, cy } = project(p.x, p.y);
        points.push({ cx, cy, team: p.team });
      }
    }
    return points;
  }, [layers.heatmap, allFrames, posX, posY, scale]);

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative select-none",
        fullBleed
          ? "w-full h-full"
          : "w-full max-w-[840px] mx-auto aspect-square",
        zoom > 1 ? (dragging ? "cursor-grabbing" : "cursor-grab") : "cursor-default",
      )}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <svg
        viewBox={viewBox}
        className={cn(
          "w-full h-full",
          fullBleed
            ? "bg-background"
            : "rounded-xl bg-surface-elevated border border-border shadow-xl",
        )}
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <pattern id="grid" width={radarSize / 32} height={radarSize / 32} patternUnits="userSpaceOnUse">
            <path
              d={`M ${radarSize / 32} 0 L 0 0 0 ${radarSize / 32}`}
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
          <radialGradient id="heat-ct">
            <stop offset="0%" stopColor="hsl(213 100% 65%)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="hsl(213 100% 65%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="heat-tt">
            <stop offset="0%" stopColor="hsl(33 100% 64%)" stopOpacity="0.16" />
            <stop offset="100%" stopColor="hsl(33 100% 64%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="spawn-ct">
            <stop offset="0%" stopColor="hsl(213 100% 65%)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="hsl(213 100% 65%)" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="spawn-tt">
            <stop offset="0%" stopColor="hsl(33 100% 64%)" stopOpacity="0.10" />
            <stop offset="100%" stopColor="hsl(33 100% 64%)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Base background */}
        <rect width={radarSize} height={radarSize} fill="hsl(220 16% 9%)" />

        {/* Radar overlay (SimpleRadar / Valve). When the asset is missing the
            <image> just renders nothing — no broken-icon.

            CSS filter darkens the source and pulls saturation down so the
            radar reads like a clean tactical overview (white-ish walls on a
            dark backdrop) regardless of which asset pack is loaded. */}
        {layers.radarOverlay && radarUrl && (
          <image
            href={radarUrl}
            xlinkHref={radarUrl}
            x={0}
            y={0}
            width={radarSize}
            height={radarSize}
            preserveAspectRatio="xMidYMid meet"
            opacity={1}
            style={{ filter: "brightness(0.45) contrast(1.35) saturate(0.55)" }}
          />
        )}

        {layers.grid && <rect width={radarSize} height={radarSize} fill="url(#grid)" />}

        {/* Spawn zones (subtle) */}
        {mapMeta && (
          <>
            <SpawnZone
              c={project(mapMeta.spawnCt[0], mapMeta.spawnCt[1])}
              r={projectScalar(420)}
              team="ct"
            />
            <SpawnZone
              c={project(mapMeta.spawnTt[0], mapMeta.spawnTt[1])}
              r={projectScalar(420)}
              team="tt"
            />
          </>
        )}

        {/* Heatmap layer */}
        {layers.heatmap &&
          heatBlobs.map((b, i) => (
            <circle
              key={`heat-${i}`}
              cx={b.cx}
              cy={b.cy}
              r={projectScalar(220)}
              fill={b.team === "ct" ? "url(#heat-ct)" : "url(#heat-tt)"}
            />
          ))}

        {/* Sites */}
        {layers.sites && (
          <>
            <SiteLabel x={sitePoints.a.cx} y={sitePoints.a.cy} label="A" />
            <SiteLabel x={sitePoints.b.cx} y={sitePoints.b.cy} label="B" />
          </>
        )}

        {/* Callouts */}
        {layers.callouts &&
          mapMeta?.callouts
            .filter((c) => !/^[ab] site|spawn$/i.test(c.name))
            .map((c) => {
              const { cx, cy } = project(c.x, c.y);
              return (
                <CalloutLabel
                  key={c.name}
                  cx={cx}
                  cy={cy}
                  r={projectScalar(c.radius)}
                  label={c.name}
                />
              );
            })}

        {/* Trajectories */}
        {layers.trajectories &&
          trajectories.map((t) => (
            <polyline
              key={`traj-${t.sid}`}
              points={t.d}
              fill="none"
              stroke={
                t.team === "ct"
                  ? "hsl(213 100% 65% / 0.5)"
                  : "hsl(33 100% 64% / 0.5)"
              }
              strokeWidth={focusedSteamId === t.sid ? 3 : 1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

        {/* Grenade trajectory curves — drawn UNDER the smoke/molotov areas so
            the colored cloud sits on the landing point. cs2.cam style: a thin
            arc from the thrower's position to where the projectile detonated. */}
        {layers.grenades &&
          pastEvents
            .filter((e) => {
              if (e.type !== "grenade_thrown") return false;
              if (e.throwerX === undefined || e.throwerY === undefined) return false;
              // Show tracers for ~3s after the throw so the line fades out.
              return currentTime - e.t < 3.5;
            })
            .map((g, i) => {
              const a = project(g.throwerX!, g.throwerY!);
              const b = project(g.x ?? 0, g.y ?? 0);
              const subtype = g.subtype as GrenadeSubtype;
              const color =
                subtype === "smoke"
                  ? "hsl(220 8% 80%)"
                  : subtype === "flash"
                    ? "hsl(50 100% 70%)"
                    : subtype === "molotov"
                      ? "hsl(20 95% 60%)"
                      : "hsl(15 90% 55%)";
              const dx = b.cx - a.cx;
              const dy = b.cy - a.cy;
              const dist = Math.hypot(dx, dy) || 1;
              // High arc — grenades fly up — so bend more than kill lines.
              const bend = Math.min(160, dist * 0.32);
              const mx = (a.cx + b.cx) / 2 + (-dy / dist) * bend;
              const my = (a.cy + b.cy) / 2 + (dx / dist) * bend;
              const age = Math.max(0, currentTime - g.t);
              const alpha = Math.max(0, 1 - age / 3.5);
              return (
                <g
                  key={`tracer-${i}`}
                  opacity={alpha}
                  style={{ pointerEvents: "none" }}
                >
                  <path
                    d={`M ${a.cx} ${a.cy} Q ${mx} ${my} ${b.cx} ${b.cy}`}
                    fill="none"
                    stroke={color}
                    strokeWidth={1.4}
                    strokeOpacity={0.7}
                    strokeDasharray="3 3"
                    strokeLinecap="round"
                  />
                  <circle cx={a.cx} cy={a.cy} r={2.5} fill={color} opacity={0.8} />
                </g>
              );
            })}

        {/* Active grenades behind players */}
        {layers.grenades &&
          activeGrenades.map((g, i) => {
            const { cx, cy } = project(g.x ?? 0, g.y ?? 0);
            const radius = projectScalar(g.radius ?? (g.subtype === "smoke" ? 220 : 160));
            return (
              <GrenadeArea
                key={`gren-${i}`}
                cx={cx}
                cy={cy}
                r={radius}
                subtype={g.subtype!}
              />
            );
          })}

        {/* Recent flash / he pops */}
        {layers.grenades &&
          recentPops.map((p, i) => {
            const { cx, cy } = project(p.x ?? 0, p.y ?? 0);
            const radius = projectScalar(p.radius ?? 70);
            return (
              <PopRing
                key={`pop-${i}`}
                cx={cx}
                cy={cy}
                r={radius}
                alpha={p.alpha}
                subtype={p.subtype!}
              />
            );
          })}

        {/* Bomb planted */}
        {layers.bomb && bombMarker && (
          <BombMarker
            cx={project(bombMarker.x ?? 0, bombMarker.y ?? 0).cx}
            cy={project(bombMarker.x ?? 0, bombMarker.y ?? 0).cy}
            site={bombMarker.site!}
          />
        )}

        {/* Kill trajectory lines — thin red curve killer → victim,
            cs2.cam style. Drawn UNDER the skull marker so the marker
            sits on top of the line endpoint. */}
        {layers.killMarkers &&
          recentKills.map((k, i) => {
            if (k.killerX === undefined || k.killerY === undefined) return null;
            const a = project(k.killerX, k.killerY);
            const b = project(k.x ?? 0, k.y ?? 0);
            const killer = k.killer ? playerLookup?.get(k.killer) : undefined;
            const color =
              killer?.team === "ct"
                ? "hsl(213 100% 65%)"
                : killer?.team === "tt"
                  ? "hsl(33 100% 64%)"
                  : "hsl(350 80% 60%)";
            // Curved control point — perpendicular to the kill line, scaled
            // by distance, so longer kills bend more.
            const dx = b.cx - a.cx;
            const dy = b.cy - a.cy;
            const dist = Math.hypot(dx, dy) || 1;
            const bend = Math.min(120, dist * 0.18);
            const mx = (a.cx + b.cx) / 2 + (-dy / dist) * bend;
            const my = (a.cy + b.cy) / 2 + (dx / dist) * bend;
            return (
              <g
                key={`kline-${i}`}
                opacity={Math.min(1, k.alpha + 0.2)}
                style={{ pointerEvents: "none" }}
              >
                <path
                  d={`M ${a.cx} ${a.cy} Q ${mx} ${my} ${b.cx} ${b.cy}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={1.6}
                  strokeOpacity={0.85}
                  strokeDasharray="4 3"
                  strokeLinecap="round"
                />
                {/* Killer-side dot (origin) */}
                <circle cx={a.cx} cy={a.cy} r={3} fill={color} opacity={0.85} />
              </g>
            );
          })}

        {/* Kill markers (skulls fading out) */}
        {layers.killMarkers &&
          recentKills.map((k, i) => {
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

        {/* Dropped weapons on the floor */}
        {droppedWeapons.map((d, i) => {
          const { cx, cy } = project(d.x ?? 0, d.y ?? 0);
          return (
            <DroppedWeapon
              key={`drop-${i}`}
              cx={cx}
              cy={cy}
              weapon={d.weapon ?? ""}
              isGrenade={!!d.isGrenade}
              size={Math.max(10, projectScalar(55))}
            />
          );
        })}

        {/* Players */}
        {frame?.players.map((p) => {
          const { cx, cy } = project(p.x, p.y);
          return (
            <PlayerSprite
              key={p.steamId}
              cx={cx}
              cy={cy}
              team={p.team}
              alive={p.alive}
              name={p.name}
              yaw={p.yaw}
              showArrow={layers.viewArrows}
              focused={focusedSteamId === p.steamId}
              spriteRadius={Math.max(8, projectScalar(60))}
            />
          );
        })}
      </svg>

      {/* Map header overlay (top-left) */}
      <div className="absolute top-3 left-3 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/80 backdrop-blur-md border border-border/60 pointer-events-none shadow-lg">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground">
          Map
        </span>
        <span className="text-xs font-bold tracking-wide">
          {mapMeta?.displayName ?? mapName ?? "—"}
        </span>
      </div>

      {/* Two-level toggle (Nuke / Vertigo) */}
      {hasLowerLevel && (
        <div className="absolute top-3 right-3 flex rounded-lg overflow-hidden border border-border/60 bg-background/80 backdrop-blur-md shadow-lg">
          <LevelButton
            active={!showLower}
            onClick={() => setShowLower(false)}
            label="Upper"
          />
          <LevelButton
            active={showLower}
            onClick={() => setShowLower(true)}
            label="Lower"
          />
        </div>
      )}

      {/* Zoom toolbar (bottom-right) */}
      <div className="absolute bottom-3 right-3 flex flex-col items-end gap-1.5">
        <div className="flex flex-col rounded-lg overflow-hidden border border-border/60 bg-background/80 backdrop-blur-md shadow-lg">
          <button
            onClick={() => setZoomAt(zoom * 1.4, { fx: 0.5, fy: 0.5 })}
            disabled={zoom >= maxZoom - 0.001}
            title="Zoom in"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
          </button>
          <div className="px-1.5 py-1 text-[10px] font-mono-rs text-center text-muted-foreground border-y border-border/40">
            {zoom.toFixed(1)}x
          </div>
          <button
            onClick={() => setZoomAt(zoom / 1.4, { fx: 0.5, fy: 0.5 })}
            disabled={zoom <= minZoom + 0.001}
            title="Zoom out"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
            disabled={zoom === 1}
            title="Reset zoom"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed border-t border-border/40"
          >
            <Maximize2 size={13} />
          </button>
        </div>
        <span className="text-[9px] font-mono-rs text-muted-foreground/70 px-1 hidden sm:inline">
          scroll · drag
        </span>
      </div>
    </div>
  );
}

function clampPan(p: number, radarSize: number, view: number): number {
  // Keep the visible window inside the radar bounds.
  return Math.max(0, Math.min(radarSize - view, p));
}

// =========================================================================
// Sub-components
// =========================================================================

function LevelButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-2.5 py-1 text-[11px] font-mono-rs transition-colors " +
        (active
          ? "bg-surface-elevated text-foreground"
          : "text-muted-foreground hover:text-foreground")
      }
    >
      {label}
    </button>
  );
}

function SpawnZone({
  c,
  r,
  team,
}: {
  c: { cx: number; cy: number };
  r: number;
  team: "ct" | "tt";
}) {
  return (
    <circle
      cx={c.cx}
      cy={c.cy}
      r={r}
      fill={team === "ct" ? "url(#spawn-ct)" : "url(#spawn-tt)"}
    />
  );
}

function SiteLabel({ x, y, label }: { x: number; y: number; label: string }) {
  const accent =
    label === "A" ? "hsl(213 100% 65%)" : "hsl(280 80% 70%)";
  return (
    <g>
      <circle
        cx={x}
        cy={y}
        r={36}
        fill={`${accent.replace(")", " / 0.07)")}`}
        stroke={`${accent.replace(")", " / 0.5)")}`}
        strokeDasharray="3 3"
        strokeWidth="1.5"
      />
      <text
        x={x}
        y={y + 7}
        textAnchor="middle"
        fontSize="22"
        fontWeight="700"
        fill={`${accent.replace(")", " / 0.75)")}`}
        fontFamily="var(--font-display, system-ui)"
      >
        {label}
      </text>
    </g>
  );
}

function CalloutLabel({
  cx,
  cy,
  r,
  label,
}: {
  cx: number;
  cy: number;
  r: number;
  label: string;
}) {
  return (
    <g pointerEvents="none">
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="hsl(220 8% 50% / 0.04)"
        stroke="hsl(220 8% 50% / 0.15)"
        strokeDasharray="2 4"
      />
      <text
        x={cx}
        y={cy}
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize="9"
        fill="hsl(220 8% 70%)"
        fontFamily="var(--font-mono-rs, monospace)"
        letterSpacing="0.5"
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
  yaw,
  showArrow,
  focused,
  spriteRadius,
}: {
  cx: number;
  cy: number;
  team: "ct" | "tt";
  alive: boolean;
  name: string;
  yaw?: number;
  showArrow: boolean;
  focused: boolean;
  spriteRadius: number;
}) {
  const teamColor = team === "ct" ? "hsl(213 100% 65%)" : "hsl(33 100% 64%)";
  const r = focused ? spriteRadius * 1.25 : spriteRadius;

  if (!alive) {
    const offset = r * 0.7;
    return (
      <g opacity={0.55}>
        <line x1={cx - offset} y1={cy - offset} x2={cx + offset} y2={cy + offset} stroke={teamColor} strokeWidth={r * 0.18} />
        <line x1={cx - offset} y1={cy + offset} x2={cx + offset} y2={cy - offset} stroke={teamColor} strokeWidth={r * 0.18} />
      </g>
    );
  }

  const yawRad = ((yaw ?? 0) * Math.PI) / 180;
  const dx = Math.cos(yawRad);
  const dy = -Math.sin(yawRad);

  const arrowLen = r + r * 0.9;
  const conePoints = (() => {
    const half = (40 * Math.PI) / 180;
    const len = r + r * 1.4;
    const ax = cx + Math.cos(yawRad) * len;
    const ay = cy + -Math.sin(yawRad) * len;
    const bx = cx + Math.cos(yawRad - half) * len * 0.85;
    const by = cy + -Math.sin(yawRad - half) * len * 0.85;
    const dx2 = cx + Math.cos(yawRad + half) * len * 0.85;
    const dy2 = cy + -Math.sin(yawRad + half) * len * 0.85;
    return `${cx},${cy} ${bx},${by} ${ax},${ay} ${dx2},${dy2}`;
  })();

  return (
    <g>
      {focused && (
        <circle cx={cx} cy={cy} r={r + 6} fill="none" stroke={teamColor} strokeOpacity={0.5} strokeWidth="2" />
      )}

      {showArrow && (
        <>
          <polygon points={conePoints} fill={teamColor} opacity={0.18} />
          <line
            x1={cx + dx * (r + 1)}
            y1={cy + dy * (r + 1)}
            x2={cx + dx * arrowLen}
            y2={cy + dy * arrowLen}
            stroke={teamColor}
            strokeWidth={focused ? 2.5 : 2}
            strokeLinecap="round"
          />
        </>
      )}

      {/* Outer halo for hit-target legibility */}
      <circle
        cx={cx}
        cy={cy}
        r={r + 2}
        fill="hsl(220 16% 9%)"
        opacity={0.4}
      />
      <circle cx={cx} cy={cy} r={r} fill={teamColor} stroke="hsl(220 16% 9%)" strokeWidth="2" />
      <circle cx={cx} cy={cy} r={r * 0.42} fill="hsl(220 16% 9%)" />

      {/* Name with stroked outline so it stays readable on radar busy areas */}
      <text
        x={cx}
        y={cy - r - 4}
        textAnchor="middle"
        fontSize={Math.max(9, r * 0.95)}
        fill="hsl(220 16% 6%)"
        stroke="hsl(220 16% 6%)"
        strokeWidth={3}
        strokeLinejoin="round"
        paintOrder="stroke"
        fontWeight="700"
        style={{ pointerEvents: "none" }}
      >
        {name}
      </text>
      <text
        x={cx}
        y={cy - r - 4}
        textAnchor="middle"
        fontSize={Math.max(9, r * 0.95)}
        fill="hsl(0 0% 98%)"
        fontWeight="700"
        style={{ pointerEvents: "none" }}
      >
        {name}
      </text>
    </g>
  );
}

function KillMarker({
  cx,
  cy,
  alpha,
  label,
}: {
  cx: number;
  cy: number;
  alpha: number;
  label: string;
}) {
  return (
    <g opacity={alpha} style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r="18" fill="hsl(350 90% 50% / 0.10)" />
      <circle cx={cx} cy={cy} r="11" fill="hsl(350 80% 30%)" stroke="hsl(350 90% 60%)" strokeWidth="1.5" />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        fontSize="11"
        fill="hsl(0 0% 100%)"
        fontWeight="700"
      >
        ☠
      </text>
      {label && (
        <text
          x={cx}
          y={cy + 26}
          textAnchor="middle"
          fontSize="9"
          fill="hsl(0 0% 100%)"
          stroke="hsl(220 16% 6%)"
          strokeWidth={2.5}
          strokeLinejoin="round"
          paintOrder="stroke"
          fontWeight="600"
        >
          {label}
        </text>
      )}
    </g>
  );
}

function GrenadeArea({
  cx,
  cy,
  r,
  subtype,
}: {
  cx: number;
  cy: number;
  r: number;
  subtype: GrenadeSubtype;
}) {
  if (subtype === "smoke") {
    return (
      <g style={{ pointerEvents: "none" }}>
        <circle cx={cx} cy={cy} r={r} fill="url(#smoke-grad)" />
        <circle
          cx={cx}
          cy={cy}
          r={r * 0.55}
          fill="hsl(220 8% 80% / 0.25)"
          stroke="hsl(220 10% 90% / 0.6)"
          strokeWidth="1"
          strokeDasharray="3 3"
        />
      </g>
    );
  }
  if (subtype === "molotov") {
    return (
      <g style={{ pointerEvents: "none" }}>
        <circle cx={cx} cy={cy} r={r} fill="url(#molotov-grad)" />
        <circle
          cx={cx}
          cy={cy}
          r={r * 0.5}
          fill="none"
          stroke="hsl(20 100% 60% / 0.6)"
          strokeWidth="1.2"
          strokeDasharray="4 3"
        />
      </g>
    );
  }
  return null;
}

// Weapon icons served from /public/weapons/ — same assets as the HUD.
const WEAPON_ICON_MAP: Record<string, string> = {
  smokegrenade: "/weapons/smokegrenade.webp",
  flashbang:    "/weapons/flashbang.webp",
  hegrenade:    "/weapons/hegrenade.svg",
  molotov:      "/weapons/molotov.svg",
  incgrenade:   "/weapons/incgrenade.webp",
  decoy:        "/weapons/decoy.svg",
};

function resolveDropIcon(weapon: string): string | null {
  const w = weapon.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Grenade aliases
  if (w.startsWith("smoke")) return WEAPON_ICON_MAP.smokegrenade;
  if (w.startsWith("flash")) return WEAPON_ICON_MAP.flashbang;
  if (w.includes("hegren") || w === "he") return WEAPON_ICON_MAP.hegrenade;
  if (w.startsWith("molotov")) return WEAPON_ICON_MAP.molotov;
  if (w.startsWith("inc") || w.startsWith("incendiary")) return WEAPON_ICON_MAP.incgrenade;
  if (w.startsWith("decoy")) return WEAPON_ICON_MAP.decoy;
  // Real weapons: use the existing path pattern from weaponIcons.ts
  // (files are named by lowercase engine name, e.g. ak47.svg, awp.svg)
  const engineNames: Record<string, string> = {
    "ak47": "ak47", "ak-47": "ak47",
    "m4a1silencer": "m4a1_silencer", "m4a1": "m4a1",
    "awp": "awp",
    "deagle": "deagle", "deserteagle": "deagle",
    "glock": "glock", "glock18": "glock",
    "uspsilencer": "usp_silencer", "usp": "usp_silencer",
    "p2000": "p2000",
    "p250": "p250",
    "fiveseven": "fiveseven",
    "tec9": "tec9",
    "cz75a": "cz75a",
    "famas": "famas", "galilar": "galilar",
    "sg556": "sg556", "aug": "aug",
    "mac10": "mac10", "mp9": "mp9", "mp7": "mp7",
    "mp5sd": "mp5sd", "ump45": "ump45", "p90": "p90",
    "nova": "nova", "mag7": "mag7", "xm1014": "xm1014",
    "ssg08": "ssg08", "scar20": "scar20", "g3sg1": "g3sg1",
  };
  for (const [k, v] of Object.entries(engineNames)) {
    if (w.includes(k)) return `/weapons/${v}.svg`;
  }
  return null;
}

function DroppedWeapon({
  cx, cy, weapon, isGrenade, size,
}: {
  cx: number; cy: number; weapon: string; isGrenade: boolean; size: number;
}) {
  const iconUrl = resolveDropIcon(weapon);
  const half = size / 2;
  if (!iconUrl) {
    // Fallback: simple white dot with weapon initial
    const label = weapon.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase();
    return (
      <g style={{ pointerEvents: "none" }}>
        <rect
          x={cx - half} y={cy - half / 2}
          width={size} height={size * 0.6}
          rx={3} ry={3}
          fill="hsl(220 16% 12% / 0.85)"
          stroke="hsl(0 0% 60%)"
          strokeWidth={1}
        />
        <text x={cx} y={cy + 2} textAnchor="middle" fontSize={Math.max(7, size * 0.35)}
          fill="hsl(0 0% 90%)" fontWeight="700">
          {label}
        </text>
      </g>
    );
  }
  return (
    <g style={{ pointerEvents: "none" }}>
      {/* Dark pill background */}
      <rect
        x={cx - half - 2} y={cy - half / 2 - 2}
        width={size + 4} height={size * 0.65 + 4}
        rx={4} ry={4}
        fill="hsl(220 16% 8% / 0.80)"
        stroke={isGrenade ? "hsl(50 80% 50% / 0.6)" : "hsl(0 0% 50% / 0.5)"}
        strokeWidth={1}
      />
      {/* Use foreignObject to embed the img — stays crisp at any zoom */}
      <foreignObject x={cx - half} y={cy - half / 2} width={size} height={size * 0.6}>
        {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
        {/* @ts-ignore — xmlns required for SVG foreignObject */}
        <div xmlns="http://www.w3.org/1999/xhtml"
          style={{ width: "100%", height: "100%", display: "flex",
            alignItems: "center", justifyContent: "center" }}>
          <img
            src={iconUrl}
            alt={weapon}
            style={{
              maxWidth: "100%", maxHeight: "100%", objectFit: "contain",
              filter: "brightness(0) invert(1)",
              opacity: 0.9,
            }}
          />
        </div>
      </foreignObject>
    </g>
  );
}

function PopRing({
  cx,
  cy,
  r,
  alpha,
  subtype,
}: {
  cx: number;
  cy: number;
  r: number;
  alpha: number;
  subtype: GrenadeSubtype;
}) {
  const color =
    subtype === "flash"
      ? "hsl(50 100% 70%)"
      : subtype === "he"
        ? "hsl(15 90% 55%)"
        : "hsl(0 0% 80%)";
  return (
    <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth="2" opacity={alpha} />
  );
}

function BombMarker({
  cx,
  cy,
  site,
}: {
  cx: number;
  cy: number;
  site: string;
}) {
  return (
    <g style={{ pointerEvents: "none" }}>
      <circle cx={cx} cy={cy} r="22" fill="hsl(0 80% 55% / 0.18)">
        <animate attributeName="r" values="20;28;20" dur="1.2s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.9;0.3;0.9" dur="1.2s" repeatCount="indefinite" />
      </circle>
      <circle cx={cx} cy={cy} r="9" fill="hsl(0 80% 55%)" stroke="hsl(220 16% 6%)" strokeWidth="1.5" />
      <text
        x={cx}
        y={cy + 3}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill="hsl(0 0% 100%)"
        style={{ pointerEvents: "none" }}
      >
        C4
      </text>
      <text
        x={cx}
        y={cy - 18}
        textAnchor="middle"
        fontSize="10"
        fontWeight="700"
        fill="hsl(0 0% 100%)"
        stroke="hsl(220 16% 6%)"
        strokeWidth={2.5}
        strokeLinejoin="round"
        paintOrder="stroke"
      >
        BOMB · {site}
      </text>
    </g>
  );
}
