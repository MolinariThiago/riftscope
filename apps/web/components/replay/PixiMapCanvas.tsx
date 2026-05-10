"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Assets, Container, Graphics, Sprite, Text, TextStyle, type ColorSource } from "pixi.js";
import { Viewport } from "pixi-viewport";
import { Maximize2, Minus, Plus } from "lucide-react";

import { cn } from "@/lib/utils";
import {
  type ReplayLayers,
  DEFAULT_LAYERS,
} from "@/components/replay/layers";
import type {
  GrenadeSubtype,
  MapMetadata,
  PlayerStats,
  TimelineEvent,
  TimelineFrame,
} from "@/types/demo";

interface PixiMapCanvasProps {
  mapName: string | null;
  mapMeta?: MapMetadata | null;
  frame: TimelineFrame | null;
  pastEvents: TimelineEvent[];
  currentTime: number;
  allFrames?: TimelineFrame[];
  focusedSteamId?: string | null;
  playerLookup?: Map<string, PlayerStats>;
  layers?: ReplayLayers;
  fullBleed?: boolean;
}

const FALLBACK_RADAR_SIZE = 1024;
const FALLBACK_POS_X = -2000;
const FALLBACK_POS_Y = 2000;
const FALLBACK_SCALE = 4.0;

const TEAM_COLOR_CT = 0x4a9eff;
const TEAM_COLOR_TT = 0xffb347;
const COLOR_KILL = 0xff4d6d;
const COLOR_BOMB = 0xff5757;
const COLOR_SMOKE = 0xcfd2d6;
const COLOR_FLASH = 0xffe066;
const COLOR_HE = 0xff7a3a;
const COLOR_MOLOTOV = 0xff9433;

/**
 * Pixi.js / WebGL renderer for the 2D replay map.
 *
 * Architecture:
 *   - One ``Application`` per canvas, mounted to a container ref.
 *   - A ``Viewport`` (from pixi-viewport) handles wheel zoom + drag pan,
 *     replacing the SVG/manual implementation.
 *   - Six layered ``Container`` graphs:
 *       1. radar background (Sprite for the PNG)
 *       2. world overlays (spawn zones, sites, callouts, heatmap, paths)
 *       3. grenade areas + tracers (smoke clouds, molotov burns)
 *       4. kill trajectory curves
 *       5. dynamic event markers (kill skulls, bomb marker, pop rings)
 *       6. players (sprites + labels + view arrows)
 *
 * State updates run as a single ``redraw()`` per render cycle that diffs
 * the current frame/event slices and adjusts existing display objects
 * instead of recreating them — keeps GC pressure flat for long replays.
 *
 * Coordinate system mirrors the SVG version exactly:
 *   radar_px_x = (world_x - pos_x) / scale
 *   radar_px_y = (pos_y - world_y) / scale     // Y inverted
 *
 * The Viewport's "world size" is the radar dimensions in pixels (1024×1024
 * for Valve overviews). All world coordinates are projected up-front; Pixi
 * never sees raw demo coords.
 */
