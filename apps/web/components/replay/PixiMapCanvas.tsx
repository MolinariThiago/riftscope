"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Application, Assets, ColorMatrixFilter, Container, Filter, Graphics, Sprite, Text, Texture, TextStyle, type ColorSource, type FederatedPointerEvent } from "pixi.js";

import {
  createSmokeMesh,
  updateSmokeMesh,
  type SmokeMesh,
} from "@/components/replay/SmokeShader";
import {
  createMolotovMesh,
  updateMolotovMesh,
  MOLOTOV_PALETTE,
  type MolotovMesh,
} from "@/components/replay/MolotovShader";
import { Viewport } from "pixi-viewport";

import { cn } from "@/lib/utils";
import {
  type ReplayLayers,
  DEFAULT_LAYERS,
} from "@/components/replay/layers";
import type {
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
  /** When set, the viewport recenters on this player every frame. */
  followSteamId?: string | null;
  /** Zoom level used while following (in world-px scale). 2.5 = decent follow zoom. */
  followZoom?: number;
  playerLookup?: Map<string, PlayerStats>;
  layers?: ReplayLayers;
  fullBleed?: boolean;
  /**
   * When set, pointer drag draws a freehand stroke instead of panning
   * the viewport. The viewport's drag plugin is paused while this is
   * active, and a Pixi Graphics layer renders accumulated strokes in
   * WORLD coordinates so they pan/zoom together with the map.
   *
   * Implemented after the cs2.cam / Skybox tactical-board pattern: a
   * single dedicated graphics layer over the radar, strokes baked in
   * world units, eraser = nuke-all.
   */
  drawingMode?: boolean;
  /**
   * Called once the canvas has mounted + Pixi initialized. The parent
   * can stash the returned handle in a ref and call its methods later
   * (e.g. to take a screenshot from the toolbar).
   *
   * We use a callback prop rather than ``forwardRef`` because Next's
   * ``dynamic(..., { ssr: false })`` wrapper does not forward refs.
   */
  onReady?: (handle: PixiMapCanvasHandle) => void;
}

/**
 * Imperative handle exposed via the ``onReady`` callback so the parent
 * can trigger one-shot actions like "save a screenshot" without
 * re-rendering the canvas.
 */
export interface PixiMapCanvasHandle {
  /**
   * Render the current frame to a PNG and trigger a browser download.
   * Adds a "riftscope" watermark + the demo map name in the corner.
   */
  screenshot: (opts?: { filename?: string; mapLabel?: string }) => Promise<void>;
  /**
   * Wipe every freehand stroke the user has drawn on top of the map.
   * Wired to the eraser/trash button on the bottom toolbar.
   */
  clearDrawings: () => void;
  /**
   * Multiply the current zoom by ``factor`` (clamped to 0.5x .. 6x).
   * Used by the left-edge ToolStrip's +/- buttons.
   */
  zoomBy: (factor: number) => void;
  /**
   * Reset zoom + pan to the original "fit the map" view. Used by the
   * left-edge ToolStrip's refresh button.
   */
  resetView: () => void;
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
  followSteamId,
  followZoom = 2.5,
  playerLookup,
  layers = DEFAULT_LAYERS,
  fullBleed = false,
  drawingMode = false,
  onReady,
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
    shotLines: Container;
    killLines: Container;
    eventMarkers: Container;
    players: Container;
    callouts: Container;
  } | null>(null);
  const radarSpriteRef = useRef<Sprite | null>(null);
  // Sprite used as an alpha-mask on the nadeAreas container so smokes /
  // molotovs get clipped at wall boundaries. Lives in the viewport
  // (off-camera vs the player layer), and re-created when the map
  // changes.
  const wallMaskSpriteRef = useRef<Sprite | null>(null);
  const playerNodesRef = useRef<Map<string, PlayerNode>>(new Map());
  // ---- Drawing / annotation layer ----
  // ``drawingGfxRef`` is a Pixi Graphics added directly to the viewport
  // so strokes pan and zoom with the map (world coords). ``drawingPathsRef``
  // holds the accumulated polylines as plain {x, y} world points. The
  // current in-progress path lives in ``currentPathRef`` and isn't
  // committed to the array until the user releases the pointer.
  const drawingGfxRef = useRef<Graphics | null>(null);
  const drawingPathsRef = useRef<Array<{ points: { x: number; y: number }[] }>>([]);
  const currentPathRef = useRef<{ x: number; y: number }[] | null>(null);
  // Object pools for the per-frame dynamic redraw. Keyed by stable
  // event identity (e.g. `kill-12.5-stid1-stid2`) so a Graphics is
  // reused frame-to-frame rather than destroyed and rebuilt. This
  // eliminates the GC pressure that was causing visible stutter
  // when many grenades / kills were on screen.
  const dynamicGfxPoolRef = useRef<Map<string, Graphics>>(new Map());
  const dynamicTextPoolRef = useRef<Map<string, Text>>(new Map());
  // Smoke sprites are pooled separately because each carries a custom
  // shader Filter that's expensive to recompile — we want to reuse
  // the same Sprite+Filter pair across frames for the same smoke
  // event, just updating uniforms.
  // Pool of smoke render objects. Was Sprite+Filter in v8; switched to
  // Mesh in v11 so the shader's vTextureCoord is anchored to vertex
  // UVs (stable across viewport pan/zoom) instead of the filter's
  // render texture (which Pixi clips against the visible viewport,
  // causing the cluster to drift when the camera moved).
  const smokeSpritePoolRef = useRef<Map<string, SmokeMesh>>(new Map());
  // Molotov meshes use the same lifecycle — one per active fire event,
  // pooled so re-scrubbing the same round doesn't keep creating new
  // GPU resources.
  const molotovSpritePoolRef = useRef<Map<string, MolotovMesh>>(new Map());
  // Grenade tracer-head sprites — one per in-flight ``grenade_thrown``
  // event. The sprite shows the utility icon riding the tip of the
  // trajectory line so the viewer sees "the smoke / flash / molotov
  // itself" drawing the trail rather than a generic glowing dot.
  // Pooled (rather than rebuilt every frame) so we don't churn
  // ColorMatrixFilter + Sprite instances on every animation tick.
  const nadeHeadSpritePoolRef = useRef<Map<string, Sprite>>(new Map());
  // Bomb / C4 icon sprite — single instance, since at most one bomb is
  // planted at a time. Hidden when no bomb is on the ground.
  const bombSpriteRef = useRef<Sprite | null>(null);
  // Dropped weapons + utilities on the floor — one sprite per active drop.
  // Pooled by drop-event index so we don't churn sprites every frame.
  const dropSpritePoolRef = useRef<Map<string, Sprite>>(new Map());

  const hasLowerLevel = !!mapMeta?.radarUrlLower;
  const [showLower, setShowLower] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1);
  // Flipped to true once the async Pixi init has produced layers — every
  // downstream effect depends on this so they re-fire after the canvas is
  // actually mounted (otherwise the radar/overlays paint into a null layer
  // and the map shows up blank).
  const [pixiReady, setPixiReady] = useState(false);
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
        // Pure black canvas backdrop. The radar sprite becomes the
        // ONLY non-black surface on screen, giving it max possible
        // contrast / pop. Any prior blue tint (#0a0d14, #03050a) was
        // visible enough next to the radar's own dark areas to read
        // as "competing with the map" rather than "framing it".
        background: "#000000",
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
        .clampZoom({ minScale: 0.4, maxScale: 6 });
      // No ``.clamp()`` — the user wants completely free panning at
      // every zoom level (drag the map anywhere, the way cs2.cam
      // lets you do). Any clamp + ``underflow: "center"`` setting
      // we used before either forced re-centering at fit-zoom (so
      // drag did nothing) or fenced the map inside a few hundred
      // world-units of slack (so you had to zoom in heavily before
      // panning side-to-side did anything). The ``resetView()``
      // imperative (the reset-zoom button) still snaps everything
      // back to centre if the user wanders off.
      viewport.fit();
      viewport.moveCenter(radarSize / 2, radarSize / 2);

      // Initial zoom 1.18 in fullBleed to crop the PNG letterbox.
      const initial = fullBleed ? 1.18 : 1;
      viewport.setZoom(initial * (host.clientWidth / radarSize), true);

      viewport.on("zoomed", () => {
        setZoomLevel(viewport.scale.x / (host.clientWidth / radarSize));
      });
      viewportRef.current = viewport;

      // Layered containers (z-order ascending). ``shotLines`` holds
      // the per-bullet tracer rays; it sits between the radar and the
      // player markers so the rays read clearly but don't visually
      // cover the live players. ``killLines`` (killer→victim arcs) is
      // a separate container at a similar z so the two trail systems
      // don't interleave order-of-draw-wise.
      const radar = new Container();
      const overlays = new Container();
      const callouts = new Container();
      const nadeAreas = new Container();
      const shotLines = new Container();
      const killLines = new Container();
      const eventMarkers = new Container();
      const players = new Container();
      viewport.addChild(radar, overlays, nadeAreas, shotLines, killLines, eventMarkers, callouts, players);
      layersRef.current = { radar, overlays, nadeAreas, shotLines, killLines, eventMarkers, players, callouts };

      // Drawing layer — sits ABOVE everything (players, callouts) so
      // strokes are always visible. Stored in a ref so the drawing
      // effect can render to it and the clear handler can wipe it.
      const drawings = new Graphics();
      viewport.addChild(drawings);
      drawingGfxRef.current = drawings;
      // Weapon textures are still DISABLED on the marker (the real
      // CS2 PNGs read as noise at radar scale). The utility-icon
      // overlay, on the other hand, uses the clean monochrome SVGs
      // tinted by team colour — warm those up here so the badge
      // pops in immediately the first time a player switches to a
      // grenade.
      //   preloadWeaponTextures();
      preloadUtilityTextures();
      // Force one render synchronously so the dark background paints before
      // the radar/players land, and flip the ready flag so other effects fire.
      app.renderer.render(app.stage);
      setPixiReady(true);
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
        wallMaskSpriteRef.current = null;
        playerNodesRef.current.clear();
        dynamicGfxPoolRef.current.clear();
        dynamicTextPoolRef.current.clear();
        smokeSpritePoolRef.current.clear();
        molotovSpritePoolRef.current.clear();
        nadeHeadSpritePoolRef.current.clear();
        dropSpritePoolRef.current.clear();
        if (bombSpriteRef.current) {
          try { bombSpriteRef.current.destroy(); } catch { /* */ }
          bombSpriteRef.current = null;
        }
        setPixiReady(false);
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

  // ============== Radar sprite + wall mask for grenades ==============
  useEffect(() => {
    if (!pixiReady) return;
    const ls = layersRef.current;
    const app = appRef.current;
    const vp = viewportRef.current;
    if (!ls || !app || !vp) return;
    let cancelled = false;
    if (radarSpriteRef.current) {
      ls.radar.removeChild(radarSpriteRef.current);
      radarSpriteRef.current.destroy();
      radarSpriteRef.current = null;
    }
    // Tear down any previous mask attached to the nade container.
    if (wallMaskSpriteRef.current) {
      if (ls.nadeAreas.mask) ls.nadeAreas.mask = null;
      wallMaskSpriteRef.current.removeFromParent();
      wallMaskSpriteRef.current.destroy({ texture: false });
      wallMaskSpriteRef.current = null;
    }
    if (!radarUrl || !layers.radarOverlay) return;
    (async () => {
      try {
        const tex = await Assets.load(radarUrl);
        if (cancelled) return;
        const sprite = new Sprite(tex);
        sprite.width = radarSize;
        sprite.height = radarSize;
        sprite.tint = 0xb0b8c4;
        sprite.alpha = 0.85;
        ls.radar.addChild(sprite);
        radarSpriteRef.current = sprite;
        try { app.renderer.render(app.stage); } catch { /* */ }

        // ---- Wall mask for grenade clipping ----
        // The mask TEXTURE is loaded so each smoke filter can sample
        // it per-puff in the shader (zoom-invariant via textureLod 0).
        // We deliberately do NOT set it as ``ls.nadeAreas.mask`` any
        // more: a container-level Pixi mask interpolates differently
        // at different viewport zooms (mipmaps + linear filtering),
        // which made smokes get HARD-CLIPPED rectangularly at high
        // zoom while spilling past walls at low zoom. Per-puff
        // sampling alone gives the natural "bubbles fade as they
        // approach a wall" look at every zoom.
        const maskTex = await createWallMask(radarUrl);
        if (cancelled || !maskTex) return;
        const maskSprite = new Sprite(maskTex);
        maskSprite.width = radarSize;
        maskSprite.height = radarSize;
        maskSprite.alpha = 0;   // not drawn — only used as a texture handle
        maskSprite.visible = false;
        vp.addChild(maskSprite);
        wallMaskSpriteRef.current = maskSprite;
        try { app.renderer.render(app.stage); } catch { /* */ }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[PixiMapCanvas] Failed to load radar:", radarUrl, err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pixiReady, radarUrl, layers.radarOverlay, radarSize]);

  // ============== Static overlays (sites, callouts, spawn zones) ==============
  useEffect(() => {
    if (!pixiReady) return;
    const ls = layersRef.current;
    if (!ls || !mapMeta) return;
    ls.overlays.removeChildren().forEach((c) => c.destroy());
    ls.callouts.removeChildren().forEach((c) => c.destroy());

    // Spawn zones (subtle outline rings) are the only static overlay
    // still drawn here — bomb-site markers and callout labels were
    // removed at the user's request: the radar PNG already shows
    // every site / callout on the map (visual + text labels baked
    // into the asset), and our extra overlay on top read as
    // redundant clutter.
    drawSpawnZone(ls.overlays, project(mapMeta.spawnCt[0], mapMeta.spawnCt[1]), projectScalar(420), TEAM_COLOR_CT);
    drawSpawnZone(ls.overlays, project(mapMeta.spawnTt[0], mapMeta.spawnTt[1]), projectScalar(420), TEAM_COLOR_TT);
  }, [pixiReady, mapMeta, project, projectScalar]);

  // ============== Heatmap overlay ==============
  useEffect(() => {
    if (!pixiReady) return;
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
  }, [pixiReady, layers.heatmap, allFrames, project, projectScalar]);

  // ============== Trajectories (per-player up to current frame) ==============
  useEffect(() => {
    if (!pixiReady) return;
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
  }, [pixiReady, layers.trajectories, allFrames, currentTime, project, projectScalar]);

  // ============== Dynamic redraw — events + players (every render) ==============
  useEffect(() => {
    if (!pixiReady) return;
    const ls = layersRef.current;
    if (!ls) return;

    // ------ Pooled graphics helpers ------
    // Each visible event gets a stable key. Graphics/Text objects are
    // reused across frames so we don't pay destroy()/new construction
    // cost 60x/sec. After the redraw, any pool entry whose key wasn't
    // used this frame gets removed.
    const gPool = dynamicGfxPoolRef.current;
    const tPool = dynamicTextPoolRef.current;
    const usedKeys = new Set<string>();
    const getGfx = (key: string, parent: Container): Graphics => {
      usedKeys.add(key);
      let g = gPool.get(key);
      if (!g) {
        g = new Graphics();
        parent.addChild(g);
        gPool.set(key, g);
      } else {
        // Reparent if needed — most events stay in the same layer but
        // bomb/kill use different parents.
        if (g.parent !== parent) parent.addChild(g);
        g.clear();
      }
      return g;
    };
    const getText = (key: string, parent: Container, style: TextStyle, text: string): Text => {
      usedKeys.add(key);
      let t = tPool.get(key);
      if (!t) {
        t = new Text({ text, style });
        parent.addChild(t);
        tPool.set(key, t);
      } else {
        if (t.parent !== parent) parent.addChild(t);
        if (t.text !== text) t.text = text;
      }
      return t;
    };

    // ─── Pre-pass: detect flashed players ──────────────────────────
    //
    // Builds a map of steamId → { team, intensity } for every player
    // currently affected by a recent flashbang. Used later (after
    // player rendering) to overlay a team-coloured particle "swarm"
    // on each blinded marker.
    //
    // Approximation: a player is considered flashed if they are
    // within ``FLASH_AFFECT_RADIUS_WORLD`` of a flash detonation that
    // happened within the last ``FLASH_BLIND_DURATION`` seconds.
    // Intensity decays linearly over that window. Demo data doesn't
    // expose the engine's per-player flash_duration directly, so we
    // can't honour facing angle — generous radius + linear decay is
    // the closest we get without parser changes.
    // 500 world-units underfired badly — most flashed players sit
    // 600-1200 units from the bulb depending on where they were
    // when the grenade popped. 1000 gets the realistic upper bound
    // of CS2's "actually blinded" range without false-positiving
    // players two rooms over.
    const FLASH_AFFECT_RADIUS_WORLD = 1000;
    const FLASH_BLIND_DURATION = 3.0;
    const flashedSteamIds = new Map<string, { team: "ct" | "tt"; intensity: number }>();
    if (frame?.players && layers.grenades) {
      for (const e of pastEvents) {
        if (e.type !== "grenade_thrown") continue;
        if (e.subtype !== "flash") continue;
        if (e.x === undefined || e.y === undefined) continue;
        const detT = e.detonatedAt ?? e.t;
        const since = currentTime - detT;
        if (since < 0 || since > FLASH_BLIND_DURATION) continue;
        // Sharper fall-off early, gentle tail — keeps the swarm
        // visible while the player is most blinded and tapers as
        // they recover.
        const lin = Math.max(0, 1 - since / FLASH_BLIND_DURATION);
        const intensity = lin * lin;
        if (intensity <= 0.02) continue;
        for (const player of frame.players) {
          if (!player.alive) continue;
          const dx = player.x - e.x;
          const dy = player.y - e.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < FLASH_AFFECT_RADIUS_WORLD) {
            const existing = flashedSteamIds.get(player.steamId);
            if (!existing || intensity > existing.intensity) {
              flashedSteamIds.set(player.steamId, {
                team: player.team,
                intensity,
              });
            }
          }
        }
      }
    }

    // Active grenades — smoke pulses, molotov flickers, flash bursts, HE shockwaves
    if (layers.grenades) {
      for (const e of pastEvents) {
        if (e.type !== "grenade_thrown") continue;
        const p = project(e.x ?? 0, e.y ?? 0);
        // OVERRIDE: ignore e.radius from the parser for smokes/molotovs
        // and use the "visual dense core" radius for each.
        //
        // CS2's smoke "blocking radius" is 144u, but the visual dense
        // cloud in cs2.cam/Skybox renders at ~120u — closer to the
        // particle effect's core, not the full vision-blocker volume.
        // Using 120 produces visually accurate proportions; viewers
        // still understand the smoke covers ~144u of vision blocking.
        const cs2Radius =
          e.subtype === "smoke" ? 120
          : e.subtype === "molotov" ? 130
          : e.subtype === "he" ? 90
          : e.subtype === "flash" ? 60
          : (e.radius ?? 100);
        const baseR = projectScalar(cs2Radius);
        const detonateT = e.detonatedAt ?? e.t;
        if (currentTime < detonateT) continue;
        const sinceDetonate = currentTime - detonateT;
        const areaKey = `nade-area-${e.t}-${e.player ?? "?"}-${e.subtype ?? "?"}`;
        const g = getGfx(areaKey, ls.nadeAreas);

        if (e.subtype === "smoke") {
          if (e.expiresAt === undefined || e.expiresAt <= currentTime) continue;
          // GPU-rendered smoke via custom shader.
          //
          // One Sprite + one Filter per smoke. The shader does all the
          // work per-pixel:
          //   • Radial alpha falloff (smoothstep)
          //   • FBM noise (4 octaves) for organic texture
          //   • Animated noise drift (smoke breathes)
          //   • Expansion frontier mask
          //   • Per-smoke seed for unique cloud silhouette
          //
          // Pixi v8 compiles the shader program once and shares it
          // across all filter instances; each Filter only carries its
          // own uniform values. Cost: ~1 draw call per smoke vs ~300
          // before (50 puffs × 6 layers).
          //
          // The wall mask on the nadeAreas container still applies,
          // so smokes still clip against map geometry.
          const expires = e.expiresAt ?? (detonateT + 18);
          const totalDur = expires - detonateT;
          const dissipate = sinceDetonate > totalDur - 2
            ? Math.max(0, 1 - (sinceDetonate - (totalDur - 2)) / 2)
            : 1;
          const r = baseR;
          // Expansion: 0 → 1 over 1.2 s with easeOutCubic. The shader
          // interprets this as the frontier radius (0 = nothing
          // visible, 1 = fully deployed).
          const bloomProgress = easeOutCubic(Math.min(1, sinceDetonate / 1.2));
          // Per-event seed (stable, unique)
          const seed = (e.t * 13.37 + (e.player?.length ?? 1) * 7.31);

          // Pool key — one Mesh per smoke event. The shader-version
          // tag forces HMR / hot-reload to evict stale meshes via the
          // unused-key cleanup pass below.
          const spriteKey = `nade-smoke-v15-${e.t}-${e.player ?? "?"}`;
          let smokeMesh = smokeSpritePoolRef.current.get(spriteKey);
          if (!smokeMesh) {
            // Pass the wall-mask texture source so the shader can do
            // per-puff wall sampling. Fall back to a white texture if
            // the mask isn't loaded yet.
            const wallTex =
              wallMaskSpriteRef.current?.texture ?? Texture.WHITE;
            smokeMesh = createSmokeMesh(wallTex.source);
            ls.nadeAreas.addChild(smokeMesh);
            smokeSpritePoolRef.current.set(spriteKey, smokeMesh);
          } else if (smokeMesh.parent !== ls.nadeAreas) {
            ls.nadeAreas.addChild(smokeMesh);
          }
          usedKeys.add(`__smoke_${spriteKey}`);

          // Mesh quad spans [-0.5, +0.5] in its local space; the
          // ``updateSmokeMesh`` helper scales it by spriteSize and
          // moves it to the smoke world position.
          //
          // v13 layout: outermost ring of puffs sits at mesh-local
          // 0.44, with puff radius 0.135 → cluster reaches ~0.575
          // mesh-local. With ``spriteSize = r * 2.0`` that maps to
          // ~1.15 r world units — the visual smoke covers the full
          // defined CS2 radius (120 u) and the soft puff edges feather
          // out a touch beyond it, matching the cs2.cam reference
          // where the bounding box reads as "the official smoke size".
          const spriteSize = r * 2.0;

          // ---- HE-in-smoke "hole" detection (CS2 mechanic, v15) ----
          //
          // Walk pastEvents for any HE that detonated within the last
          // 2.5 s AND whose centre lands inside (or close to) this
          // smoke. If found, animate a 3-phase hole:
          //
          //   0.00 → 0.40 s   rapid expand        (radius + strength up)
          //   0.40 → 1.50 s   hold open           (strength = 1)
          //   1.50 → 2.50 s   smoke re-forms      (strength → 0, radius shrinks)
          //
          // If multiple HEs hit the same smoke, use the one with the
          // strongest current effect — clean and rarely matters in
          // real demos (two HEs back-to-back inside a single smoke is
          // unusual).
          //
          // Radius and overlap distance use real CS2 numbers:
          //   - HE blast radius:                  ~96  u
          //   - Smoke visual radius (we use):    ~120  u
          //   - HE counts as "inside" the smoke:  dist < smoke_r + he_r * 0.4
          //
          // Max hole radius scales with HE CENTRALITY:
          //
          //   centrality = clamp(1 - heDistFromSmoke / smoke_r, 0, 1)
          //               = 1 when HE is dead-centre, 0 at the edge
          //
          //   maxHoleR   = smoke_r * (0.6 + centrality * 1.8)
          //
          // Dead centre  → 2.4 × smoke_r = 288 u  ⇒  ENTIRE smoke is
          //                                          inside the hole's
          //                                          falloff range and
          //                                          fully disappears.
          // Edge         → 0.6 × smoke_r =  72 u  ⇒  small poke at
          //                                          the HE side, rest
          //                                          of smoke intact.
          //
          // Matches the cs2.cam reference: when an HE lands inside the
          // smoke the cloud reads as completely "broken" during the
          // hold phase rather than leaving a visible residual ring.
          const HE_BLAST_RADIUS_WORLD = 96;
          const SMOKE_RADIUS_WORLD = 120;
          const HE_HOLE_TOTAL = 2.5;
          let hole: { centerX: number; centerY: number; radius: number; strength: number } | null = null;
          let bestHoleStrength = 0;
          // Effective bloom passed to the shader. Normally equals the
          // smoke's own detonate-bloom progress (frozen at 1 after
          // ~1.2 s). During Phase 3 of an HE-induced break, an HE may
          // override this to a lower value so the smoke visibly
          // regrows from its centre instead of popping back in all at
          // once. We collect the LOWEST rebloom across active phase-3
          // HEs (= strongest re-animation) so the smoke regrowth
          // matches the most-recent disruption.
          let effectiveBloom = bloomProgress;
          for (const o of pastEvents) {
            if (o === e) continue;
            if (o.type !== "grenade_thrown" || o.subtype !== "he") continue;
            const oDetT = o.detonatedAt ?? o.t;
            const sinceHe = currentTime - oDetT;
            if (sinceHe < 0 || sinceHe > HE_HOLE_TOTAL) continue;
            // Overlap check — HE must land inside or right next to the
            // smoke. Multiplier 0.4 lets HEs that JUST clip the edge
            // open the smoke partially, matching the CS2 feel where
            // edge-detonating HEs still poke a hole.
            const dx = (o.x ?? 0) - (e.x ?? 0);
            const dy = (o.y ?? 0) - (e.y ?? 0);
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > SMOKE_RADIUS_WORLD + HE_BLAST_RADIUS_WORLD * 0.4) continue;

            // Centrality 0..1 — how close the HE is to the smoke
            // centre. Drives the hole's max radius below.
            const centrality = Math.max(
              0,
              Math.min(1, 1 - dist / SMOKE_RADIUS_WORLD),
            );
            const maxRadius = SMOKE_RADIUS_WORLD * (0.6 + centrality * 1.8);

            // Compute the animated hole radius + strength for this HE.
            let curRadius: number;
            let curStrength: number;
            if (sinceHe < 0.4) {
              // Phase 1: rapid expand (easeOutQuart)
              const t = sinceHe / 0.4;
              const eased = 1 - Math.pow(1 - t, 4);
              curRadius = eased * maxRadius;
              curStrength = eased;
            } else if (sinceHe < 1.5) {
              // Phase 2: hold open
              curRadius = maxRadius;
              curStrength = 1;
            } else {
              // Phase 3: smoke re-forms.
              //
              // Two simultaneous animations make the regrowth read
              // organically instead of popping back in:
              //
              //   1. Hole strength fades 1 → 0 over 1 s — puffs in the
              //      hole zone gradually return to their full opacity.
              //
              //   2. The smoke's own bloom mask is OVERRIDDEN to 0 →
              //      1 (easeOutCubic) — the smoke visibly grows back
              //      from its centre outward instead of all puffs
              //      becoming visible at once. This is the same
              //      mechanism the smoke uses for its initial
              //      detonate-bloom; reusing it for the rebirth makes
              //      the regrowth feel consistent with the rest of
              //      the smoke's life cycle.
              //
              // At t=0: strength=1 + rebloom=0 ⇒ smoke fully invisible.
              // At t=1: strength=0 + rebloom=1 ⇒ smoke at full visibility.
              // In between: smoke regrows in size AND in opacity.
              const t = (sinceHe - 1.5) / 1.0;
              curRadius = maxRadius;
              curStrength = Math.max(0, 1 - t);
              const rebloom = 1 - Math.pow(1 - t, 3);  // easeOutCubic
              effectiveBloom = Math.min(effectiveBloom, rebloom);
            }
            if (curStrength > bestHoleStrength) {
              bestHoleStrength = curStrength;
              hole = {
                centerX: project(o.x ?? 0, o.y ?? 0).cx,
                centerY: project(o.x ?? 0, o.y ?? 0).cy,
                radius: projectScalar(curRadius),
                strength: curStrength,
              };
            }
          }

          updateSmokeMesh(
            smokeMesh,
            currentTime,
            effectiveBloom,
            dissipate,
            seed,
            p.cx,
            p.cy,
            spriteSize,
            radarSize,
            hole,
          );
        } else if (e.subtype === "molotov") {
          if (e.expiresAt === undefined || e.expiresAt <= currentTime) continue;
          // ================================================================
          // GPU-rendered molotov / incendiary via the custom Mesh shader.
          //
          // Real CS2 grenade behaviour (preserved):
          //   • Molotov (T, $400):     7.0 s burn, wider spread
          //   • Incendiary (CT, $600): 5.5 s burn, tighter spread
          //
          // The shader handles ALL the visual work per-pixel:
          //   • Deterministic 22-puff cluster (1 centre + 6 + 7 + 8 rings)
          //   • Per-puff smooth 4-stop radial gradient (ember → core → body → outer)
          //   • Animated flicker via sin(uTime + phase)
          //   • Additive emissive accumulation + Reinhard tone-mapping
          //   • Wall-mask sampling per puff (flames clip to walkable geo)
          //
          // Two draw calls per fire (vs ~50 Graphics fills before),
          // and the look is closer to real CS2 inferno.
          //
          // SMOKE EXTINGUISH (CS2 mechanic):
          // A smoke detonating over an active molotov/incendiary
          // extinguishes it. We walk the past-events list looking
          // for any active smoke whose coverage radius overlaps the
          // fire centre — if found, we ramp a 0→1 extinguish factor
          // over ~1.0 s and multiply it into the burnout. When it
          // reaches 1, the molotov fades to alpha 0 and is skipped.
          // Matches the visible behaviour in CS2.cam reference clips
          // where smokes thrown over molotovs cancel the fire.
          // ================================================================
          // Prefer the parser-supplied weaponType (derived from the actual
          // grenade entity in the demo file) over team-based inference —
          // team orientation detection can be off on some demos, which
          // would swap the CT incendiary and TT molotov visuals.
          const isIncendiary =
            e.weaponType !== undefined
              ? e.weaponType === "incgrenade"
              : e.team === "ct";
          const FIRE_LIFETIME = isIncendiary ? 5.5 : 7.0;
          const SPREAD_DURATION = 0.8;
          const expires = e.expiresAt ?? (detonateT + FIRE_LIFETIME);
          const totalDur = expires - detonateT;
          // Burnout: cluster dims to 0 over the last 1.5 s of life.
          const burnout = sinceDetonate > totalDur - 1.5
            ? Math.max(0, 1 - (sinceDetonate - (totalDur - 1.5)) / 1.5)
            : 1;

          // ---- Smoke-extinguishes-molotov detection ----------------
          //
          // Active smoke = detonated, not yet expired, AND fully
          // deployed (after ~0.6 s of bloom). The smoke's effective
          // cover radius is the CS2 144 u vision-blocker radius
          // projected to radar pixels (we already used 120 u for the
          // visual core — match that here so the gameplay-relevant
          // check uses the same radius as the cluster the user sees).
          //
          // If the smoke centre is within ``smokeR + fireR * 0.6`` of
          // the fire centre, we treat the fire as being extinguished.
          // ``0.6`` instead of ``1.0`` so a smoke that only clips the
          // edge of the fire doesn't kill the entire molotov visual.
          let extinguish = 0;
          const SMOKE_COVER_RADIUS_WORLD = 120;
          const FIRE_RADIUS_WORLD = isIncendiary ? 100 : 130;
          for (const o of pastEvents) {
            if (o === e) continue;
            if (o.type !== "grenade_thrown" || o.subtype !== "smoke") continue;
            if (o.expiresAt === undefined || o.expiresAt <= currentTime) continue;
            const oDetT = o.detonatedAt ?? o.t;
            const oSince = currentTime - oDetT;
            // Smoke needs ~0.6 s to bloom before it actually blocks
            // anything in CS2; fire only extinguishes once the cloud
            // has formed.
            if (oSince < 0.6) continue;
            const dx = (o.x ?? 0) - (e.x ?? 0);
            const dy = (o.y ?? 0) - (e.y ?? 0);
            const dist = Math.sqrt(dx * dx + dy * dy);
            const overlapDist = SMOKE_COVER_RADIUS_WORLD + FIRE_RADIUS_WORLD * 0.6;
            if (dist > overlapDist) continue;
            // Ramp extinguish 0 → 1 over 1.0 s starting from when the
            // smoke fully bloomed. Even with several smokes covering,
            // take the maximum extinguish (one smoke is enough to
            // kill the fire).
            const cover = Math.min(1, (oSince - 0.6) / 1.0);
            extinguish = Math.max(extinguish, cover);
          }
          // Fully extinguished — skip rendering entirely. We still
          // keep the mesh in the pool so the cleanup pass evicts it
          // naturally; just don't update its uniforms.
          if (extinguish >= 1) continue;
          const effectiveBurnout = burnout * (1 - extinguish);

          // ---- Patch-driven render (preferred when present) -------
          //
          // ``e.patches`` carries the actual ``inferno_startburn``
          // positions the engine recorded as the fire spread. Each
          // entry is one fire patch on the ground at world (x,y)
          // starting at relative time ``t``. We draw one fire blob
          // per patch at the demo-recorded position so the molotov
          // visual matches the REAL spread pattern of that throw
          // instead of a hard-coded geometric cluster.
          //
          // Falls through to the shader render below when patches
          // are missing — older demos parsed before the patch
          // extraction landed simply lose the spread fidelity but
          // keep rendering.
          if (e.patches && e.patches.length > 0) {
            const patchG = getGfx(
              `nade-molotov-patches-${e.t}-${e.player ?? "?"}`,
              ls.nadeAreas,
            );
            const PATCH_LIFETIME = FIRE_LIFETIME;
            // One filled circle per patch, all in the same flat
            // orange. Overlapping patches form a single continuous
            // amorphous blob (per user reference: "color naranja
            // plano q se expande con la información real").
            //
            // Removed from the previous render: per-puff 4-stop
            // radial gradient (ember/core/body/outer), per-patch
            // alpha + radius flicker, unifying centroid halo. Those
            // gave a "live fire" feel but didn't match the flat
            // silhouette the user asked for. Visual is now purely
            // "the union of where the demo says the fire is".
            //
            // Per-patch render radius keyed to the realistic CS2
            // visible-fire extent (~120-140 wu total radius). The
            // previous 85 wu render combined with patches placed up
            // to 95 wu from centre put the bounding extent at ~180
            // wu — about 40 % bigger than the actual in-game fire,
            // which the user called out as "se expande demasiado".
            // Pulling the render down to 40-45 wu + the parser's
            // tighter synthesis (12-65 wu patch positions) brings
            // the bounding to ~110 wu, matching CS2's real flame
            // extent. T molotov sits a touch wider than CT
            // incendiary in the actual game so we mirror that.
            // Per-patch render radius in world units.
            // CS2's real fire extent is ~120-130 wu for TT molotov and
            // ~100-110 wu for CT incendiary. The synthetic patches are
            // spread up to 62 wu from centre (backend augmentation);
            // patchR adds on top of that, giving a total visual extent
            // of ~patchR + 62. Keeping patchR at 38/42 lands us at
            // 100/104 wu — inside the real-game range and not bloated.
            const patchR = projectScalar(isIncendiary ? 38 : 42);
            // Colour palette per grenade type.
            // CT incendiary: slightly brighter, cleaner orange.
            // T molotov:     deeper, more reddish orange.
            const colBody = isIncendiary ? 0xd47020 : 0xc03810;
            const colCore = isIncendiary ? 0xf09030 : 0xef6820;
            const colHot  = 0xffe060;

            for (const patch of e.patches) {
              const patchAge = currentTime - patch.t;
              if (patchAge < 0) continue;
              if (patchAge > PATCH_LIFETIME) continue;

              // ── Expansion ──────────────────────────────────────────
              // Each patch grows from 0 → full radius over 0.60 s
              // (easeOutQuart). The backend now orders synthetic patches
              // by distance from centre (inner first), so the per-patch
              // expansion timings combine with patch timestamps to
              // produce a visible "fire spreading outward from impact"
              // effect that mirrors real CS2 flame behaviour.
              const expandT      = Math.min(1, patchAge / 0.60);
              const expandFactor = 1 - Math.pow(1 - expandT, 4);
              const curR         = patchR * expandFactor;
              if (curR < 0.5) continue;

              // ── End-of-life fade ────────────────────────────────────
              const patchFade =
                patchAge > PATCH_LIFETIME - 1.5
                  ? Math.max(0, 1 - (patchAge - (PATCH_LIFETIME - 1.5)) / 1.5)
                  : 1;
              const baseAlpha = patchFade * effectiveBurnout;
              if (baseAlpha < 0.02) continue;

              // ── Per-patch flicker ───────────────────────────────────
              // Keyed on world position + time so adjacent patches are
              // out of phase — the fire "breathes" organically.
              const flicker =
                0.82 + Math.sin(currentTime * 10.7 + patch.x * 0.08 + patch.y * 0.11) * 0.18;

              const pp = project(patch.x, patch.y);

              // Layer 1 — main fire body (no external halo; the overlap
              //           of adjacent patches provides density naturally).
              patchG
                .circle(pp.cx, pp.cy, curR)
                .fill({ color: colBody, alpha: baseAlpha * 0.90 * flicker });
              // Layer 2 — bright inner core.
              patchG
                .circle(pp.cx, pp.cy, curR * 0.58)
                .fill({ color: colCore, alpha: baseAlpha * 0.80 * flicker });
              // Layer 3 — hot yellow-white tip.
              patchG
                .circle(pp.cx, pp.cy, curR * 0.25)
                .fill({ color: colHot, alpha: baseAlpha * 0.60 * flicker });
            }
            // Skip the shader render — the patches ARE the visual.
            continue;
          }

          const r = baseR;
          const seed = (e.t * 13.37 + (e.player?.length ?? 1) * 7.31);

          // Spread frontier 0 → 1 over SPREAD_DURATION (easeOutCubic).
          const spread = easeOutCubic(
            Math.min(1, sinceDetonate / SPREAD_DURATION),
          );

          // Pool key — versioned so the next shader rev evicts stale
          // meshes via the unused-key cleanup pass below.
          const fireKey = `nade-molotov-v4-${e.t}-${e.player ?? "?"}-${e.team ?? "?"}`;
          let molotovMesh = molotovSpritePoolRef.current.get(fireKey);
          if (!molotovMesh) {
            const wallTex =
              wallMaskSpriteRef.current?.texture ?? Texture.WHITE;
            molotovMesh = createMolotovMesh(wallTex.source);
            ls.nadeAreas.addChild(molotovMesh);
            molotovSpritePoolRef.current.set(fireKey, molotovMesh);
          } else if (molotovMesh.parent !== ls.nadeAreas) {
            ls.nadeAreas.addChild(molotovMesh);
          }
          usedKeys.add(`__molotov_${fireKey}`);

          // Mesh covers the full fire spread radius. The same r * 2.0
          // scaling as the smoke means the outer ring puffs land at
          // ~1.15 r world units — visually the fire fills the CS2
          // inferno radius (130 u) with soft edges feathering beyond.
          const spriteSize = r * 2.0;
          const palette = isIncendiary
            ? MOLOTOV_PALETTE.ct
            : MOLOTOV_PALETTE.t;
          updateMolotovMesh(
            molotovMesh,
            currentTime,
            spread,
            effectiveBurnout,
            seed,
            p.cx,
            p.cy,
            spriteSize,
            radarSize,
            palette,
          );
        } else if (e.subtype === "flash") {
          // Soft white-gray sphere with bright white-hot core.
          // Total visible duration ~0.5 s — CS2's actual flash
          // detonation is essentially instantaneous (80-150 ms
          // before the bright pop subsides), the previous 2.2 s
          // visual felt sluggish compared to the in-game pop.
          //
          // Phases:
          //   0.00-0.06 s : rapid radial expansion (easeOutQuart)
          //   0.06-0.15 s : peak intensity hold (hot core glares)
          //   0.15-0.50 s : quick radial fade
          //
          // Five concentric layers stacked back-to-front create the
          // gradient bowl from soft gray edges to incandescent
          // white centre, without needing actual radial-gradient
          // fills (which Pixi v8 Graphics doesn't expose directly).
          if (sinceDetonate > 0.5) continue;
          const t = sinceDetonate;
          const expand = easeOutQuart(Math.min(1, t / 0.06));
          const flashR = projectScalar(620) * expand;
          // Overall life envelope — plateau through 0.15 s then a
          // fast 0.35 s tail. Multiplies into every layer's alpha
          // so the whole sphere fades together quickly.
          const lifeFade = t < 0.15 ? 1 : Math.max(0, 1 - (t - 0.15) / 0.35);

          // Layer 1 — wide soft halo (atmosphere). Light blue-gray
          // tint differentiates it from a smoke at a glance.
          g.circle(p.cx, p.cy, flashR * 1.18).fill({
            color: 0xb8c4d0, alpha: lifeFade * 0.18,
          });
          // Layer 2 — mid sphere (soft gray bowl).
          g.circle(p.cx, p.cy, flashR * 0.85).fill({
            color: 0xd0d8e0, alpha: lifeFade * 0.36,
          });
          // Layer 3 — inner near-white mass.
          g.circle(p.cx, p.cy, flashR * 0.55).fill({
            color: 0xeef1f5, alpha: lifeFade * 0.60,
          });
          // Layer 4 — hot white core. Independent fade so the
          // bright centre quenches faster than the soft halo,
          // matching the way a real flashbang dims from the inside
          // out.
          const coreFade = t < 0.08 ? 1 : Math.max(0, 1 - (t - 0.08) / 0.30);
          g.circle(p.cx, p.cy, flashR * 0.30).fill({
            color: 0xffffff, alpha: coreFade * 0.95,
          });
          // Layer 5 — ultra-bright bulb. Only visible during peak.
          if (t < 0.20) {
            const bulbFade = t < 0.05 ? 1 : Math.max(0, 1 - (t - 0.05) / 0.15);
            g.circle(p.cx, p.cy, flashR * 0.12).fill({
              color: 0xffffff, alpha: bulbFade,
            });
          }
        } else if (e.subtype === "he") {
          // HE shockwave — expanding ring over ~0.6s after detonate.
          if (sinceDetonate > 1.0) continue;
          const t = sinceDetonate;
          const ringR = projectScalar(360) * Math.min(1, t / 0.5);
          const alpha = Math.max(0, 1 - t);
          g.circle(p.cx, p.cy, ringR)
            .stroke({ color: COLOR_HE, alpha: alpha * 0.9, width: 3 });
          g.circle(p.cx, p.cy, ringR * 0.7)
            .stroke({ color: 0xffd166, alpha: alpha * 0.7, width: 1.5 });
          g.circle(p.cx, p.cy, Math.max(2, projectScalar(40) * (1 - t)))
            .fill({ color: 0xffe066, alpha: alpha });
        }
      }
    }

    // Grenade trajectory tracers — comet-style trail that grows as the
    // projectile flies and has a bright glowing head. Three layers per
    // trail: wide soft glow underlay, mid-width main stroke, bright
    // head at the projectile's current position. The head pulses
    // during flight and fades after detonation.
    //
    // Ghost-tracer guard: real CS2 grenades fly for at most ~2-3 s.
    // Some demos emit grenade_thrown events where ``detonatedAt`` is
    // missing, garbage, or way in the future — those produced a
    // permanent "phantom" line on the radar because the trail's
    // ``sinceDetonate > 1.5`` skip check could never fire while
    // ``detonateT`` stayed in the far future. Two extra guards:
    //
    //   1. Cap ``flightDur`` at 5 s. Anything longer is parser noise;
    //      we collapse the trail to (throwT, throwT + 5) so the
    //      sinceDetonate-based fade still applies eventually.
    //   2. Hard-skip the event entirely when ``sinceThrow`` exceeds
    //      MAX_TRAIL_LIFE (5 s flight + 1.5 s lingering = 6.5 s). No
    //      legitimate grenade trail should be on screen past that.
    const MAX_GRENADE_FLIGHT = 5.0;
    const MAX_TRAIL_LIFE = MAX_GRENADE_FLIGHT + 1.5;
    if (layers.grenades) {
      for (const e of pastEvents) {
        if (e.type !== "grenade_thrown") continue;
        if (e.throwerX === undefined || e.throwerY === undefined) continue;
        const throwT = e.t;
        const rawDetonateT = e.detonatedAt ?? e.t;
        // Clamp into the sane (throw, throw + MAX_FLIGHT] window so a
        // malformed event can't claim to still be in flight forever.
        const detonateT = Math.min(
          Math.max(rawDetonateT, throwT),
          throwT + MAX_GRENADE_FLIGHT,
        );
        const flightDur = Math.max(0.001, detonateT - throwT);
        const sinceThrow = currentTime - throwT;
        const sinceDetonate = currentTime - detonateT;
        // Trail lingers 1.5 s after impact so the eye can follow where
        // the projectile came from even after it lands. Also hard-cap
        // by ``sinceThrow`` so the ghost-tracer bug stays fixed even
        // if a future change re-introduces a way for ``sinceDetonate``
        // to stay stuck low.
        if (sinceThrow < 0 || sinceThrow > MAX_TRAIL_LIFE) continue;
        if (sinceDetonate > 1.5) continue;

        // Defensive sanity check: reject trajectories whose last
        // sample is too far from the event's landing (``e.x`` /
        // ``e.y``). When the parser's trajectory-matcher
        // accidentally pairs an inferno with the wrong projectile
        // (a smoke / HE / flash from the same player landing
        // nearby), the cross-matched trajectory ends FAR from
        // the actual molotov / smoke impact and the renderer
        // draws a long ghost line across the map — the user's
        // "tracer random" complaint. 250 wu is a generous
        // tolerance: real projectile landing is usually within
        // 30-50 wu of the recorded ``e.x/y`` (slight bounce or
        // sub-tick timing), so any trajectory ending 250+ wu
        // away is almost certainly a mis-match.
        if (
          e.trajectory &&
          e.trajectory.length >= 1 &&
          e.x !== undefined &&
          e.y !== undefined
        ) {
          const lastPt = e.trajectory[e.trajectory.length - 1];
          const dx = lastPt.x - e.x;
          const dy = lastPt.y - e.y;
          if (dx * dx + dy * dy > 250 * 250) {
            // Trajectory is suspicious — skip the curve and the
            // thrower-anchored line. The grenade's own area
            // visual (smoke cloud / molotov fire / flash burst)
            // still renders at e.x/y because that uses the
            // landing point directly.
            continue;
          }
        }

        // Distinct palette per grenade type for instant ID.
        let trailColor: number, glowColor: number, headColor: number;
        if (e.subtype === "smoke") {
          trailColor = 0xb8bcc4;
          glowColor = 0xe0e2e6;
          headColor = 0xffffff;
        } else if (e.subtype === "flash") {
          trailColor = 0xffe066;
          glowColor = 0xfff5a0;
          headColor = 0xffffff;
        } else if (e.subtype === "molotov") {
          trailColor = 0xff7a2a;
          glowColor = 0xffb347;
          headColor = 0xfff0a0;
        } else {
          // HE
          trailColor = 0xff5d3a;
          glowColor = 0xff8866;
          headColor = 0xffd166;
        }
        // Fade after detonate.
        const fade = sinceDetonate <= 0
          ? 1.0
          : Math.max(0, 1 - sinceDetonate / 1.5);
        const baseAlpha = 0.9 * fade;
        const glowAlpha = 0.35 * fade;

        const trajKey = `nade-traj-${e.t}-${e.player ?? "?"}-${e.subtype ?? "?"}`;
        const g = getGfx(trajKey, ls.killLines);
        const start = project(e.throwerX, e.throwerY);

        // Build the visible point list. The trick is to make the
        // HEAD move smoothly — the projectile's screen position must
        // be a continuous function of ``currentTime``, not a series
        // of jumps from one decimated trajectory sample to the next.
        //
        // Real trajectory data (e.trajectory) is sparse (~20 samples
        // along the path = a sample every 50-100 ms). If we just
        // appended each sample as currentTime crossed its ``t``, the
        // head would tele-jump every sample interval — that's the
        // "tirones" the user complained about.
        //
        // We instead: include every sample whose ``t`` is in the past,
        // THEN add one final point that is the linear interpolation
        // between the last past-sample and the first future-sample at
        // exactly currentTime. The trail draws all sparse samples;
        // the head sits exactly where the projectile is in real time.
        const pts: { cx: number; cy: number }[] = [start];
        if (e.trajectory && e.trajectory.length >= 2) {
          let nextIdx = -1;
          for (let i = 0; i < e.trajectory.length; i++) {
            const pt = e.trajectory[i];
            if (pt.t > currentTime) {
              nextIdx = i;
              break;
            }
            pts.push(project(pt.x, pt.y));
          }
          // Interpolate between the last past-sample and the next
          // future-sample so the head moves smoothly.
          if (nextIdx > 0 && pts.length > 1) {
            const prev = e.trajectory[nextIdx - 1];
            const next = e.trajectory[nextIdx];
            const span = Math.max(0.0001, next.t - prev.t);
            const alpha = Math.max(0, Math.min(1, (currentTime - prev.t) / span));
            const interpX = prev.x + (next.x - prev.x) * alpha;
            const interpY = prev.y + (next.y - prev.y) * alpha;
            pts.push(project(interpX, interpY));
          } else if (nextIdx === 0) {
            // currentTime is BEFORE the first trajectory sample —
            // interpolate between the thrower position and the first
            // sample so the head emerges smoothly from the player.
            const first = e.trajectory[0];
            const span = Math.max(0.0001, first.t - throwT);
            const alpha = Math.max(0, Math.min(1, (currentTime - throwT) / span));
            // Use the thrower world coords (we have only the projected
            // ``start``, so interpolate in screen space — close enough
            // at this scale).
            const firstProj = project(first.x, first.y);
            pts.push({
              cx: start.cx + (firstProj.cx - start.cx) * alpha,
              cy: start.cy + (firstProj.cy - start.cy) * alpha,
            });
          }
        } else {
          // No real trajectory data — straight line from thrower to
          // landing point, animated by flight progress.
          //
          // A previous version added a perpendicular Bezier bend to
          // make this look "arc-ish". That's WRONG for a top-down
          // view: in 2D the projectile's XY path is essentially a
          // straight line (the parabolic arc is in the Z axis which
          // we don't render). A fake side-bend looked nicer but
          // visibly broke from the real flight path. Straight line
          // matches reality — the user pointed out that the previous
          // arc "muchas veces no respeta la trayectoria real".
          const b = project(e.x ?? 0, e.y ?? 0);
          const progress = Math.min(1, sinceThrow / flightDur);
          // Add a handful of intermediate points so the leader-stroke
          // gradient still has segments to operate on.
          const samples = 8;
          for (let i = 1; i <= samples; i++) {
            const t = (i / samples) * progress;
            pts.push({
              cx: start.cx + (b.cx - start.cx) * t,
              cy: start.cy + (b.cy - start.cy) * t,
            });
          }
        }
        if (pts.length < 2) continue;

        // ---- Layer 1: wide soft glow ----
        // Slightly slimmer + dimmer than the original (was width 5.5,
        // glowAlpha 0.35 × fade) so the utility icon at the head
        // reads as the primary signal and the line as supporting
        // context. Still wide enough to feel like a trail and not
        // a hairline.
        g.moveTo(pts[0].cx, pts[0].cy);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].cx, pts[i].cy);
        g.stroke({ color: glowColor, alpha: glowAlpha * 0.7, width: 3.5, cap: "round", join: "round" });

        // ---- Layer 2: main trail (segments with alpha gradient) ----
        // Older segments get progressively transparent, like a comet tail.
        for (let i = 1; i < pts.length; i++) {
          const segPos = (i - 1) / Math.max(1, pts.length - 2);  // 0..1 along trail
          const segAlpha = baseAlpha * (0.25 + 0.75 * segPos);
          const segWidth = 1.3 + segPos * 1.2;  // thicker near head
          const sub = new Graphics();
          sub.moveTo(pts[i - 1].cx, pts[i - 1].cy)
            .lineTo(pts[i].cx, pts[i].cy)
            .stroke({ color: trailColor, alpha: segAlpha, width: segWidth, cap: "round" });
          // Add into the same parent graphics — Pixi v8 doesn't have
          // additive segments by default, so we use mini sub-graphics.
          // Cheaper alternative: just stroke the full line at full alpha
          // with the gradient effect simulated by overlapping. We'll do
          // overlap instead — render the whole line at low alpha THEN
          // overlay the leading N segments at progressively higher alpha.
          sub.destroy();
        }
        // Pixi.Graphics doesn't natively support per-segment alpha, so
        // simulate gradient: draw progressively shorter "leader" lines
        // at higher alpha over the base.
        const leaderSteps = 4;
        for (let k = 1; k <= leaderSteps; k++) {
          const startIdx = Math.max(0, pts.length - 1 - Math.ceil((pts.length - 1) * (k / leaderSteps)));
          g.moveTo(pts[startIdx].cx, pts[startIdx].cy);
          for (let i = startIdx + 1; i < pts.length; i++) g.lineTo(pts[i].cx, pts[i].cy);
          g.stroke({
            color: trailColor,
            alpha: baseAlpha * (k / leaderSteps) * 0.55,
            width: 1.6 + (k / leaderSteps) * 0.8,
            cap: "round",
            join: "round",
          });
        }

        // ---- Layer 3: thrower origin marker ----
        g.circle(start.cx, start.cy, 3).fill({ color: trailColor, alpha: baseAlpha * 0.6 });
        g.circle(start.cx, start.cy, 1.4).fill({ color: glowColor, alpha: baseAlpha });

        // ---- Layer 4: head — the utility icon itself ----
        //
        // Replaces the previous "3 concentric circles + pulse" head
        // with a Sprite of the actual grenade icon, tinted with the
        // thrower's team colour. Effect: the smoke / flash / HE /
        // molotov visually "draws" its own trajectory line — same
        // metaphor as the in-hand badge, just extended to flight.
        //
        // Sprite is pooled by ``trajKey`` so we don't allocate
        // new GPU resources every frame. The
        // ``UTILITY_WHITE_OUT_FILTER`` normalises whatever colour
        // the source asset shipped with before the per-sprite tint
        // multiplies in the team colour.
        const head = pts[pts.length - 1];
        // Subtype → canonical utility key. The parser uses the same
        // "molotov" subtype for both TT molotovs and CT
        // incendiaries, so we disambiguate by the thrower's team.
        let nadeUtilityKey: string | null = null;
        if (e.subtype === "smoke") nadeUtilityKey = "smokegrenade";
        else if (e.subtype === "flash") nadeUtilityKey = "flashbang";
        else if (e.subtype === "he") nadeUtilityKey = "hegrenade";
        else if (e.subtype === "molotov") {
          // Use the parser-supplied weaponType when available — it is
          // read directly from the demo file's grenade entity and is
          // immune to team-orientation detection errors that can swap
          // CT incendiary and TT molotov.  Fall back to the team field
          // for older demos / stub parser events that lack weaponType.
          nadeUtilityKey =
            e.weaponType !== undefined
              ? e.weaponType                          // "incgrenade" | "molotov"
              : e.team === "ct" ? "incgrenade" : "molotov";
        }

        let nadeHeadSprite = nadeHeadSpritePoolRef.current.get(trajKey);
        if (!nadeHeadSprite) {
          nadeHeadSprite = new Sprite(Texture.EMPTY);
          nadeHeadSprite.anchor.set(0.5, 0.5);
          // Same white-out + tint pipeline the in-hand badge uses,
          // so the icon comes out solid team colour regardless of
          // whether the underlying file is a coloured webp or a
          // monochrome svg.
          nadeHeadSprite.filters = [UTILITY_WHITE_OUT_FILTER];
          nadeHeadSpritePoolRef.current.set(trajKey, nadeHeadSprite);
          ls.killLines.addChild(nadeHeadSprite);
        }
        usedKeys.add(`__nadehead_${trajKey}`);

        const nadeTex = nadeUtilityKey ? getUtilityTexture(nadeUtilityKey) : null;
        // Team-colour tint for the head sprite. Falls back to white
        // when the thrower's team isn't on the event (rare; older
        // demos), which renders neutral white and still reads.
        const throwerTeamColor =
          e.team === "ct" ? TEAM_COLOR_CT : e.team === "tt" ? TEAM_COLOR_TT : 0xffffff;

        if (nadeTex && sinceDetonate <= 0) {
          // In-flight: ride the trajectory head, gentle pulse so
          // the eye picks up motion even when the projectile is
          // briefly stationary on the radar.
          const pulse = 1 + Math.sin(currentTime * 12) * 0.10;
          const targetSize = 20; // px — slightly bigger than the
          //                       in-hand badge so the trajectory
          //                       reads as the primary action.
          const fit = Math.min(
            targetSize / Math.max(1, nadeTex.width),
            targetSize / Math.max(1, nadeTex.height),
          );
          nadeHeadSprite.texture = nadeTex;
          nadeHeadSprite.scale.set(fit * pulse);
          nadeHeadSprite.position.set(head.cx, head.cy);
          nadeHeadSprite.tint = throwerTeamColor;
          nadeHeadSprite.alpha = Math.min(1, baseAlpha + 0.1);
          nadeHeadSprite.visible = true;
        } else if (nadeTex && sinceDetonate > 0) {
          // Post-impact: fade the icon out as the trail itself
          // fades. Once sinceDetonate exceeds 0.5 s we hide
          // entirely — the trail's own fade carries from there.
          const headFade = Math.max(0, 1 - sinceDetonate / 0.5);
          if (headFade > 0) {
            const targetSize = 20;
            const fit = Math.min(
              targetSize / Math.max(1, nadeTex.width),
              targetSize / Math.max(1, nadeTex.height),
            );
            nadeHeadSprite.texture = nadeTex;
            nadeHeadSprite.scale.set(fit);
            nadeHeadSprite.position.set(head.cx, head.cy);
            nadeHeadSprite.tint = throwerTeamColor;
            nadeHeadSprite.alpha = headFade * 0.85;
            nadeHeadSprite.visible = true;
          } else {
            nadeHeadSprite.visible = false;
          }
        } else {
          // No texture yet (still loading) or no recognised
          // subtype — keep the sprite hidden, the line still
          // marks the trajectory.
          nadeHeadSprite.visible = false;
        }

        // ---- Layer 5: molotov-specific "sparks" along the trail ----
        if (e.subtype === "molotov" && sinceDetonate < 0) {
          // 3 small sparks at random positions along the tail, animated
          // by currentTime so they look like burning embers.
          for (let i = 0; i < 3; i++) {
            const phase = currentTime * 8 + i * 2.1;
            const t = ((Math.sin(phase) + 1) / 2) * (pts.length - 1);
            const idx = Math.min(pts.length - 1, Math.floor(t));
            const frac = t - idx;
            const a = pts[idx];
            const b = pts[Math.min(pts.length - 1, idx + 1)];
            const sx = a.cx + (b.cx - a.cx) * frac + Math.cos(phase * 2.3) * 2;
            const sy = a.cy + (b.cy - a.cy) * frac + Math.sin(phase * 2.3) * 2;
            const sparkSize = 0.8 + Math.sin(phase * 3) * 0.4;
            g.circle(sx, sy, sparkSize).fill({ color: 0xffe066, alpha: baseAlpha });
          }
        }
      }
    }

    // Shot tracer rays — one short directional line per weapon_fire
    // event. Visibility duration matches the perceptual life of a CS2
    // tracer: the in-game tracer line itself flashes for ~0.1-0.2 s and
    // the bullet-impact decal (``sv_showimpacts_time`` default) is 4 s.
    // We use a 0.8 s window with fast fade so each shot is clearly
    // visible at the moment it happens without leaving a permanent
    // trail that clutters the radar for the rest of the round.
    //
    // Each ray:
    //   • starts at the shooter's position when they fired
    //   • points along their yaw at the shot tick
    //   • has a per-weapon length in WORLD units (pistols snappier,
    //     rifles reachier) so it reads as "direction of fire"
    //   • is COLOURED by the shooter's team
    //   • gets a tiny white muzzle dot at the very start (<0.2 s)
    const SHOT_VISIBLE_S = 0.8;
    // CS2 fires ``weapon_fire`` for every weapon use — INCLUDING
    // grenade throws (smokegrenade, flashbang, hegrenade, molotov,
    // incgrenade, decoy). The shot-ray renderer treated all of them
    // identically, so every grenade throw flashed a bullet tracer
    // from the thrower in their facing direction AT THE MOMENT of
    // the throw — and then the actual grenade trajectory animated
    // along a different (parabolic) path. The two visuals together
    // read as "the player shot somewhere then the grenade went
    // somewhere else" (the user's reported confusion).
    //
    // Filter grenade weapons out of the shot pass. They keep their
    // dedicated trajectory render below; the shot tracer was
    // double-drawing.
    const GRENADE_WEAPON_NAMES = new Set<string>([
      "hegrenade", "he_grenade", "high_explosive", "high_explosive_grenade",
      "highexplosive", "highexplosivegrenade",
      "smokegrenade", "smoke_grenade", "smoke",
      "flashbang", "flash_grenade", "flashgrenade", "flash",
      "molotov", "molotov_grenade", "molotovgrenade",
      "incgrenade", "incendiary", "incendiary_grenade", "incendiarygrenade",
      "inferno", "firegrenade", "firebomb",
      "decoy", "decoy_grenade", "decoygrenade",
    ]);
    if (layers.shots) {
      const shotG = getGfx("shot-rays", ls.shotLines);
      // ``getGfx`` already clear()s the Graphics, so we start fresh.
      for (const e of pastEvents) {
        if (e.type !== "shot") continue;
        if (e.x === undefined || e.y === undefined || e.yaw === undefined) continue;
        const age = currentTime - e.t;
        if (age < 0 || age > SHOT_VISIBLE_S) continue;
        // Skip grenade throws — those have their own trajectory
        // renderer (the curved tracer + projectile head sprite).
        // Drawing a bullet ray for them too produced the
        // "shot-then-grenade-arc-elsewhere" double-visual the
        // user called out.
        const weaponNormShot = (e.weapon || "").toLowerCase().replace(/^weapon_/, "");
        if (
          GRENADE_WEAPON_NAMES.has(weaponNormShot) ||
          weaponNormShot.endsWith("grenade")
        ) continue;

        // Prefer the shot event's PER-TICK team (handles halftime
        // side swap correctly) over the static PlayerStats roster,
        // which always reflects round-1 sides and would invert
        // colours from round 13 onward.
        const shooter = e.shooter ? playerLookup?.get(e.shooter) : undefined;
        const teamAtShot = e.team ?? shooter?.team;
        const color =
          teamAtShot === "ct" ? TEAM_COLOR_CT : teamAtShot === "tt" ? TEAM_COLOR_TT : 0xffffff;

        // Per-weapon ray length so pistols/SMGs look snappier and
        // rifles/snipers look reachier.
        const weapon = (e.weapon || "").toLowerCase();
        let lenWorld = 220;   // default rifle range
        if (weapon.includes("awp") || weapon.includes("scar20") || weapon.includes("g3sg1")) {
          lenWorld = 320;
        } else if (
          weapon.includes("usp") || weapon.includes("glock") || weapon.includes("p250") ||
          weapon.includes("deagle") || weapon.includes("fiveseven") || weapon.includes("tec9") ||
          weapon.includes("cz75") || weapon.includes("dual") || weapon.includes("revolver") ||
          weapon.includes("p2000") || weapon.includes("hkp2000")
        ) {
          lenWorld = 160;
        } else if (weapon.includes("knife")) {
          lenWorld = 70;   // short "swing" indicator
        }

        // World → radar pixels.
        const a = project(e.x, e.y);
        const yawRad = (e.yaw * Math.PI) / 180;
        const dirX = Math.cos(yawRad);
        const dirY = -Math.sin(yawRad);   // y inverted (north = top)
        const lenPx = projectScalar(lenWorld);
        const bx = a.cx + dirX * lenPx;
        const by = a.cy + dirY * lenPx;

        // Alpha curve over the 0.8 s window:
        //   • 0.00 - 0.10 s: hold near-full alpha (~0.95) — the eye
        //     catches the freshly-fired tracer
        //   • 0.10 - 0.80 s: ease-out fade to 0
        let alpha: number;
        if (age < 0.10) {
          alpha = 0.95;
        } else {
          const t = (age - 0.10) / (SHOT_VISIBLE_S - 0.10);
          alpha = 0.95 * (1 - t) * (1 - t);   // quadratic ease-out
        }

        shotG.moveTo(a.cx, a.cy)
          .lineTo(bx, by)
          .stroke({ color, alpha, width: 1.2, cap: "round" });

        // Tiny muzzle dot for the very first 0.20 s — drops off
        // faster than the line itself so the dot doesn't outlive the
        // moment-of-fire signal.
        if (age < 0.20) {
          const dotT = age / 0.20;
          shotG.circle(a.cx, a.cy, 2.4 * (1 - dotT))
            .fill({ color: 0xffffff, alpha: 0.95 * (1 - dotT) });
        }
      }
    }

    // NOTE: kill trajectory arcs (the curved killer → victim lines) were
    // removed at the user's request — the per-shot tracer rays above
    // already convey shooting activity, and the skull marker below
    // marks the death location. The arcs duplicated information and
    // cluttered the radar when several players died around the same
    // chokepoint. The ``killLines`` container is kept (no-op now) so
    // the layer slot remains available if we ever want to re-enable.

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
        const pulse = 1 + Math.sin(currentTime * 5) * 0.25;
        // Outer pulsing red glow — keeps the "this is dangerous"
        // attention signal even with the new sprite on top.
        const g = getGfx("bomb-marker", ls.eventMarkers);
        g.circle(p.cx, p.cy, 22 * pulse).fill({ color: COLOR_BOMB, alpha: 0.18 });
        g.circle(p.cx, p.cy, 14 * pulse).fill({ color: COLOR_BOMB, alpha: 0.32 });
        // C4 sprite. Lazy-loaded — until the texture lands, we leave
        // the sprite at Texture.EMPTY so the glow still reads but the
        // icon pops in cleanly on the next frame once Assets.load
        // resolves. Tinted red so it matches the urgency colour.
        let bombSprite = bombSpriteRef.current;
        if (!bombSprite) {
          bombSprite = new Sprite(Texture.EMPTY);
          bombSprite.anchor.set(0.5, 0.5);
          // Same white-out filter the utility badges use — forces the
          // c4 silhouette to render solid white BEFORE the tint
          // multiplies in, so the final colour is clean red regardless
          // of what colour the upstream SVG happened to ship with.
          bombSprite.filters = [UTILITY_WHITE_OUT_FILTER];
          bombSpriteRef.current = bombSprite;
          ls.eventMarkers.addChild(bombSprite);
        } else if (bombSprite.parent !== ls.eventMarkers) {
          ls.eventMarkers.addChild(bombSprite);
        }
        const bombTex = getBombTexture();
        if (bombTex) {
          if (bombSprite.texture !== bombTex) bombSprite.texture = bombTex;
          // Size the sprite so it fits comfortably inside the inner
          // pulsing glow disc (~14 px radius) without overflowing.
          const targetSize = 22; // px box
          const fit = Math.min(
            targetSize / Math.max(1, bombTex.width),
            targetSize / Math.max(1, bombTex.height),
          );
          bombSprite.scale.set(fit * pulse);
          bombSprite.position.set(p.cx, p.cy);
          bombSprite.tint = COLOR_BOMB;
          bombSprite.alpha = 1;
          bombSprite.visible = true;
        } else {
          bombSprite.visible = false;
        }
        const txt = getText(
          "bomb-label",
          ls.eventMarkers,
          textStyle(10, 0xffffff, 700),
          `BOMB · ${planted.site ?? "?"}`,
        );
        txt.anchor.set(0.5);
        txt.position.set(p.cx, p.cy - 22);
      } else if (bombSpriteRef.current) {
        // Bomb defused / exploded / round reset — hide the sprite.
        bombSpriteRef.current.visible = false;
      }
    }

    // Recent kill skull markers (fade over 6s). Pool keyed by event so
    // we redraw existing Graphics/Text rather than allocating fresh
    // ones each frame.
    if (layers.killMarkers) {
      for (const e of pastEvents) {
        if (e.type !== "kill") continue;
        const age = currentTime - e.t;
        if (age < 0 || age > 6) continue;
        const alpha = 1 - age / 6;
        const p = project(e.x ?? 0, e.y ?? 0);
        const baseKey = `kill-${e.t}-${e.killer ?? "?"}-${e.victim ?? "?"}`;
        // Drop-shadow disc.
        const g = getGfx(`${baseKey}-shadow`, ls.eventMarkers);
        g.circle(p.cx, p.cy + 1, 9).fill({ color: 0x000000, alpha: alpha * 0.45 });

        const skull = getText(
          `${baseKey}-skull`,
          ls.eventMarkers,
          textStyle(13, 0xff5d75, 800, true),
          "✕",
        );
        skull.anchor.set(0.5, 0.5);
        skull.position.set(p.cx, p.cy);
        skull.alpha = alpha;
        // Killer → victim name label removed per user spec — the
        // X alone is the death indicator now. ``playerLookup`` is
        // still imported / referenced elsewhere; if it ever becomes
        // truly unused the linter will flag it.
      }
    }

    // ------ Evict pool entries not used this frame ------
    // Anything that wasn't touched above represents a kill that aged
    // out of the 6 s window / a smoke that expired / a bomb that got
    // defused. Remove it from the scene + destroy so the pool stays
    // bounded.
    gPool.forEach((g, key) => {
      if (!usedKeys.has(key)) {
        g.removeFromParent();
        g.destroy();
        gPool.delete(key);
      }
    });
    tPool.forEach((t, key) => {
      if (!usedKeys.has(key)) {
        t.removeFromParent();
        t.destroy();
        tPool.delete(key);
      }
    });
    // Smoke meshes have their own pool (keyed with `__smoke_` prefix
    // in usedKeys to namespace them away from generic Graphics keys).
    smokeSpritePoolRef.current.forEach((mesh, key) => {
      if (!usedKeys.has(`__smoke_${key}`)) {
        mesh.removeFromParent();
        // Destroy the per-mesh shader so its GL program / uniform
        // buffer is released. The geometry is shared across all
        // smoke meshes so we deliberately do NOT destroy it here.
        try { mesh.shader?.destroy(); } catch { /* */ }
        mesh.destroy();
        smokeSpritePoolRef.current.delete(key);
      }
    });
    // Same cleanup pass for the molotov mesh pool — keyed with
    // ``__molotov_`` prefix so the namespace doesn't collide with
    // smokes or generic Graphics keys.
    molotovSpritePoolRef.current.forEach((mesh, key) => {
      if (!usedKeys.has(`__molotov_${key}`)) {
        mesh.removeFromParent();
        try { mesh.shader?.destroy(); } catch { /* */ }
        mesh.destroy();
        molotovSpritePoolRef.current.delete(key);
      }
    });
    // Grenade tracer-head sprites — sweep the ones whose
    // ``grenade_thrown`` event has aged out (more than 1.5 s past
    // detonate, or scrubbed back before the throw tick). Same
    // pattern as the molotov mesh sweep above.
    nadeHeadSpritePoolRef.current.forEach((sprite, key) => {
      if (!usedKeys.has(`__nadehead_${key}`)) {
        sprite.removeFromParent();
        sprite.destroy();
        nadeHeadSpritePoolRef.current.delete(key);
      }
    });

    // -------------------------------------------------------------------
    // Dropped weapons + grenades on the floor.
    // Each weapon_drop event shows on the radar at the victim's death
    // position until a matching weapon_pickup (or the round ends).
    // -------------------------------------------------------------------
    {
      const drops: Array<{
        key: string;
        x: number;
        y: number;
        weapon: string;
        isGrenade: boolean;
      }> = [];
      // Index past drops + pickups in this round so far
      const dropEvents = pastEvents.filter(
        (e) => e.type === "weapon_drop" && e.t <= currentTime,
      );
      const pickupEvents = pastEvents.filter(
        (e) => e.type === "weapon_pickup" && e.t <= currentTime,
      );
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
      const aliases: Record<string, string[]> = {
        glock18: ["glock"],
        usps: ["uspsilencer", "usp"],
        deserteagle: ["deagle"],
        m4a4: ["m4a1"],
        m4a1s: ["m4a1silencer", "m4a1"],
      };
      const matches = (dropW: string, pickW: string) => {
        const d = norm(dropW);
        const p = norm(pickW);
        if (!d || !p) return false;
        if (d === p) return true;
        if (d.includes(p) || p.includes(d)) return true;
        return (aliases[d] ?? []).includes(p) || (aliases[p] ?? []).includes(d);
      };
      const consumed = new Set<number>();
      const sortedPickups = [...pickupEvents].sort((a, b) => a.t - b.t);
      for (const pu of sortedPickups) {
        const idx = dropEvents.findIndex(
          (d, i) =>
            !consumed.has(i) &&
            d.t <= pu.t &&
            matches(d.weapon ?? "", pu.weapon ?? ""),
        );
        if (idx >= 0) consumed.add(idx);
      }
      dropEvents.forEach((e, i) => {
        if (consumed.has(i)) return;
        drops.push({
          key: `${i}_${e.t}_${e.victim ?? ""}`,
          x: e.x ?? 0,
          y: e.y ?? 0,
          weapon: e.weapon ?? "",
          isGrenade: !!e.isGrenade,
        });
      });

      // Map weapon name → texture (uses existing weapon/utility caches).
      const resolveDropTexture = (
        weaponName: string,
        isGrenade: boolean,
      ): Texture | null => {
        const w = norm(weaponName);
        if (isGrenade || /^(smoke|flash|he|molotov|incendiary|inc|decoy|hegren)/.test(w)) {
          if (w.startsWith("smoke")) return getUtilityTexture("smokegrenade");
          if (w.startsWith("flash")) return getUtilityTexture("flashbang");
          if (w.startsWith("hegren") || w === "he") return getUtilityTexture("hegrenade");
          if (w.startsWith("molotov")) return getUtilityTexture("molotov");
          if (w.startsWith("inc") || w.startsWith("incendiary")) return getUtilityTexture("incgrenade");
          if (w.startsWith("decoy")) return getUtilityTexture("decoy");
        }
        return getWeaponTexture(weaponName);
      };

      const drawnDropKeys = new Set<string>();
      for (const d of drops) {
        const pp = project(d.x, d.y);
        let sprite = dropSpritePoolRef.current.get(d.key);
        if (!sprite) {
          sprite = new Sprite(Texture.EMPTY);
          sprite.anchor.set(0.5, 0.5);
          sprite.filters = [UTILITY_WHITE_OUT_FILTER];
          dropSpritePoolRef.current.set(d.key, sprite);
          ls.killLines.addChild(sprite);
        }
        drawnDropKeys.add(d.key);
        const tex = resolveDropTexture(d.weapon, d.isGrenade);
        if (tex) {
          sprite.texture = tex;
          const target = d.isGrenade ? 14 : 22;
          const fit = Math.min(
            target / Math.max(1, tex.width),
            target / Math.max(1, tex.height),
          );
          sprite.scale.set(fit);
          sprite.position.set(pp.cx, pp.cy);
          sprite.tint = 0xffffff;
          sprite.alpha = 0.85;
          sprite.visible = true;
        } else {
          sprite.visible = false;
        }
      }
      // Sweep stale drops
      dropSpritePoolRef.current.forEach((sprite, key) => {
        if (!drawnDropKeys.has(key)) {
          sprite.removeFromParent();
          sprite.destroy();
          dropSpritePoolRef.current.delete(key);
        }
      });
    }

    // Players — diff against existing nodes; reuse where possible
    const seen = new Set<string>();
    if (frame) {
      for (const p of frame.players) {
        // Pool key embeds the player-visual version so HMR / hot
        // reload picks up redesigns cleanly: old keys won't match,
        // their nodes get evicted by the unused-key sweep below, and
        // brand-new nodes are created with the current code.
        const playerKey = `${p.steamId}::pv8`;
        seen.add(playerKey);
        let node = playerNodesRef.current.get(playerKey);
        if (!node) {
          node = createPlayerNode(p.team);
          playerNodesRef.current.set(playerKey, node);
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
          hp: p.hp,
          weapon: p.weapon ?? null,
          isJumping: !!p.isJumping,
          focused: focusedSteamId === p.steamId,
          showArrow: layers.viewArrows,
          spriteRadius: Math.max(8, projectScalar(60)),
          time: currentTime,
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

    // ─── Flashed-player white overlay ──────────────────────────────
    //
    // Each blinded player gets a layered WHITE indicator on top of
    // their marker for the duration of the blind (3 s, quadratic
    // fade). Three pieces stacked back-to-front:
    //
    //   • Big soft outer halo  — wide low-alpha disc that washes
    //     the marker in light, like the player is engulfed in the
    //     flash bulb's glare.
    //   • Bright pulsing ring  — clearly-outlined white circle
    //     around the marker, alpha-pulsing at ~3 Hz so the
    //     indicator reads as "active blind state" not just
    //     ambient glow.
    //   • White sparkle swarm  — 10 small white dots clustered
    //     above the marker (stable seeded positions, gentle per-
    //     dot drift), reinforcing the "blinded" reading without
    //     team-tinting (the user explicitly wants this WHITE so
    //     the affected state is unambiguous regardless of side).
    //
    // The overlay Graphics is added to ``ls.players`` so it
    // composites above every player marker. It clears + redraws
    // every frame; when ``flashedSteamIds`` empties out the visual
    // disappears cleanly.
    {
      const fpG = getGfx("flash-particles-overlay", ls.players);
      if (flashedSteamIds.size > 0 && frame?.players) {
        for (const player of frame.players) {
          const state = flashedSteamIds.get(player.steamId);
          if (!state) continue;
          const pp = project(player.x, player.y);
          const baseR = Math.max(8, projectScalar(60));

          // ---- 1. Big soft outer halo ----
          // Two stacked discs build a gradient bowl around the
          // marker. Alpha-multiplied by the blind intensity so it
          // dims as the player recovers.
          fpG.circle(pp.cx, pp.cy, baseR * 2.4).fill({
            color: 0xffffff,
            alpha: state.intensity * 0.10,
          });
          fpG.circle(pp.cx, pp.cy, baseR * 1.7).fill({
            color: 0xffffff,
            alpha: state.intensity * 0.18,
          });
          fpG.circle(pp.cx, pp.cy, baseR * 1.2).fill({
            color: 0xffffff,
            alpha: state.intensity * 0.25,
          });

          // ---- 2. Bright pulsing ring ----
          // Tight outline around the marker, alpha-pulsed at ~3 Hz
          // so the indicator feels active.
          const ringPulse = 0.7 + 0.3 * Math.sin(currentTime * 6);
          fpG.circle(pp.cx, pp.cy, baseR * 1.10).stroke({
            color: 0xffffff,
            alpha: state.intensity * ringPulse * 0.95,
            width: 2,
          });
          fpG.circle(pp.cx, pp.cy, baseR * 1.35).stroke({
            color: 0xffffff,
            alpha: state.intensity * ringPulse * 0.45,
            width: 1.2,
          });

          // ---- 3. White sparkle swarm ----
          // Cluster sits above the marker (cy offset negative).
          // Stable seed per steamId so the shape doesn't reshuffle
          // frame to frame.
          let seed = 0;
          for (let i = 0; i < player.steamId.length; i++) {
            seed = (seed * 31 + player.steamId.charCodeAt(i)) | 0;
          }
          const numDots = 10;
          const clusterCY = pp.cy - baseR * 0.6;
          const clusterRadius = baseR * 0.85;
          for (let i = 0; i < numDots; i++) {
            const r1 = (Math.sin(seed + i * 73.1) + 1) / 2;
            const r2 = (Math.cos(seed + i * 47.3) + 1) / 2;
            const r3 = (Math.sin(seed + i * 13.7) + 1) / 2;
            const driftPhase = currentTime * 0.9 + i * 0.6;
            const driftX = Math.cos(driftPhase) * 2.2;
            const driftY = Math.sin(driftPhase * 1.1) * 1.8;
            const angle = r1 * Math.PI * 2;
            const radius = r2 * clusterRadius;
            const px = pp.cx + Math.cos(angle) * radius + driftX;
            const py = clusterCY + Math.sin(angle) * radius * 1.15 + driftY;
            const baseSize = 1.6 + r3 * 1.8;
            const sizePulse = 0.82 + 0.18 * Math.sin(currentTime * 3.5 + i * 1.5);
            const alphaWobble = 0.72 + 0.28 * Math.sin(currentTime * 2.3 + i * 0.7);
            fpG.circle(px, py, baseSize * sizePulse).fill({
              color: 0xffffff,
              alpha: state.intensity * 0.90 * alphaWobble,
            });
          }
        }
      }
    }
  }, [
    pixiReady,
    frame,
    pastEvents,
    currentTime,
    layers,
    playerLookup,
    focusedSteamId,
    project,
    projectScalar,
  ]);

  // ============== Follow player ==============
  // When a player is selected to follow, every frame we project their
  // current position into radar pixels and recenter the viewport on it.
  // We also bump the zoom to the configured follow level so the player
  // takes ~25% of the screen — same feel as the in-game POV camera.
  useEffect(() => {
    if (!pixiReady || !followSteamId || !frame) return;
    const vp = viewportRef.current;
    const host = containerRef.current;
    if (!vp || !host) return;
    const target = frame.players.find((p) => p.steamId === followSteamId);
    if (!target) return;
    const pp = project(target.x, target.y);
    // Smooth recenter via Pixi's animate plugin; falls back to instant
    // if the plugin isn't loaded.
    try {
      vp.animate({
        position: { x: pp.cx, y: pp.cy },
        time: 180,
        ease: "easeInOutSine",
      });
    } catch {
      vp.moveCenter(pp.cx, pp.cy);
    }
    // Set zoom only when entering follow mode (first frame), not every
    // tick — otherwise the user can't manually zoom while following.
    // We compare the steamId to the last-followed and only re-zoom on a
    // change.
  }, [pixiReady, followSteamId, frame, project]);

  // Lock the zoom level the first frame a new follow target is set.
  useEffect(() => {
    if (!pixiReady || !followSteamId) return;
    const vp = viewportRef.current;
    const host = containerRef.current;
    if (!vp || !host) return;
    const base = host.clientWidth / radarSize;
    vp.setZoom(followZoom * base, true);
    setZoomLevel(followZoom);
    // Only re-zoom when the followed steamId itself changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixiReady, followSteamId]);

  // ============== Drawing / annotation tool ==============
  // Re-renders the accumulated freehand strokes plus the
  // in-progress one onto the dedicated Pixi Graphics layer. All
  // coordinates are stored in WORLD space so panning / zooming the
  // viewport pans / zooms the strokes with the map for free.
  const redrawStrokes = (): void => {
    const g = drawingGfxRef.current;
    if (!g) return;
    g.clear();
    const STROKE = { color: 0xff3a3a, alpha: 0.92, width: 3, cap: "round", join: "round" } as const;
    for (const path of drawingPathsRef.current) {
      if (path.points.length < 2) continue;
      g.moveTo(path.points[0].x, path.points[0].y);
      for (let i = 1; i < path.points.length; i++) {
        g.lineTo(path.points[i].x, path.points[i].y);
      }
      g.stroke(STROKE);
    }
    const cur = currentPathRef.current;
    if (cur && cur.length >= 2) {
      g.moveTo(cur[0].x, cur[0].y);
      for (let i = 1; i < cur.length; i++) g.lineTo(cur[i].x, cur[i].y);
      g.stroke(STROKE);
    }
  };

  // Wire pointer events while drawing mode is on.
  //
  // Pattern borrowed from cs2.cam / Skybox style tactical boards: when
  // the pencil tool is active, the viewport's drag plugin is paused
  // and pointer-down starts a new stroke; pointer-move appends a
  // point in world coords; pointer-up commits the stroke into the
  // permanent paths list. Disabling drag avoids the "I drew but the
  // map also moved" frustration.
  useEffect(() => {
    if (!pixiReady) return;
    const vp = viewportRef.current;
    const app = appRef.current;
    const host = containerRef.current;
    if (!vp || !app || !host) return;

    if (!drawingMode) {
      host.style.cursor = "";
      return;
    }

    // Pause viewport interactions that fight with drawing.
    try { vp.plugins.pause("drag"); } catch { /* */ }
    host.style.cursor = "crosshair";

    const stage = app.stage;
    stage.eventMode = "static";
    stage.hitArea = app.screen;

    const startStroke = (e: FederatedPointerEvent) => {
      const world = vp.toWorld(e.global);
      currentPathRef.current = [{ x: world.x, y: world.y }];
      redrawStrokes();
    };

    const extendStroke = (e: FederatedPointerEvent) => {
      const cur = currentPathRef.current;
      if (!cur) return;
      const world = vp.toWorld(e.global);
      // Skip duplicate / near-duplicate points so the path stays
      // light and the Graphics doesn't accumulate hundreds of
      // redundant segments per second.
      const last = cur[cur.length - 1];
      if (Math.hypot(world.x - last.x, world.y - last.y) < 1.5) return;
      cur.push({ x: world.x, y: world.y });
      redrawStrokes();
    };

    const finishStroke = () => {
      const cur = currentPathRef.current;
      if (cur && cur.length >= 2) {
        drawingPathsRef.current.push({ points: cur });
      }
      currentPathRef.current = null;
      redrawStrokes();
    };

    stage.on("pointerdown", startStroke);
    stage.on("pointermove", extendStroke);
    stage.on("pointerup", finishStroke);
    stage.on("pointerupoutside", finishStroke);

    return () => {
      try { vp.plugins.resume("drag"); } catch { /* */ }
      host.style.cursor = "";
      stage.off("pointerdown", startStroke);
      stage.off("pointermove", extendStroke);
      stage.off("pointerup", finishStroke);
      stage.off("pointerupoutside", finishStroke);
      // Drop any in-progress stroke when leaving drawing mode so it
      // doesn't get re-committed on the next entry.
      currentPathRef.current = null;
      redrawStrokes();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixiReady, drawingMode]);

  // ============== Screenshot (imperative API) ==============
  // Pixi's renderer can extract the current canvas as a Blob. We compose
  // it with a watermark + map label drawn on a 2D canvas and trigger a
  // download. The handle is exposed to the parent via the ``onReady``
  // callback prop (forwardRef doesn't work through Next's dynamic
  // wrapper) — the parent stores the handle in its own ref.
  useEffect(() => {
    if (!pixiReady || !onReady) return;
    const handle: PixiMapCanvasHandle = {
      clearDrawings() {
        drawingPathsRef.current = [];
        currentPathRef.current = null;
        redrawStrokes();
      },
      // Zoom methods read the LIVE viewport scale via the ref rather
      // than React's ``zoomLevel`` state — the handle is created once
      // when ``pixiReady`` flips true, so closing over a state value
      // would capture a stale snapshot. Reading ``vp.scale.x`` every
      // call always reflects the user's most recent zoom (whether
      // they got there via wheel, button, or pinch).
      zoomBy(factor) {
        const vp = viewportRef.current;
        const host = containerRef.current;
        if (!vp || !host) return;
        const base = host.clientWidth / radarSize;
        const currentZoom = vp.scale.x / base;
        const target = Math.max(0.5, Math.min(6, currentZoom * factor));
        vp.setZoom(target * base, true);
        setZoomLevel(target);
      },
      resetView() {
        const vp = viewportRef.current;
        const host = containerRef.current;
        if (!vp || !host) return;
        const base = host.clientWidth / radarSize;
        const target = fullBleed ? 1.18 : 1;
        vp.setZoom(target * base, true);
        vp.moveCenter(radarSize / 2, radarSize / 2);
        setZoomLevel(target);
      },
      async screenshot(opts) {
        const app = appRef.current;
        const host = containerRef.current;
        if (!app || !host) return;

        // Force a render so the next frame is in the framebuffer, then
        // extract as a Canvas (synchronous on Pixi v8).
        app.renderer.render(app.stage);
        const srcCanvas: HTMLCanvasElement = await app.renderer.extract.canvas(app.stage) as HTMLCanvasElement;

        // Compose on a fresh canvas so we can stamp the watermark.
        const out = document.createElement("canvas");
        out.width = srcCanvas.width;
        out.height = srcCanvas.height;
        const ctx = out.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(srcCanvas, 0, 0);

        // ---- Watermark band (bottom-right) ----
        const pad = Math.floor(out.width * 0.012);
        const fontSize = Math.max(16, Math.floor(out.width * 0.014));
        ctx.save();
        ctx.font = `700 ${fontSize}px system-ui, sans-serif`;
        const brand = "RIFTSCOPE";
        const subtitle = opts?.mapLabel
          ? `${opts.mapLabel.toUpperCase()} · ${new Date().toISOString().slice(0, 10)}`
          : new Date().toISOString().slice(0, 10);
        ctx.textBaseline = "alphabetic";
        const brandWidth = ctx.measureText(brand).width;
        ctx.font = `500 ${Math.floor(fontSize * 0.7)}px system-ui, sans-serif`;
        const subWidth = ctx.measureText(subtitle).width;
        const blockWidth = Math.max(brandWidth, subWidth) + pad * 1.6;
        const blockHeight = fontSize * 2.3;
        const blockX = out.width - blockWidth - pad;
        const blockY = out.height - blockHeight - pad;
        // Subtle dark background pill
        ctx.fillStyle = "rgba(10, 13, 20, 0.78)";
        roundedRect(ctx, blockX, blockY, blockWidth, blockHeight, pad * 0.6);
        ctx.fill();
        // Brand
        ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
        ctx.fillStyle = "#4a9eff";
        ctx.fillText(brand, blockX + pad * 0.8, blockY + fontSize * 1.05);
        // Subtitle
        ctx.font = `500 ${Math.floor(fontSize * 0.7)}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(220, 224, 235, 0.85)";
        ctx.fillText(subtitle, blockX + pad * 0.8, blockY + fontSize * 1.95);
        ctx.restore();

        // ---- Trigger download ----
        const filename = opts?.filename
          ?? `riftscope-${(opts?.mapLabel ?? "map").toLowerCase()}-${Date.now()}.png`;
        out.toBlob((blob) => {
          if (!blob) return;
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          // Defer URL revoke so the browser has time to start the download.
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        }, "image/png");
      },
    };
    onReady(handle);
  }, [pixiReady, onReady]);

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

      {/* (Bottom-right zoom toolbar removed — zoom controls now live
          on the left-edge ToolStrip on the replay page, driven via
          the imperative handle's ``zoomBy`` / ``resetView``.) */}
    </div>
  );
}

// =========================================================================
// Pixi helpers
// =========================================================================

interface PlayerNode {
  root: Container;
  shadow: Graphics;
  /** Outer halo / focus ring */
  bodyOuter: Graphics;
  /** Pin shape (circle + tip), filled with HP-modulated team colour */
  body: Graphics;
  /** Inner highlight ring + centre dot, also HP-modulated */
  bodyInner: Graphics;
  /** Pill-shaped background for the name label */
  labelBg: Graphics;
  label: Text;
  /** Real CS2 weapon PNG (in-hand). Loaded lazily from /public/weapons/. */
  weaponSprite: Sprite;
  arrow: Graphics;
  cone: Graphics;
  /** Cached weapon string so we only swap the texture when it changes. */
  lastWeapon: string;
  /** Cached label text so we don't rebuild the Text glyph atlas every frame. */
  lastName: string;
}

/**
 * Strip leading non-alphanumeric vanity decorations from a Steam
 * display name and truncate so the pill stays compact.
 *
 *   "✓ ★ MOLI"           → "MOLI"
 *   "✪ k1to ✪"           → "k1to ✪"      (only LEADING junk is stripped)
 *   "EXTREMELY_LONG_NAME" → "EXTREMELY_…"
 *
 * Trailing decorations are kept — those don't add to the visual
 * width on the LEFT of the pill (which is what causes overlap with
 * the marker dot below).
 */
const MAX_PLAYER_PILL_CHARS = 12;
function cleanPlayerName(raw: string): string {
  if (!raw) return "—";
  // Drop common Unicode decoration glyphs from the start. We use an
  // ASCII allow-list (letters + digits + underscore) rather than the
  // \p{L}\p{N} Unicode property escape because the TS target here is
  // ES5 (older RegExp). Players with all-Unicode names (Cyrillic,
  // CJK) fall through to ``raw`` via the fallback below.
  const trimmed = raw.replace(/^[^A-Za-z0-9_]+/, "");
  const name = trimmed || raw; // never collapse to empty
  if (name.length <= MAX_PLAYER_PILL_CHARS) return name;
  return name.slice(0, MAX_PLAYER_PILL_CHARS - 1) + "…";
}

function createPlayerNode(team: "ct" | "tt"): PlayerNode {
  const root = new Container();
  const shadow = new Graphics();
  const cone = new Graphics();
  const arrow = new Graphics();
  const bodyOuter = new Graphics();
  const body = new Graphics();
  const bodyInner = new Graphics();
  const labelBg = new Graphics();
  // Pill label — 9 px is the minimum that stays readable at default
  // zoom while keeping the cluster of pills from blob-ing together
  // when players group up (executes, rotates). Bold so it still
  // pops against the team-tinted pill background.
  const label = new Text({ text: "", style: textStyle(9, 0xffffff, 700, true) });
  label.anchor.set(0.5, 0.5);
  const weaponSprite = new Sprite(Texture.EMPTY);
  weaponSprite.anchor.set(0.5, 0);
  weaponSprite.visible = false;
  // White-out the texture BEFORE Pixi's per-sprite tint runs —
  // guarantees team-colour multiplication actually colours the
  // badge regardless of what fill the upstream SVG shipped with.
  weaponSprite.filters = [UTILITY_WHITE_OUT_FILTER];
  // Z-order: shadow / cone behind, marker body, inner detail, label pill,
  // label text, weapon.
  root.addChild(
    shadow, cone, arrow,
    bodyOuter, body, bodyInner,
    labelBg, label,
    weaponSprite,
  );
  void team;
  return {
    root, shadow, bodyOuter, body, bodyInner,
    labelBg, label,
    weaponSprite, arrow, cone,
    lastWeapon: "",
    lastName: "",
  };
}

// =========================================================================
// HP-driven colour drain.
//
// Mixes the team colour toward a near-black "drained" target as HP
// decreases. At 100 hp the player reads vivid team-colour; at 0 hp the
// colour is almost gone — so HP loss is immediately visible without
// needing a separate HP bar.
//
// The "drained" target has a slight red tint so dying players look
// damaged rather than just dark.
// =========================================================================
function damagedColor(teamColor: number, hp: number): number {
  // Clamp + floor so the player never goes completely black while alive.
  const t = Math.max(0.12, Math.min(1, hp / 100));
  const tr = (teamColor >> 16) & 0xff;
  const tg = (teamColor >> 8) & 0xff;
  const tb = teamColor & 0xff;
  // Drained target: dark with a small red push.
  const dr = 70, dg = 25, db = 25;
  const r = Math.round(dr + (tr - dr) * t);
  const g = Math.round(dg + (tg - dg) * t);
  const b = Math.round(db + (tb - db) * t);
  return (r << 16) | (g << 8) | b;
}

/** Mix two ints toward white by ``amount`` (0..1). Used for the inner highlight. */
function lighten(color: number, amount: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const nr = Math.round(r + (255 - r) * amount);
  const ng = Math.round(g + (255 - g) * amount);
  const nb = Math.round(b + (255 - b) * amount);
  return (nr << 16) | (ng << 8) | nb;
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
    hp?: number;
    weapon?: string | null;
    isJumping?: boolean;
    focused: boolean;
    showArrow: boolean;
    spriteRadius: number;
    time: number;
  },
) {
  const teamColor = s.team === "ct" ? TEAM_COLOR_CT : TEAM_COLOR_TT;
  // Focus scales the sprite; jump adds an extra 1.18x for visual lift.
  const baseR = s.focused ? s.spriteRadius * 1.25 : s.spriteRadius;
  const jumpScale = s.isJumping ? 1.18 : 1;
  const r = baseR * jumpScale;

  // HP-modulated colour: vivid team colour at 100 hp, drained near 0.
  const hp = typeof s.hp === "number" ? Math.max(0, Math.min(100, s.hp)) : 100;
  const pinColor = damagedColor(teamColor, hp);
  const innerColor = lighten(pinColor, 0.55);   // inner ring — lighter version
  const centerColor = damagedColor(teamColor, Math.max(20, hp));  // centre dot stays visible

  node.root.position.set(s.cx, s.cy);
  node.root.alpha = s.alive ? 1 : 0.55;

  // ---- Pin geometry ----
  // The pin's tail is now the view-direction indicator: it rotates
  // around the head to point WHERE THE PLAYER IS LOOKING (per user
  // direction — "la punta q esta mirando hacia el suelo sea la 'mira'
  // del player"). The separate notch from the previous iteration is
  // gone; tail and view indicator are unified into one shape.
  //
  // Head stays fixed at (0, 0) = the player's exact map position.
  // Tail rotates around the head as the player turns.
  //
  // Our "toque original" vs cs2.cam / leetify:
  //   - HP-modulated body colour (others use flat team colour, lose
  //     HP signal on the marker);
  //   - inner concentric highlight + centre dot for depth;
  //   - team-tinted name pill below the head.
  const tailH = r * 0.65;   // distance from head's bottom edge to tip
  const tailW = r * 0.55;   // half-width of the tail at the head edge
  // Forward direction = player view direction in screen coords.
  // CS yaw: 0 = east (+x), 90 = north (= screen up since y is down).
  const yawRad = ((s.yaw ?? 0) * Math.PI) / 180;
  const fwdX = Math.cos(yawRad);
  const fwdY = -Math.sin(yawRad);
  // Tail's polar angle in screen coordinates (atan2 with y-down).
  // Used to position the meeting points symmetrically about the
  // tail axis and to pick the arc direction.
  const tailAngle = Math.atan2(fwdY, fwdX);
  // Half-angle from the tail axis to each meeting point on the
  // head circle. ``asin(tailW / r)`` is exact: it's the angle whose
  // sine equals the perpendicular distance from axis to the meeting
  // point, divided by the head radius.
  const tailHalfAngle = Math.asin(Math.min(0.99, tailW / r));
  const tipDist = r + tailH;
  const tipX = fwdX * tipDist;
  const tipY = fwdY * tipDist;
  const meetLAngle = tailAngle + tailHalfAngle;
  const meetRAngle = tailAngle - tailHalfAngle;
  const meetLX = Math.cos(meetLAngle) * r;
  const meetLY = Math.sin(meetLAngle) * r;
  const meetRX = Math.cos(meetRAngle) * r;
  const meetRY = Math.sin(meetRAngle) * r;

  // ---- Shadow ----
  // The shadow stays BELOW THE HEAD (fixed under the marker), NOT
  // under the tail tip — gravity points down regardless of where the
  // player is looking, so the shadow shouldn't rotate. If we slid
  // the shadow with the tail it would orbit the player every time
  // they turned their view, which reads wrong.
  const shadowY = r * 1.25;
  node.shadow.clear();
  if (s.alive) {
    if (s.isJumping) {
      node.shadow.ellipse(0, shadowY + r * 0.10, r * 1.05, r * 0.35).fill({ color: 0x000000, alpha: 0.45 });
      node.shadow.ellipse(0, shadowY + r * 0.10, r * 0.7, r * 0.22).fill({ color: 0x000000, alpha: 0.25 });
    } else {
      node.shadow.ellipse(0, shadowY, r * 0.85, r * 0.24).fill({ color: 0x000000, alpha: 0.42 });
    }
  }

  // ---- Body ----
  node.body.clear();
  node.bodyOuter.clear();
  node.bodyInner.clear();
  if (s.alive) {
    // Jump halo — pulse ring around the head when airborne.
    if (s.isJumping) {
      const halo = 1 + Math.sin(s.time * 12) * 0.08;
      node.bodyOuter
        .circle(0, 0, (r + 4) * halo)
        .stroke({ color: teamColor, alpha: 0.45, width: 1.8 });
    }
    // Focus ring — thicker bright ring around the head when the
    // player is selected / followed.
    if (s.focused) {
      node.bodyOuter
        .circle(0, 0, r + 3.5)
        .stroke({ color: lighten(teamColor, 0.30), alpha: 0.92, width: 2 });
    }

    // PIN — drawn as ONE continuous outline so the tail meets the
    // head without a doubled stroke at the junction. Path:
    //   - start at the LEFT meeting point on the head circle
    //   - arc the LONG way around the head — opposite side from the
    //     tail — over to the right meeting point
    //   - line down to the rotated tip
    //   - line back to the left meeting point
    //
    // ``anticlockwise = false`` in Pixi (canvas y-down) makes the
    // arc traverse with the angle INCREASING from start to end. For
    // tail down (meetL ≈ 124°, meetR ≈ 56°) that wraps through 180°
    // → 270° (TOP) → 360° → 56°, the 240° arc opposite the tail.
    // The same direction holds for any tail orientation because the
    // meeting points are always symmetric around the tail axis, so
    // CW-increasing-angle from meetL always traces the side AWAY
    // from the tail.
    node.body
      .moveTo(meetLX, meetLY)
      .arc(0, 0, r, meetLAngle, meetRAngle, false)
      .lineTo(tipX, tipY)
      .lineTo(meetLX, meetLY)
      .closePath()
      .fill({ color: pinColor })
      .stroke({ color: 0x0a0d14, width: 1.6, alpha: 0.92 });

    // Inner highlight ring + centre dot — restricted to the head
    // area, not the tail.
    node.bodyInner.circle(0, 0, r * 0.66).fill({ color: innerColor, alpha: 0.90 });
    node.bodyInner.circle(0, 0, r * 0.30).fill({ color: centerColor });
  } else {
    // Dead — X mark at the head position. Tail / shadow / arrow are
    // all skipped above for dead players.
    const off = r * 0.7;
    node.body
      .moveTo(-off, -off)
      .lineTo(off, off)
      .stroke({ color: teamColor, width: r * 0.18 })
      .moveTo(-off, off)
      .lineTo(off, -off)
      .stroke({ color: teamColor, width: r * 0.18 });
  }

  // ---- View direction ----
  // No separate arrow / notch — the rotated tail above IS the view
  // indicator. Clear any leftover graphics from prior renders so
  // pooled nodes don't keep showing an old arrow shape.
  node.arrow.clear();
  node.cone.clear();

  // ---- Name pill (under the pin tip) ----
  // Compact team-tinted pill sitting BELOW the tip. The previous
  // design used a neutral dark fill that read fine but felt
  // disconnected from the marker. The references (cs2.cam, leetify)
  // tint the pill with the player's team colour — instant team
  // signal even when the marker itself is partially hidden behind
  // utility / smoke. We DARKEN the team colour heavily so the white
  // name text still reads cleanly without needing a heavy border.
  //
  // ``cleanedName`` strips leading non-alphanumeric vanity glyphs
  // (✓ ★ ☆ ♛ ♔ …) and truncates to MAX_NAME_CHARS so the pill
  // stays compact for players with long decorated Steam names.
  const cleanedName = cleanPlayerName(s.name);
  if (node.label.text !== cleanedName) {
    node.label.text = cleanedName;
    node.lastName = cleanedName;
  }
  const pillPaddingX = 5;
  const pillPaddingY = 1.5;
  const textW = node.label.width;
  const textH = node.label.height;
  const pillW = textW + pillPaddingX * 2;
  const pillH = textH + pillPaddingY * 2;
  // Pill sits at a FIXED position below the head, independent of
  // the tail's rotation. If we anchored it to the rotated tail
  // tip, the label would orbit the head every time the player
  // turned their view — chaotic to read. Position is just below
  // the maximum reach of the tail when it happens to point down,
  // so even a "looking south" player doesn't overlap their pill.
  const labelGap = 3;
  const pillTopY = r + tailH + labelGap;
  const pillCenterY = pillTopY + pillH / 2;

  // Hide the name pill entirely for DEAD players. The X mark stays
  // visible but the name comes off so a stack of dead bodies doesn't
  // turn the radar into a wall of text.
  node.labelBg.clear();
  if (s.alive) {
    // Team-tinted pill, darkened so white text reads at a glance.
    // Mixing the team colour with 70 % black gives a muted "team
    // chip" look — recognisable as ct/t at a glance, but quiet
    // enough not to compete with the marker itself.
    const pillFill = damagedColor(teamColor, 28); // ~72 % toward black
    node.labelBg
      .roundRect(-pillW / 2, pillTopY, pillW, pillH, pillH / 2)
      .fill({ color: pillFill, alpha: 0.92 })
      .stroke({ color: teamColor, alpha: 0.55, width: 1 });
    node.label.alpha = 1;
    node.label.position.set(0, pillCenterY);
  } else {
    node.label.alpha = 0;
  }

  // ---- Utility-in-hand overlay ----
  // When the player is currently holding a grenade we surface a
  // small silhouette beside the marker, tinted with team colour
  // (CT blue / TT orange). Lets the viewer spot incoming utility
  // throws at a glance without having to scan the team-loadout
  // panel.
  //
  // Hidden for: dead players, players not holding utility, and
  // while the SVG texture is still loading (texture pops in on
  // the next frame after Assets.load resolves).
  const utilityKey = s.alive ? resolveUtilityKey(s.weapon) : null;
  if (utilityKey) {
    const tex = getUtilityTexture(utilityKey);
    if (tex) {
      node.weaponSprite.texture = tex;
      // Aspect-preserving scale into a marker-relative bounding
      // box. ``iconR`` is sized so the badge reads like a status
      // indicator (notification-dot scale) rather than a second
      // marker — small, attached, secondary signal.
      const iconR = r * 0.70;
      const targetSize = iconR * 2;
      const naturalW = tex.width || targetSize;
      const naturalH = tex.height || targetSize;
      const fit = Math.min(targetSize / naturalW, targetSize / naturalH);
      node.weaponSprite.anchor.set(0.5, 0.5);
      node.weaponSprite.scale.set(fit);
      // Badge placement: lower-right of the marker, overlapping
      // the outline slightly. The previous (r + iconR + 2, 0)
      // formula put the centre ~1.85 r away from the marker —
      // legible but visually detached. Pulling it in to
      // (r * 0.7, r * 0.55) anchors the icon at the marker's
      // 4-5 o'clock corner like a Discord status dot, which is
      // what the user asked for ("más cerca del player").
      node.weaponSprite.position.set(r * 0.7, r * 0.55);
      // Team-colour tint — CT blue (0x4a9eff) / TT orange
      // (0xffb347). The pre-tint white-out filter on the sprite
      // (see ``createPlayerNode``) forces the texture to solid
      // white first, so this multiplication actually colours the
      // badge regardless of the upstream SVG's fill.
      node.weaponSprite.tint = teamColor;
      node.weaponSprite.alpha = 0.95;
      node.weaponSprite.visible = true;
    } else {
      // Texture still loading — hide for now, will re-render
      // next frame once Assets.load resolves.
      node.weaponSprite.visible = false;
    }
  } else {
    node.weaponSprite.visible = false;
  }
}

// Draw a rounded rectangle on a 2D canvas — used by the screenshot
// watermark. Native roundRect support landed in Chrome 99 / Safari 16.4
// but we polyfill for older browsers.
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  if (typeof (ctx as any).roundRect === "function") {
    ctx.beginPath();
    (ctx as any).roundRect(x, y, w, h, radius);
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

// ============================================================================
// Weapon textures — official CS2 PNGs served from /public/weapons.
//
// demoparser2 emits weapon names like "ak47", "m4a1_silencer", "hegrenade".
// The PNG filenames in the bundle don't use a consistent convention (some
// are `Weapon_<name>.png`, others are `AK-47.png`, etc.) so we explicitly
// map each parser key to its file. Anything not in the table falls back
// to a 1×1 transparent texture (sprite stays hidden).
// ============================================================================
const WEAPON_TEXTURE_FILES: Record<string, string> = {
  // Rifles
  ak47: "AK-47.png",
  m4a1: "Weapon_m4a1.png",
  m4a1_silencer: "Weapon_m4a1_silencer.png",
  famas: "Weapon_famas.png",
  galilar: "Icon_inventory_galil_ar.png",
  sg556: "Weapon_sg556.png",
  aug: "Aug.png",
  // Snipers
  awp: "Weapon_awp.png",
  ssg08: "Weapon_ssg08.png",
  scar20: "Weapon_scar20.png",
  g3sg1: "Weapon_g3sg1.png",
  // SMGs
  mac10: "Weapon_mac10.png",
  mp9: "Weapon_mp9.png",
  mp7: "Weapon_mp7.png",
  mp5sd: "Weapon_mp5sd.png",
  ump45: "Weapon_ump45.png",
  p90: "Weapon_p90.png",
  bizon: "Weapon_bizon.png",
  // Shotguns
  nova: "Weapon_nova.png",
  xm1014: "Weapon_xm1014.png",
  sawedoff: "Weapon_sawedoff.png",
  mag7: "Weapon_mag7.png",
  // LMGs
  m249: "Weapon_m249.png",
  negev: "Weapon_negev.png",
  // Pistols
  glock: "Weapon_glock.png",
  usp_silencer: "Weapon_usp_silencer.png",
  hkp2000: "Weapon_hkp2000.png",
  p2000: "Weapon_hkp2000.png",
  p250: "Weapon_p250.png",
  fiveseven: "Weapon_fiveseven.png",
  tec9: "Weapon_tec9.png",
  cz75a: "Weapon_CZ75-Auto.png",
  deagle: "Weapon_deagle.png",
  elite: "Weapon_elite.png",
  revolver: "Weapon_R8.png",
  // Grenades
  hegrenade: "Weapon_hegrenade.png",
  smokegrenade: "Weapon_smokegrenade.png",
  flashbang: "Weapon_flashbang.png",
  molotov: "Weapon_molotov.png",
  incgrenade: "Weapon_incgrenade.png",
  decoy: "Weapon_decoy.png",
};

// Module-level cache. Survives component remounts and HMR, so reloading
// the replay page doesn't re-fetch any texture that was already loaded
// in this browser session.
const weaponTextureCache: Map<string, Texture> = new Map();
const weaponTextureLoading: Map<string, Promise<Texture | null>> = new Map();

/**
 * Synchronous lookup for a weapon's texture.
 *
 * Returns the cached `Texture` immediately if it's already loaded.
 * Otherwise kicks off an async load in the background and returns
 * `null`; the next call after the load resolves will return the real
 * texture. Each `updatePlayerNode()` call re-checks via this function,
 * so the texture pops in within ~50-200 ms of the player picking up
 * the weapon (one frame after the network fetch finishes).
 */
function getWeaponTexture(weapon: string): Texture | null {
  const w = weapon.toLowerCase().replace(/^weapon_/, "");
  const file = WEAPON_TEXTURE_FILES[w];
  if (!file) return null;
  const cached = weaponTextureCache.get(w);
  if (cached) return cached;
  if (weaponTextureLoading.has(w)) return null;
  const url = `/weapons/${file}`;
  const promise = Assets.load(url)
    .then((tex: Texture) => {
      weaponTextureCache.set(w, tex);
      weaponTextureLoading.delete(w);
      return tex;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[PixiMapCanvas] Failed to load weapon texture", url, err);
      weaponTextureLoading.delete(w);
      return null;
    });
  weaponTextureLoading.set(w, promise);
  return null;
}

/**
 * Preload every weapon texture in parallel. Called once when the Pixi
 * Application initializes. Warms the cache so the first time a player
 * picks up an AK there's no visible "pop-in" delay.
 */
function preloadWeaponTextures(): void {
  for (const [key, file] of Object.entries(WEAPON_TEXTURE_FILES)) {
    if (weaponTextureCache.has(key) || weaponTextureLoading.has(key)) continue;
    // Skip C4 / knife — they're handled separately and not in the
    // mapping; the loader just no-ops for them above.
    const url = `/weapons/${file}`;
    const promise = Assets.load(url)
      .then((tex: Texture) => {
        weaponTextureCache.set(key, tex);
        weaponTextureLoading.delete(key);
        return tex;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[PixiMapCanvas] Preload failed for", url, err);
        weaponTextureLoading.delete(key);
        return null;
      });
    weaponTextureLoading.set(key, promise);
  }
}

// ============================================================================
// Utility-in-hand overlay textures.
//
// When a player is currently holding a grenade we render a small
// silhouette beside their marker, tinted with team colour, so the
// viewer can tell "this CT has a smoke" / "this TT has a molotov"
// without having to scan the team-loadout panel.
//
// The icon is a MONOCHROME SVG silhouette so Pixi's ``sprite.tint``
// composites cleanly into the team colour. Each utility maps to one
// of the six clean SVGs in ``public/weapons/``.
// ============================================================================
// Mixed-format on purpose: smoke / flash / inc point at the .webp
// variants (CS2 game-asset projectile icons) instead of their .svg
// counterparts. The .webp files load reliably through Pixi v8's
// Assets pipeline, whereas the SVG variants have inconsistent
// presence of the ``xmlns`` namespace attribute — flashbang.svg in
// particular ships without it, which makes the rasterizer drop the
// texture and the badge silently never appears. ``flashbang.webp``
// is the file the rest of the project already uses for the team-
// loadout slot icons, so reusing it keeps the visual identity
// consistent across panel and map. The ColorMatrixFilter on the
// sprite (``UTILITY_WHITE_OUT_FILTER``) normalises whatever colour
// the source ships with to pure white, so the team-colour tint
// multiplies cleanly regardless of webp vs svg.
const UTILITY_TEXTURE_FILES: Record<string, string> = {
  smokegrenade: "smokegrenade.webp",
  flashbang:    "flashbang.webp",
  hegrenade:    "hegrenade.svg",
  molotov:      "molotov.svg",
  incgrenade:   "incgrenade.webp",
  decoy:        "decoy.svg",
};

/**
 * Display-name + projectile-class variants that the parser might
 * emit for the live weapon. Mirrors the alias table in
 * ``TeamLoadoutPanel.tsx`` so both surfaces classify the same
 * grenade identically.
 */
const UTILITY_NAME_ALIASES: Record<string, string> = {
  smoke:                  "smokegrenade",
  smokegrenadeprojectile: "smokegrenade",
  flash:                  "flashbang",
  flashgrenade:           "flashbang",
  flashbangs:             "flashbang",
  flashbangprojectile:    "flashbang",
  he:                     "hegrenade",
  hegren:                 "hegrenade",
  highexplosive:          "hegrenade",
  high_explosive:         "hegrenade",
  high_explosive_grenade: "hegrenade",
  highexplosivegrenade:   "hegrenade",
  he_grenade:             "hegrenade",
  hegrenadeprojectile:    "hegrenade",
  inferno:                "incgrenade",
  incendiary:             "incgrenade",
  incendiarygrenade:      "incgrenade",
  firegrenade:            "incgrenade",
  inc:                    "incgrenade",
  molotovgrenade:         "molotov",
  molotovprojectile:      "molotov",
  decoygrenade:           "decoy",
  decoyprojectile:        "decoy",
};

const UTILITY_KEYS = new Set(Object.keys(UTILITY_TEXTURE_FILES));

/**
 * Resolve a raw weapon name to one of the six canonical utility
 * keys (or ``null`` for non-grenades). Three-step lookup mirrors
 * the panel's ``liveGrenadeKey``: strip ``weapon_`` prefix, normalise
 * casing, try exact alias match, then a tight prefix fallback for
 * unknown parser variants.
 */
function resolveUtilityKey(weapon: string | null | undefined): string | null {
  if (!weapon) return null;
  let k = weapon.toLowerCase().replace(/^weapon_/, "").replace(/[\s-]/g, "");
  if (k in UTILITY_NAME_ALIASES) k = UTILITY_NAME_ALIASES[k];
  if (UTILITY_KEYS.has(k)) return k;
  // Prefix fallback — these prefixes don't collide with any firearm.
  if (k.startsWith("smoke")) return "smokegrenade";
  if (k.startsWith("flash")) return "flashbang";
  if (k.startsWith("high") || k.startsWith("hegren") || k.startsWith("he_") || k === "he") return "hegrenade";
  if (k.startsWith("incendiary") || k.startsWith("ince") || k.startsWith("inferno") || k.startsWith("firebomb")) return "incgrenade";
  if (k.startsWith("molotov")) return "molotov";
  if (k.startsWith("decoy")) return "decoy";
  return null;
}

const utilityTextureCache: Map<string, Texture> = new Map();
const utilityTextureLoading: Map<string, Promise<Texture | null>> = new Map();

/**
 * Pre-tint white-out filter shared across every utility badge.
 *
 * Most of the source SVGs declare their fill on the ``<svg>`` root
 * (or on a parent ``<g>``) rather than per-path. Pixi v8's
 * Assets-pipeline SVG rasterizer doesn't always inherit those root
 * attributes when it bakes the texture — so for some files the
 * resulting bitmap ends up black-on-transparent, which then
 * tint-multiplies to black regardless of team colour (the bug
 * that made the molotov beside Graviti come out black even though
 * the sprite's ``tint`` was set to TT orange).
 *
 * The ColorMatrix below forces every non-transparent pixel to
 * pure white (1,1,1) and preserves alpha — so the subsequent
 * ``sprite.tint`` multiplies cleanly into the team colour
 * regardless of what the upstream SVG happened to look like.
 *
 *   r' = 1
 *   g' = 1
 *   b' = 1
 *   a' = a   (unchanged)
 */
const UTILITY_WHITE_OUT_FILTER = new ColorMatrixFilter();
UTILITY_WHITE_OUT_FILTER.matrix = [
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 0, 1,
  0, 0, 0, 1, 0,
];

/**
 * Synchronous lookup for a utility's silhouette texture.
 * Same shape as ``getWeaponTexture`` — returns cached or kicks off
 * an async load and returns ``null`` until the load resolves.
 */
function getUtilityTexture(utilityKey: string): Texture | null {
  const file = UTILITY_TEXTURE_FILES[utilityKey];
  if (!file) return null;
  const cached = utilityTextureCache.get(utilityKey);
  if (cached) return cached;
  if (utilityTextureLoading.has(utilityKey)) return null;
  const url = `/weapons/${file}`;
  const promise = Assets.load(url)
    .then((tex: Texture) => {
      utilityTextureCache.set(utilityKey, tex);
      utilityTextureLoading.delete(utilityKey);
      return tex;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[PixiMapCanvas] Failed to load utility texture", url, err);
      utilityTextureLoading.delete(utilityKey);
      return null;
    });
  utilityTextureLoading.set(utilityKey, promise);
  return null;
}

// ---- Bomb / C4 icon texture ------------------------------------------
// Single texture shared by the planted-bomb marker. The C4 sprite is
// drawn over the existing red pulsing glow so the bomb position now
// has the actual silhouette instead of a featureless dot.
let bombTextureCached: Texture | null = null;
let bombTextureLoading: Promise<Texture | null> | null = null;
function getBombTexture(): Texture | null {
  if (bombTextureCached) return bombTextureCached;
  if (bombTextureLoading) return null;
  bombTextureLoading = Assets.load("/weapons/c4.svg")
    .then((tex: Texture) => {
      bombTextureCached = tex;
      bombTextureLoading = null;
      return tex;
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.warn("[PixiMapCanvas] Failed to load c4.svg", err);
      bombTextureLoading = null;
      return null;
    });
  return null;
}

/** Warm the utility-icon cache alongside the weapon textures. */
function preloadUtilityTextures(): void {
  for (const [key, file] of Object.entries(UTILITY_TEXTURE_FILES)) {
    if (utilityTextureCache.has(key) || utilityTextureLoading.has(key)) continue;
    const url = `/weapons/${file}`;
    const promise = Assets.load(url)
      .then((tex: Texture) => {
        utilityTextureCache.set(key, tex);
        utilityTextureLoading.delete(key);
        return tex;
      })
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.warn("[PixiMapCanvas] Utility preload failed for", url, err);
        utilityTextureLoading.delete(key);
        return null;
      });
    utilityTextureLoading.set(key, promise);
  }
}

// ============================================================================
// Wall mask — walkable area for each CS2 map.
//
// PRIMARY SOURCE (preferred, used when present):
//   ``/maps/<map>_walkable.png`` — pre-generated PNGs produced offline
//   by ``apps/api/scripts/generate_walkable_masks.py``. Pixel-perfect
//   nav-mesh-derived mask. Production projects ship these, but the
//   project also has to handle custom / community maps where no
//   authored mask exists.
//
// FALLBACK (used when no authored mask exists, including for ALL maps
// in a clean install):
//   ADAPTIVE HSV mask derived from the radar PNG itself. Strategy:
//
//     1. Convert each pixel from RGB → HSV.
//     2. Classify as walkable if:
//          a) saturation > SAT_WALK (coloured bomb sites + markers), OR
//          b) value > VAL_WALK (bright greyscale walkable tile), AND
//          c) alpha is opaque (off-map cells are stripped).
//     3. Apply morphological OPEN (erosion → dilation) to remove
//        noise speckles (single-pixel markers, text outlines).
//     4. Apply CLOSE (dilation → erosion) to fill small holes left
//        by callout labels, doorway shadows, etc.
//     5. Run connected-components labelling, keep only components
//        ≥ MIN_COMPONENT_AREA — drops isolated "islands" that the
//        previous luminance algorithm left behind (spawn markers,
//        bomb site label backgrounds, etc.).
//     6. Run a chamfer distance transform → smooth-step soft edges
//        for the safety-net container alpha (per-puff sampling
//        inside the smoke / molotov shaders does its own threshold).
// ============================================================================
const wallMaskCache: Map<string, Texture> = new Map();
const wallMaskLoading: Map<string, Promise<Texture | null>> = new Map();
// Cache version bump — increment this any time the algorithm changes
// so localStorage / texture caches invalidate cleanly across users.
const WALL_MASK_VERSION = "v9-door-alpha";

/**
 * Derive the pre-generated walkable mask URL from a radar URL.
 * ``/maps/de_mirage.png`` → ``/maps/de_mirage_walkable.png``.
 * Returns null for radar URLs that don't match the standard pattern.
 */
function deriveWalkableUrl(radarUrl: string): string | null {
  const match = radarUrl.match(/^(.+)\.png(\?.*)?$/i);
  if (!match) return null;
  return `${match[1]}_walkable.png${match[2] ?? ""}`;
}

async function createWallMask(radarUrl: string): Promise<Texture | null> {
  const cacheKey = `${WALL_MASK_VERSION}::${radarUrl}`;
  const cached = wallMaskCache.get(cacheKey);
  if (cached) return cached;
  const inflight = wallMaskLoading.get(cacheKey);
  if (inflight) return inflight;

  // ---- PRIMARY: try the pre-generated walkable PNG first ----
  // Generated offline from CS2's `.nav` files via
  // ``apps/api/scripts/generate_walkable_masks.py``. Pixel-perfect.
  const walkableUrl = deriveWalkableUrl(radarUrl);
  if (walkableUrl) {
    const tryAuthored = (async (): Promise<Texture | null> => {
      try {
        const tex = await Assets.load(walkableUrl);
        if (!tex) return null;
        // Linear sampling + mipmaps so the mask scales smoothly under
        // viewport zoom — identical setup to the legacy fallback path.
        const source = tex.source;
        if (source) {
          source.scaleMode = "linear";
          source.autoGenerateMipmaps = true;
        }
        wallMaskCache.set(cacheKey, tex);
        wallMaskLoading.delete(cacheKey);
        return tex;
      } catch {
        return null; // 404 / network fail → fall through to legacy
      }
    })();
    wallMaskLoading.set(cacheKey, tryAuthored);
    const authored = await tryAuthored;
    if (authored) return authored;
    // Authored mask missing — clear the inflight entry so the legacy
    // path below can re-populate the cache.
    wallMaskLoading.delete(cacheKey);
  }

  // ---- FALLBACK: HSV-based mask generation from the radar PNG ----
  // Used whenever the authored mask is missing — including all maps
  // in the default install. See the header comment block above for
  // the algorithm overview.
  const promise = (async (): Promise<Texture | null> => {
    try {
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
        img.src = radarUrl;
      });

      const w = img.naturalWidth || 1024;
      const h = img.naturalHeight || 1024;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(img, 0, 0);

      const data = ctx.getImageData(0, 0, w, h);
      const px = data.data;
      const N = w * h;

      // ============================================================
      // Step 1 — HSV CLASSIFICATION → binary walkable
      //
      // The old algorithm thresholded greyscale luminance at the 20th
      // percentile, which mis-classifies coloured bomb sites (their
      // hue is saturated but their value is darker than the plain
      // grey floor) as walls.
      //
      // HSV decoupling lets us treat the two cases separately:
      //   - High saturation → coloured area (site / spawn) → walkable
      //   - Low saturation + adequate value → grey floor      → walkable
      //   - Low saturation + low value      → wall            → opaque-zero
      //   - Transparent                     → off-map         → opaque-zero
      // ============================================================
      const SAT_WALK = 0.18;          // saturation cutoff for coloured walkable
      const VAL_WALK = 0.16;          // value cutoff for grey walkable (~ 41/255)
      const ALPHA_MIN = 30;           // ignore near-transparent pixels

      const binary = new Uint8Array(N);
      let opaqueCount = 0;
      let walkCount = 0;
      for (let i = 0; i < N; i++) {
        const p = i * 4;
        const a = px[p + 3];
        if (a < ALPHA_MIN) {
          binary[i] = 0;
          continue;
        }
        opaqueCount++;
        const r = px[p] / 255;
        const g = px[p + 1] / 255;
        const b = px[p + 2] / 255;
        // Compact RGB → HSV: only need S and V here so skip H.
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const v = mx;
        const s = mx === 0 ? 0 : (mx - mn) / mx;

        const isWalk = s > SAT_WALK || v > VAL_WALK;
        binary[i] = isWalk ? 1 : 0;
        if (isWalk) walkCount++;
      }
      if (opaqueCount === 0) return null;

      // ============================================================
      // Step 2 — MORPHOLOGICAL OPEN (erode then dilate)
      //
      // Kills tiny isolated walkable pixels — radar text glyphs ("A",
      // "B", "Banana", etc.) sometimes get classified walkable because
      // their fill is bright. Erosion strips 1-px borders so anything
      // < 3 px wide disappears; dilation puts the borders back on
      // surfaces that survived.
      // ============================================================
      const eroded = new Uint8Array(N);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (binary[idx] === 0) continue;
          // Erode if any 4-neighbour is wall (cross structuring elt).
          let keep = 1;
          if (x === 0 || binary[idx - 1] === 0) keep = 0;
          else if (x === w - 1 || binary[idx + 1] === 0) keep = 0;
          else if (y === 0 || binary[idx - w] === 0) keep = 0;
          else if (y === h - 1 || binary[idx + w] === 0) keep = 0;
          eroded[idx] = keep;
        }
      }
      const opened = new Uint8Array(N);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (eroded[idx] === 1) {
            opened[idx] = 1;
            continue;
          }
          // Dilate: walkable if any 4-neighbour is walkable.
          if (x > 0 && eroded[idx - 1]) opened[idx] = 1;
          else if (x < w - 1 && eroded[idx + 1]) opened[idx] = 1;
          else if (y > 0 && eroded[idx - w]) opened[idx] = 1;
          else if (y < h - 1 && eroded[idx + w]) opened[idx] = 1;
        }
      }

      // ============================================================
      // Step 3 — MORPHOLOGICAL CLOSE (dilate then erode)
      //
      // Fills sub-px holes punched by callout labels and the dark
      // outlines around bomb-site letters. Close = dilate then erode,
      // which is the dual of open.
      // ============================================================
      const dilated = new Uint8Array(N);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (opened[idx] === 1) { dilated[idx] = 1; continue; }
          if (x > 0 && opened[idx - 1]) dilated[idx] = 1;
          else if (x < w - 1 && opened[idx + 1]) dilated[idx] = 1;
          else if (y > 0 && opened[idx - w]) dilated[idx] = 1;
          else if (y < h - 1 && opened[idx + w]) dilated[idx] = 1;
        }
      }
      const closed = new Uint8Array(N);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (dilated[idx] === 0) continue;
          let keep = 1;
          if (x === 0 || dilated[idx - 1] === 0) keep = 0;
          else if (x === w - 1 || dilated[idx + 1] === 0) keep = 0;
          else if (y === 0 || dilated[idx - w] === 0) keep = 0;
          else if (y === h - 1 || dilated[idx + w] === 0) keep = 0;
          closed[idx] = keep;
        }
      }

      // ============================================================
      // Step 3.5 — WIDE MORPHOLOGICAL CLOSE (door-gap bridging)
      //
      // The standard 1-px close in step 3 cannot bridge doorframe
      // gaps (~10-20 px on a 1024-px radar image, matching CS2's
      // typical ~80-100 wu door width).  This pass uses a separable
      // box close with DOOR_R = 10 px to fill those thin dark strips
      // between walkable rooms without touching the core algorithm.
      //
      //   dilate(R)  — expands walkable areas, bridging the gap
      //   erode(R)   — restores large wall volumes; thin bridges that
      //                now connect two walkable regions REMAIN open
      //
      // The result is unioned with `closed` so this step is strictly
      // ADDITIVE — it never removes walkable pixels already accepted
      // by the earlier steps.  It runs BEFORE step 4 so newly-bridged
      // rooms form one large connected component and are not discarded
      // by the minimum-size filter.
      // ============================================================
      const DOOR_R = 15;

      // ── Separable box dilation ──────────────────────────────────
      // Horizontal pass: pixel x is walkable if ANY pixel in [x-R, x+R]
      // (same row) was walkable in `closed`.
      const _ddH = new Uint8Array(N);
      for (let y = 0; y < h; y++) {
        const base = y * w;
        const ps = new Int32Array(w + 1);
        for (let x = 0; x < w; x++) ps[x + 1] = ps[x] + closed[base + x];
        for (let x = 0; x < w; x++) {
          const lo = x > DOOR_R ? x - DOOR_R : 0;
          const hi = x + DOOR_R < w ? x + DOOR_R : w - 1;
          if (ps[hi + 1] - ps[lo] > 0) _ddH[base + x] = 1;
        }
      }
      // Vertical pass: pixel y is walkable if ANY pixel in [y-R, y+R]
      // (same column) was walkable after the horizontal pass.
      const _ddV = new Uint8Array(N);
      for (let x = 0; x < w; x++) {
        const ps = new Int32Array(h + 1);
        for (let y = 0; y < h; y++) ps[y + 1] = ps[y] + _ddH[y * w + x];
        for (let y = 0; y < h; y++) {
          const lo = y > DOOR_R ? y - DOOR_R : 0;
          const hi = y + DOOR_R < h ? y + DOOR_R : h - 1;
          if (ps[hi + 1] - ps[lo] > 0) _ddV[y * w + x] = 1;
        }
      }

      // ── Separable box erosion ───────────────────────────────────
      // Horizontal pass: pixel x survives only when ALL pixels in
      // [x-R, x+R] (same row) are walkable in the dilated buffer.
      const _deH = new Uint8Array(N);
      for (let y = 0; y < h; y++) {
        const base = y * w;
        const ps = new Int32Array(w + 1);
        for (let x = 0; x < w; x++) ps[x + 1] = ps[x] + _ddV[base + x];
        for (let x = 0; x < w; x++) {
          if (_ddV[base + x] === 0) continue;
          const lo = x > DOOR_R ? x - DOOR_R : 0;
          const hi = x + DOOR_R < w ? x + DOOR_R : w - 1;
          if (ps[hi + 1] - ps[lo] === hi - lo + 1) _deH[base + x] = 1;
        }
      }
      // Vertical pass: pixel y survives only when ALL pixels in
      // [y-R, y+R] (same column) are walkable after horizontal erosion.
      // Stored into `doorClosed`; then unioned with `closed`.
      const doorClosed = new Uint8Array(N);
      for (let x = 0; x < w; x++) {
        const ps = new Int32Array(h + 1);
        for (let y = 0; y < h; y++) ps[y + 1] = ps[y] + _deH[y * w + x];
        for (let y = 0; y < h; y++) {
          if (_deH[y * w + x] === 0) continue;
          const lo = y > DOOR_R ? y - DOOR_R : 0;
          const hi = y + DOOR_R < h ? y + DOOR_R : h - 1;
          if (ps[hi + 1] - ps[lo] === hi - lo + 1) doorClosed[y * w + x] = 1;
        }
      }
      // Track which pixels were OPENED by this step — those are the
      // door / archway gap pixels.  They were walls in `closed` and
      // are now walkable in `doorClosed`.  We override their final
      // alpha in step 6 so the smoke shader treats them as fully
      // walkable (the distance-transform falloff would otherwise
      // make them mostly opaque since they sit right next to walls).
      const isDoorPixel = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (doorClosed[i] === 1 && closed[i] === 0) isDoorPixel[i] = 1;
      }
      // Union — keep every walkable pixel from step 3 and add the
      // newly-bridged door pixels from the wide close.
      for (let i = 0; i < N; i++) {
        if (closed[i] === 1) doorClosed[i] = 1;
      }

      // ============================================================
      // Step 4 — CONNECTED-COMPONENT FILTERING
      //
      // The cleaned binary mask still has small floating islands
      // (spawn-point markers, far-corner labels). Run a 4-connected
      // flood-fill labelling, count component sizes, then keep only
      // components whose pixel area is at least 0.5 % of the total
      // walkable count. The main playable area is always orders of
      // magnitude bigger than any marker so this drops noise without
      // killing legitimate disconnected regions like Anubis bridge.
      //
      // Uses `doorClosed` (not `closed`) so that rooms bridged by
      // the door-gap pass in step 3.5 are treated as one connected
      // component and are not discarded by the size filter.
      // ============================================================
      const MIN_COMPONENT_FRAC = 0.005;
      const minComponent = Math.max(50, Math.floor(walkCount * MIN_COMPONENT_FRAC));
      const labels = new Int32Array(N); // 0 = unlabelled / wall, >0 = component id
      const stack: number[] = [];
      const componentSizes: number[] = [0]; // component 0 is the "wall" sentinel
      let nextLabel = 1;
      for (let i = 0; i < N; i++) {
        if (doorClosed[i] !== 1 || labels[i] !== 0) continue;
        // Start a new flood-fill from this pixel.
        labels[i] = nextLabel;
        stack.length = 0;
        stack.push(i);
        let size = 0;
        while (stack.length > 0) {
          const j = stack.pop()!;
          size++;
          const x = j % w;
          const y = (j - x) / w;
          if (x > 0 && doorClosed[j - 1] === 1 && labels[j - 1] === 0) {
            labels[j - 1] = nextLabel;
            stack.push(j - 1);
          }
          if (x < w - 1 && doorClosed[j + 1] === 1 && labels[j + 1] === 0) {
            labels[j + 1] = nextLabel;
            stack.push(j + 1);
          }
          if (y > 0 && doorClosed[j - w] === 1 && labels[j - w] === 0) {
            labels[j - w] = nextLabel;
            stack.push(j - w);
          }
          if (y < h - 1 && doorClosed[j + w] === 1 && labels[j + w] === 0) {
            labels[j + w] = nextLabel;
            stack.push(j + w);
          }
        }
        componentSizes.push(size);
        nextLabel++;
      }
      // Keep components ≥ minComponent.
      const keep = new Uint8Array(nextLabel);
      for (let lab = 1; lab < nextLabel; lab++) {
        if (componentSizes[lab] >= minComponent) keep[lab] = 1;
      }
      const filtered = new Uint8Array(N);
      for (let i = 0; i < N; i++) {
        if (labels[i] > 0 && keep[labels[i]] === 1) filtered[i] = 1;
      }

      // (Per-mask HSV statistics console.log removed in the
      // production-ready audit — opaqueCount / walkCount / kept
      // are still computed because step 4 needs them, but we no
      // longer dump them to the console on every mask generation.)

      // ============================================================
      // Step 5 — CHAMFER DISTANCE TRANSFORM → SOFT ALPHA
      //
      // Two-pass chamfer-3,4 distance to nearest wall. Identical to
      // the previous algorithm — kept because the soft fall-off is
      // a safety net for puff edges that extend past a wall in the
      // shader's per-puff sampling pass.
      // ============================================================
      const dist = new Float32Array(N);
      const ORTHO = 1.0;
      const DIAG = Math.SQRT2;
      const INF = Number.POSITIVE_INFINITY;
      for (let i = 0; i < N; i++) {
        dist[i] = filtered[i] === 1 ? INF : 0;
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const idx = y * w + x;
          if (dist[idx] === 0) continue;
          let d = dist[idx];
          if (x > 0) d = Math.min(d, dist[idx - 1] + ORTHO);
          if (y > 0) {
            d = Math.min(d, dist[idx - w] + ORTHO);
            if (x > 0) d = Math.min(d, dist[idx - w - 1] + DIAG);
            if (x < w - 1) d = Math.min(d, dist[idx - w + 1] + DIAG);
          }
          dist[idx] = d;
        }
      }
      for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
          const idx = y * w + x;
          if (dist[idx] === 0) continue;
          let d = dist[idx];
          if (x < w - 1) d = Math.min(d, dist[idx + 1] + ORTHO);
          if (y < h - 1) {
            d = Math.min(d, dist[idx + w] + ORTHO);
            if (x < w - 1) d = Math.min(d, dist[idx + w + 1] + DIAG);
            if (x > 0) d = Math.min(d, dist[idx + w - 1] + DIAG);
          }
          dist[idx] = d;
        }
      }

      // ============================================================
      // Step 6 — write the final alpha mask
      //
      // FALLOFF_PX = 8 — a touch tighter than the v6 mask. The
      // shaders now use a soft wall-mask threshold of their own
      // (smoothstep 0.05 → 0.50) which handles the final edge AA,
      // so the container-level falloff only needs to give the
      // shader a smooth signal to interpolate from.
      // ============================================================
      const FALLOFF_PX = 8;
      for (let i = 0; i < N; i++) {
        const p = i * 4;
        if (filtered[i] === 0) {
          px[p] = 0;
          px[p + 1] = 0;
          px[p + 2] = 0;
          px[p + 3] = 0;
          continue;
        }
        px[p] = 255;
        px[p + 1] = 255;
        px[p + 2] = 255;
        if (isDoorPixel[i] === 1) {
          // Door / archway pixel opened by step 3.5.  Its chamfer
          // distance to the nearest wall is small (1-3 px) because
          // it sits right at the doorframe, which would clamp the
          // alpha to ~0.1-0.3 — well below the smoke shader's
          // smoothstep(0.05, 0.50) cutoff, leaving the door visually
          // blocked.  Force full alpha so the smoke / molotov shader
          // treats the door as fully walkable and lets the cluster
          // pass through.
          px[p + 3] = 255;
          continue;
        }
        const t = Math.max(0, Math.min(1, dist[i] / FALLOFF_PX));
        const s = t * t * (3 - 2 * t);
        px[p + 3] = Math.round(s * 255);
      }
      ctx.putImageData(data, 0, 0);

      // Force linear filtering on the mask source so the alpha is
      // interpolated smoothly when the viewport is zoomed in/out.
      const tex = Texture.from(canvas);
      const source = tex.source;
      if (source) {
        source.scaleMode = "linear";
        source.autoGenerateMipmaps = true;
      }
      wallMaskCache.set(cacheKey, tex);
      wallMaskLoading.delete(cacheKey);
      return tex;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[PixiMapCanvas] Wall mask generation failed for", radarUrl, err);
      wallMaskLoading.delete(cacheKey);
      return null;
    }
  })();
  wallMaskLoading.set(cacheKey, promise);
  return promise;
}

// ---- Easing helpers for the grenade visual effects ----
// All take t ∈ [0, 1], return [0, 1]. Used to shape the grenade
// bloom-in / expansion curves so animations don't feel linear.
function easeOutCubic(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u;
}
function easeOutQuad(t: number): number {
  return 1 - (1 - t) * (1 - t);
}
function easeOutQuart(t: number): number {
  const u = 1 - t;
  return 1 - u * u * u * u;
}

/**
 * Spawn zone — a single thin outline ring at the spawn anchor.
 *
 * Previously drew 6 concentric filled circles that bled the team
 * colour across a wide area, competing with the bright spawn
 * rectangles already baked into the radar PNG. The new outline-only
 * version is a quiet hint (1 px stroke, 30 % alpha) rather than a
 * coloured wash — the user can still spot where each side starts
 * without the marker stealing focus from the gameplay action.
 */
function drawSpawnZone(parent: Container, p: { cx: number; cy: number }, r: number, color: ColorSource) {
  const g = new Graphics();
  g.circle(p.cx, p.cy, r * 0.55)
    .stroke({ color, alpha: 0.30, width: 1 });
  // Tiny anchor dot in the middle so the eye lands on the centre.
  g.circle(p.cx, p.cy, 2)
    .fill({ color, alpha: 0.45 });
  parent.addChild(g);
}

// Note: ``drawSite`` (hex A/B markers) and ``drawCallout`` (named
// zone rings + labels) lived here previously but were removed when
// the user noted that the radar PNG already shows every site +
// callout label baked into the asset — our overlay on top read as
// redundant clutter. If you ever need to bring them back, see the
// git history for the original implementations.

function textStyle(size: number, fill: number, weight: 400 | 600 | 700 | 800, withStroke = false) {
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