export function PixiMapCanvas({
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
}: PixiMapCanvasProps) {
  const radarSize = mapMeta?.radarSize ?? FALLBACK_RADAR_SIZE;
  const posX = mapMeta?.posX ?? FALLBACK_POS_X;
  const posY = mapMeta?.posY ?? FALLBACK_POS_Y;
  const scale = mapMeta?.scale ?? FALLBACK_SCALE;

  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const viewportRef = useRef<Viewport | null>(null);
  const layersRef = useRef<{
    radar: Container;
    overlays: Container;
    nadeAreas: Container;
    killLines: Container;
    eventMarkers: Container;
    players: Container;
    callouts: Container;
  } | null>(null);
  const radarSpriteRef = useRef<Sprite | null>(null);
  const playerNodesRef = useRef<Map<string, PlayerNode>>(new Map());

  const hasLowerLevel = !!mapMeta?.radarUrlLower;
  const [showLower, setShowLower] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  const radarUrl = showLower && mapMeta?.radarUrlLower
    ? mapMeta.radarUrlLower
    : mapMeta?.radarUrl ?? null;

  const project = useMemo(
    () => (x: number, y: number) => ({
      cx: (x - posX) / scale,
      cy: (posY - y) / scale,
    }),
    [posX, posY, scale],
  );
  const projectScalar = useMemo(
    () => (units: number) => units / scale,
    [scale],
  );

  // ============== App init (once) ==============
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let cancelled = false;

    const app = new Application();
    appRef.current = app;

    (async () => {
      await app.init({
        background: "#0a0d14",
        backgroundAlpha: 1,
        antialias: true,
        autoDensity: true,
        resolution: window.devicePixelRatio || 1,
        resizeTo: host,
        powerPreference: "high-performance",
      });
      if (cancelled) {
        app.destroy(true, { children: true });
        return;
      }
      host.appendChild(app.canvas);

      // Viewport — handles zoom + pan
      const viewport = new Viewport({
        screenWidth: host.clientWidth,
        screenHeight: host.clientHeight,
        worldWidth: radarSize,
        worldHeight: radarSize,
        events: app.renderer.events,
      });
      app.stage.addChild(viewport);
      viewport
        .drag()
        .pinch()
        .wheel({ smooth: 5, percent: 0.12 })
        .clampZoom({ minScale: 0.4, maxScale: 6 })
        .clamp({
          left: -200,
          right: radarSize + 200,
          top: -200,
          bottom: radarSize + 200,
          underflow: "center",
        });
      viewport.fit();
      viewport.moveCenter(radarSize / 2, radarSize / 2);

      // Initial zoom 1.18 in fullBleed to crop the PNG letterbox.
      const initial = fullBleed ? 1.18 : 1;
      viewport.setZoom(initial * (host.clientWidth / radarSize), true);

      viewport.on("zoomed", () => {
        setZoomLevel(viewport.scale.x / (host.clientWidth / radarSize));
      });
      viewportRef.current = viewport;

      // Layered containers (z-order ascending)
      const radar = new Container();
      const overlays = new Container();
      const callouts = new Container();
      const nadeAreas = new Container();
      const killLines = new Container();
      const eventMarkers = new Container();
      const players = new Container();
      viewport.addChild(radar, overlays, nadeAreas, killLines, eventMarkers, callouts, players);
      layersRef.current = { radar, overlays, nadeAreas, killLines, eventMarkers, players, callouts };
    })();

    return () => {
      cancelled = true;
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true });
        } catch {
          /* destroy may double-free during HMR; safe to ignore */
        }
        appRef.current = null;
        viewportRef.current = null;
        layersRef.current = null;
        radarSpriteRef.current = null;
        playerNodesRef.current.clear();
      }
    };
  }, [radarSize, fullBleed]);

  // ============== Resize observer ==============
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const app = appRef.current;
      const vp = viewportRef.current;
      if (!app || !vp) return;
      app.renderer.resize(host.clientWidth, host.clientHeight);
      vp.resize(host.clientWidth, host.clientHeight, radarSize, radarSize);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [radarSize]);

  // ============== Radar sprite ==============
  useEffect(() => {
    const ls = layersRef.current;
    if (!ls) return;
    let cancelled = false;
    if (radarSpriteRef.current) {
      ls.radar.removeChild(radarSpriteRef.current);
      radarSpriteRef.current.destroy();
      radarSpriteRef.current = null;
    }
    if (!radarUrl || !layers.radarOverlay) return;
    (async () => {
      try {
        const tex = await Assets.load(radarUrl);
        if (cancelled) return;
        const sprite = new Sprite(tex);
        sprite.width = radarSize;
        sprite.height = radarSize;
        // Tactical look — same brightness/contrast/saturation reduction
        // we used in the SVG via CSS filter, but applied here as tint+alpha.
        sprite.tint = 0xb0b8c4; // gentle desaturate via tint
        sprite.alpha = 0.85;
        ls.radar.addChild(sprite);
        radarSpriteRef.current = sprite;
      } catch {
        /* radar image missing — skip */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [radarUrl, layers.radarOverlay, radarSize]);

  // ============== Static overlays (sites, callouts, spawn zones) ==============
  useEffect(() => {
    const ls = layersRef.current;
    if (!ls || !mapMeta) return;
    ls.overlays.removeChildren().forEach((c) => c.destroy());
    ls.callouts.removeChildren().forEach((c) => c.destroy());

    // Spawn zones (subtle radial gradients faked with concentric circles)
    drawSpawnZone(ls.overlays, project(mapMeta.spawnCt[0], mapMeta.spawnCt[1]), projectScalar(420), TEAM_COLOR_CT);
    drawSpawnZone(ls.overlays, project(mapMeta.spawnTt[0], mapMeta.spawnTt[1]), projectScalar(420), TEAM_COLOR_TT);

    // Sites
    if (layers.sites) {
      drawSite(ls.overlays, project(mapMeta.siteA[0], mapMeta.siteA[1]), "A", 0x4a9eff);
      drawSite(ls.overlays, project(mapMeta.siteB[0], mapMeta.siteB[1]), "B", 0xb46cff);
    }

    // Callouts
    if (layers.callouts) {
      for (const c of mapMeta.callouts) {
        if (/^[ab] site|spawn$/i.test(c.name)) continue;
        const p = project(c.x, c.y);
        drawCallout(ls.callouts, p, projectScalar(c.radius), c.name);
      }
    }
  }, [mapMeta, layers.sites, layers.callouts, project, projectScalar]);

  // ============== Heatmap overlay ==============
  useEffect(() => {
    const ls = layersRef.current;
    if (!ls) return;
    // Heatmap renders on the overlays layer; clear the heat-only children
    // to avoid duplicates each tick.
    const existing = ls.overlays.children.filter((c) => (c as Container & { __isHeat?: boolean }).__isHeat);
    for (const c of existing) ls.overlays.removeChild(c);
    if (!layers.heatmap || !allFrames || allFrames.length === 0) return;

    const heatLayer = new Container();
    (heatLayer as Container & { __isHeat?: boolean }).__isHeat = true;
    const STEP = Math.max(1, Math.floor(allFrames.length / 60));
    const r = projectScalar(220);
    for (let i = 0; i < allFrames.length; i += STEP) {
      for (const p of allFrames[i].players) {
        if (!p.alive) continue;
        const pp = project(p.x, p.y);
        const g = new Graphics();
        g.circle(pp.cx, pp.cy, r).fill({ color: p.team === "ct" ? TEAM_COLOR_CT : TEAM_COLOR_TT, alpha: 0.05 });
        heatLayer.addChild(g);
      }
    }
    ls.overlays.addChild(heatLayer);
  }, [layers.heatmap, allFrames, project, projectScalar]);

  // ============== Trajectories (per-player up to current frame) ==============
  useEffect(() => {
    const ls = layersRef.current;
    if (!ls) return;
    const existing = ls.overlays.children.filter((c) => (c as Container & { __isTraj?: boolean }).__isTraj);
    for (const c of existing) ls.overlays.removeChild(c);
    if (!layers.trajectories || !allFrames || allFrames.length === 0) return;

    const totalT = allFrames[allFrames.length - 1].t || 1;
    const fps = allFrames.length / Math.max(1, totalT);
    const cutoff = Math.min(allFrames.length - 1, Math.floor(currentTime * fps));
    if (cutoff < 1) return;

    const trajLayer = new Container();
    (trajLayer as Container & { __isTraj?: boolean }).__isTraj = true;
    const byPlayer = new Map<string, { team: "ct" | "tt"; pts: number[] }>();
    for (let i = 0; i <= cutoff; i++) {
      for (const p of allFrames[i].players) {
        if (!p.alive) continue;
        const pp = project(p.x, p.y);
        let entry = byPlayer.get(p.steamId);
        if (!entry) {
          entry = { team: p.team, pts: [] };
          byPlayer.set(p.steamId, entry);
        }
        entry.pts.push(pp.cx, pp.cy);
      }
    }
    byPlayer.forEach((v) => {
      if (v.pts.length < 4) return;
      const g = new Graphics();
      g.moveTo(v.pts[0], v.pts[1]);
      for (let i = 2; i < v.pts.length; i += 2) {
        g.lineTo(v.pts[i], v.pts[i + 1]);
      }
      g.stroke({
        color: v.team === "ct" ? TEAM_COLOR_CT : TEAM_COLOR_TT,
        width: 1.2,
        alpha: 0.55,
        cap: "round",
        join: "round",
      });
      trajLayer.addChild(g);
    });
    ls.overlays.addChild(trajLayer);
  }, [layers.trajectories, allFrames, currentTime, project, projectScalar]);

  // ============== Dynamic redraw — events + players (every render) ==============
  useEffect(() => {
    const ls = layersRef.current;
    if (!ls) return;

    // Clear dynamic layers
    ls.killLines.removeChildren().forEach((c) => c.destroy());
    ls.nadeAreas.removeChildren().forEach((c) => c.destroy());
    ls.eventMarkers.removeChildren().forEach((c) => c.destroy());

    // Active grenades (smokes / molotovs)
    if (layers.grenades) {
      for (const e of pastEvents) {
        if (e.type !== "grenade_thrown") continue;
        if (!(e.subtype === "smoke" || e.subtype === "molotov")) continue;
        if (e.expiresAt === undefined || e.expiresAt <= currentTime) continue;
        const p = project(e.x ?? 0, e.y ?? 0);
        const r = projectScalar(e.radius ?? (e.subtype === "smoke" ? 220 : 160));
        const g = new Graphics();
        if (e.subtype === "smoke") {
          g.circle(p.cx, p.cy, r).fill({ color: 0xb0b6c0, alpha: 0.35 });
          g.circle(p.cx, p.cy, r * 0.55).stroke({ color: 0xe0e2e6, alpha: 0.55, width: 1 });
        } else {
          g.circle(p.cx, p.cy, r).fill({ color: COLOR_MOLOTOV, alpha: 0.32 });
          g.circle(p.cx, p.cy, r * 0.5).stroke({ color: COLOR_MOLOTOV, alpha: 0.7, width: 1.2 });
        }
        ls.nadeAreas.addChild(g);
      }
    }

    // Grenade trajectory tracers (thrower → landing curve)
    if (layers.grenades) {
      for (const e of pastEvents) {
        if (e.type !== "grenade_thrown") continue;
        if (e.throwerX === undefined || e.throwerY === undefined) continue;
        const age = currentTime - e.t;
        if (age < 0 || age > 3.5) continue;
        const a = project(e.throwerX, e.throwerY);
        const b = project(e.x ?? 0, e.y ?? 0);
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const bend = Math.min(160, dist * 0.32);
        const mx = (a.cx + b.cx) / 2 + (-dy / dist) * bend;
        const my = (a.cy + b.cy) / 2 + (dx / dist) * bend;
        const color =
          e.subtype === "smoke"
            ? COLOR_SMOKE
            : e.subtype === "flash"
              ? COLOR_FLASH
              : e.subtype === "molotov"
                ? COLOR_MOLOTOV
                : COLOR_HE;
        const alpha = Math.max(0, 1 - age / 3.5) * 0.7;
        const g = new Graphics();
        g.moveTo(a.cx, a.cy)
          .quadraticCurveTo(mx, my, b.cx, b.cy)
          .stroke({ color, alpha, width: 1.4, cap: "round" });
        g.circle(a.cx, a.cy, 2.5).fill({ color, alpha: alpha + 0.1 });
        ls.killLines.addChild(g);
      }
    }

    // Kill trajectory lines (killer → victim curve, last 6s)
    if (layers.killMarkers) {
      for (const e of pastEvents) {
        if (e.type !== "kill") continue;
        if (e.killerX === undefined || e.killerY === undefined) continue;
        const age = currentTime - e.t;
        if (age < 0 || age > 6) continue;
        const a = project(e.killerX, e.killerY);
        const b = project(e.x ?? 0, e.y ?? 0);
        const killer = e.killer ? playerLookup?.get(e.killer) : undefined;
        const color =
          killer?.team === "ct" ? TEAM_COLOR_CT : killer?.team === "tt" ? TEAM_COLOR_TT : COLOR_KILL;
        const dx = b.cx - a.cx;
        const dy = b.cy - a.cy;
        const dist = Math.hypot(dx, dy) || 1;
        const bend = Math.min(120, dist * 0.18);
        const mx = (a.cx + b.cx) / 2 + (-dy / dist) * bend;
        const my = (a.cy + b.cy) / 2 + (dx / dist) * bend;
        const alpha = (1 - age / 6) * 0.85 + 0.15;
        const g = new Graphics();
        g.moveTo(a.cx, a.cy)
          .quadraticCurveTo(mx, my, b.cx, b.cy)
          .stroke({ color, alpha, width: 1.6, cap: "round" });
        g.circle(a.cx, a.cy, 3).fill({ color, alpha });
        ls.killLines.addChild(g);
      }
    }

    // Bomb planted marker (sticky until defused/exploded)
    if (layers.bomb) {
      let planted: TimelineEvent | null = null;
      let cleared = false;
      for (const e of pastEvents) {
        if (e.type === "bomb_planted") planted = e;
        if (e.type === "bomb_defused" || e.type === "bomb_exploded") {
          cleared = true;
        }
      }
      if (planted && !cleared) {
        const p = project(planted.x ?? 0, planted.y ?? 0);
        // Pulsing ring (use sin of currentTime to drive size)
        const pulse = 1 + Math.sin(currentTime * 5) * 0.25;
        const g = new Graphics();
        g.circle(p.cx, p.cy, 22 * pulse).fill({ color: COLOR_BOMB, alpha: 0.18 });
        g.circle(p.cx, p.cy, 9).fill({ color: COLOR_BOMB }).stroke({ color: 0x0a0d14, width: 1.5 });
        ls.eventMarkers.addChild(g);
        const txt = new Text({
          text: `BOMB · ${planted.site ?? "?"}`,
          style: textStyle(10, 0xffffff, 700),
        });
        txt.anchor.set(0.5);
        txt.position.set(p.cx, p.cy - 18);
        ls.eventMarkers.addChild(txt);
      }
    }

    // Recent kill skull markers (fade over 6s)
    if (layers.killMarkers) {
      for (const e of pastEvents) {
        if (e.type !== "kill") continue;
        const age = currentTime - e.t;
        if (age < 0 || age > 6) continue;
        const alpha = 1 - age / 6;
        const p = project(e.x ?? 0, e.y ?? 0);
        const g = new Graphics();
        g.circle(p.cx, p.cy, 18).fill({ color: COLOR_KILL, alpha: alpha * 0.1 });
        g.circle(p.cx, p.cy, 11)
          .fill({ color: 0x4d1019, alpha: alpha })
          .stroke({ color: COLOR_KILL, alpha, width: 1.5 });
        ls.eventMarkers.addChild(g);
        const skull = new Text({
          text: "☠",
          style: textStyle(11, 0xffffff, 700),
        });
        skull.anchor.set(0.5, 0.5);
        skull.position.set(p.cx, p.cy + 1);
        skull.alpha = alpha;
        ls.eventMarkers.addChild(skull);

        const killer = e.killer ? playerLookup?.get(e.killer) : undefined;
        const victim = e.victim ? playerLookup?.get(e.victim) : undefined;
        if (killer && victim) {
          const lbl = new Text({
            text: `${killer.name} → ${victim.name}`,
            style: textStyle(9, 0xffffff, 600, true),
          });
          lbl.anchor.set(0.5, 0);
          lbl.position.set(p.cx, p.cy + 14);
          lbl.alpha = alpha;
          ls.eventMarkers.addChild(lbl);
        }
      }
    }

    // Players — diff against existing nodes; reuse where possible
    const seen = new Set<string>();
    if (frame) {
      for (const p of frame.players) {
        seen.add(p.steamId);
        let node = playerNodesRef.current.get(p.steamId);
        if (!node) {
          node = createPlayerNode(p.team);
          playerNodesRef.current.set(p.steamId, node);
          ls.players.addChild(node.root);
        }
        const pp = project(p.x, p.y);
        updatePlayerNode(node, {
          cx: pp.cx,
          cy: pp.cy,
          alive: p.alive,
          name: p.name,
          team: p.team,
          yaw: p.yaw,
          focused: focusedSteamId === p.steamId,
          showArrow: layers.viewArrows,
          spriteRadius: Math.max(8, projectScalar(60)),
        });
      }
    }
    // Drop nodes that disappeared (e.g. round transition)
    const stale: string[] = [];
    playerNodesRef.current.forEach((node, sid) => {
      if (!seen.has(sid)) {
        ls.players.removeChild(node.root);
        node.root.destroy({ children: true });
        stale.push(sid);
      }
    });
    for (const sid of stale) playerNodesRef.current.delete(sid);
  }, [
    frame,
    pastEvents,
    currentTime,
    layers,
    playerLookup,
    focusedSteamId,
    project,
    projectScalar,
  ]);

  // ============== Zoom UI bridge ==============
  const setZoomBy = (factor: number) => {
    const vp = viewportRef.current;
    const host = containerRef.current;
    if (!vp || !host) return;
    const base = host.clientWidth / radarSize;
    const target = Math.max(0.5, Math.min(6, zoomLevel * factor));
    vp.setZoom(target * base, true);
    setZoomLevel(target);
  };
  const resetView = () => {
    const vp = viewportRef.current;
    const host = containerRef.current;
    if (!vp || !host) return;
    const base = host.clientWidth / radarSize;
    vp.setZoom((fullBleed ? 1.18 : 1) * base, true);
    vp.moveCenter(radarSize / 2, radarSize / 2);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative select-none",
        fullBleed ? "w-full h-full" : "w-full max-w-[840px] mx-auto aspect-square",
      )}
    >
      {/* Map header overlay (top-left) */}
      <div className="absolute top-3 left-3 z-10 flex items-center gap-2 px-3 py-1.5 rounded-lg bg-background/80 backdrop-blur-md border border-border/60 pointer-events-none shadow-lg">
        <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
        <span className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground">Map</span>
        <span className="text-xs font-bold tracking-wide">
          {mapMeta?.displayName ?? mapName ?? "—"}
        </span>
      </div>

      {/* Two-level toggle */}
      {hasLowerLevel && (
        <div className="absolute top-3 right-3 z-10 flex rounded-lg overflow-hidden border border-border/60 bg-background/80 backdrop-blur-md shadow-lg">
          <LevelButton active={!showLower} onClick={() => setShowLower(false)} label="Upper" />
          <LevelButton active={showLower} onClick={() => setShowLower(true)} label="Lower" />
        </div>
      )}

      {/* Zoom toolbar (bottom-right) */}
      <div className="absolute bottom-3 right-3 z-10 flex flex-col items-end gap-1.5">
        <div className="flex flex-col rounded-lg overflow-hidden border border-border/60 bg-background/80 backdrop-blur-md shadow-lg">
          <button
            onClick={() => setZoomBy(1.4)}
            disabled={zoomLevel >= 6 - 0.001}
            title="Zoom in"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus size={14} />
          </button>
          <div className="px-1.5 py-1 text-[10px] font-mono-rs text-center text-muted-foreground border-y border-border/40">
            {zoomLevel.toFixed(1)}x
          </div>
          <button
            onClick={() => setZoomBy(1 / 1.4)}
            disabled={zoomLevel <= 0.5 + 0.001}
            title="Zoom out"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Minus size={14} />
          </button>
          <button
            onClick={resetView}
            title="Reset view"
            className="p-1.5 text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors border-t border-border/40"
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

// =========================================================================
// Pixi helpers
// =========================================================================

interface PlayerNode {
  root: Container;
  bodyOuter: Graphics;
  body: Graphics;
  label: Text;
  arrow: Graphics;
  cone: Graphics;
}

function createPlayerNode(team: "ct" | "tt"): PlayerNode {
  const root = new Container();
  const cone = new Graphics();
  const arrow = new Graphics();
  const bodyOuter = new Graphics();
  const body = new Graphics();
  const label = new Text({ text: "", style: textStyle(11, 0xffffff, 700, true) });
  label.anchor.set(0.5, 1);
  root.addChild(cone, arrow, bodyOuter, body, label);
  // Team-colored once; updates only when the team changes (rarely).
  void team;
  return { root, bodyOuter, body, label, arrow, cone };
}

function updatePlayerNode(
  node: PlayerNode,
  s: {
    cx: number;
    cy: number;
    alive: boolean;
    name: string;
    team: "ct" | "tt";
    yaw?: number;
    focused: boolean;
    showArrow: boolean;
    spriteRadius: number;
  },
) {
  const teamColor = s.team === "ct" ? TEAM_COLOR_CT : TEAM_COLOR_TT;
  const r = s.focused ? s.spriteRadius * 1.25 : s.spriteRadius;

  node.root.position.set(s.cx, s.cy);
  node.root.alpha = s.alive ? 1 : 0.55;

  // ---- Body (alive) or X (dead) ----
  node.body.clear();
  node.bodyOuter.clear();
  if (s.alive) {
    node.bodyOuter.circle(0, 0, r + 2).fill({ color: 0x0a0d14, alpha: 0.4 });
    node.body
      .circle(0, 0, r)
      .fill({ color: teamColor })
      .stroke({ color: 0x0a0d14, width: 2 });
    node.body.circle(0, 0, r * 0.42).fill({ color: 0x0a0d14 });
  } else {
    const off = r * 0.7;
    node.body
      .moveTo(-off, -off)
      .lineTo(off, off)
      .stroke({ color: teamColor, width: r * 0.18 })
      .moveTo(-off, off)
      .lineTo(off, -off)
      .stroke({ color: teamColor, width: r * 0.18 });
  }

  // ---- View direction arrow + cone ----
  node.arrow.clear();
  node.cone.clear();
  if (s.alive && s.showArrow) {
    const yawRad = ((s.yaw ?? 0) * Math.PI) / 180;
    const dx = Math.cos(yawRad);
    const dy = -Math.sin(yawRad);
    const half = (40 * Math.PI) / 180;
    const len = r + r * 1.4;
    const ax = Math.cos(yawRad) * len;
    const ay = -Math.sin(yawRad) * len;
    const bx = Math.cos(yawRad - half) * len * 0.85;
    const by = -Math.sin(yawRad - half) * len * 0.85;
    const dx2 = Math.cos(yawRad + half) * len * 0.85;
    const dy2 = -Math.sin(yawRad + half) * len * 0.85;
    node.cone
      .moveTo(0, 0)
      .lineTo(bx, by)
      .lineTo(ax, ay)
      .lineTo(dx2, dy2)
      .closePath()
      .fill({ color: teamColor, alpha: 0.18 });
    const arrowLen = r + r * 0.9;
    node.arrow
      .moveTo(dx * (r + 1), dy * (r + 1))
      .lineTo(dx * arrowLen, dy * arrowLen)
      .stroke({ color: teamColor, width: s.focused ? 2.5 : 2, cap: "round" });
  }

  // ---- Label ----
  if (node.label.text !== s.name) node.label.text = s.name;
  node.label.position.set(0, -r - 4);
}

function drawSpawnZone(parent: Container, p: { cx: number; cy: number }, r: number, color: ColorSource) {
  const g = new Graphics();
  for (let i = 0; i < 6; i++) {
    const t = i / 6;
    g.circle(p.cx, p.cy, r * (1 - t * 0.7)).fill({ color, alpha: 0.018 });
  }
  parent.addChild(g);
}

function drawSite(parent: Container, p: { cx: number; cy: number }, label: "A" | "B", color: ColorSource) {
  const g = new Graphics();
  g.circle(p.cx, p.cy, 36)
    .fill({ color, alpha: 0.07 })
    .stroke({ color, alpha: 0.5, width: 1.5 });
  parent.addChild(g);
  const t = new Text({
    text: label,
    style: new TextStyle({
      fontFamily: "system-ui, sans-serif",
      fontSize: 22,
      fontWeight: "700",
      fill: { color, alpha: 0.75 },
    }),
  });
  t.anchor.set(0.5);
  t.position.set(p.cx, p.cy);
  parent.addChild(t);
}

function drawCallout(parent: Container, p: { cx: number; cy: number }, r: number, label: string) {
  const g = new Graphics();
  g.circle(p.cx, p.cy, r)
    .fill({ color: 0x4a5060, alpha: 0.04 })
    .stroke({ color: 0x4a5060, alpha: 0.15, width: 0.8 });
  parent.addChild(g);
  const t = new Text({
    text: label,
    style: new TextStyle({
      fontFamily: "monospace",
      fontSize: 9,
      fill: 0xa8aebd,
      letterSpacing: 0.5,
    }),
  });
  t.anchor.set(0.5);
  t.position.set(p.cx, p.cy);
  parent.addChild(t);
}

function textStyle(size: number, fill: number, weight: 400 | 600 | 700, withStroke = false) {
  return new TextStyle({
    fontFamily: "system-ui, sans-serif",
    fontSize: size,
    fontWeight: String(weight) as TextStyle["fontWeight"],
    fill,
    stroke: withStroke ? { color: 0x0a0d14, width: 3, join: "round" } : undefined,
  });
}

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
      className={cn(
        "px-2.5 py-1 text-[11px] font-mono-rs transition-colors",
        active ? "bg-surface-elevated text-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
