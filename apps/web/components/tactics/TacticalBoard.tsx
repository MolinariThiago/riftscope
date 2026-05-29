"use client";

import { useEffect, useRef, useState } from "react";
import {
  Application,
  Assets,
  ColorMatrixFilter,
  Container,
  Graphics,
  Sprite,
  Text,
  TextStyle,
  Texture,
} from "pixi.js";
import { Viewport } from "pixi-viewport";

import { usePlaybook } from "@/lib/stores/playbook";
import type { BoardEntity, BoardStroke, EntityKind, PlaybookFrame, Vec2 } from "@/types/playbook";
import type { MapMetadata } from "@/types/demo";

const FALLBACK_RADAR_SIZE = 1024;
const FALLBACK_SCALE = 4.5;

const COLOR_CT = 0x4a9eff;
const COLOR_TT = 0xffb347;
const UTIL_COLOR: Record<string, number> = {
  smoke: 0xcfd2d6,
  molotov: 0xff7a2f,
  incendiary: 0xff9433,
  flash: 0xffe066,
  he: 0xff7a3a,
  decoy: 0x9aa3ad,
  bomb: 0xff5757,
};

// Real CS2 grenade icons (public/weapons/). Rendered white via a
// ColorMatrix filter so they read cleanly on any backdrop.
const UTIL_ICON: Partial<Record<EntityKind, string>> = {
  smoke: "/weapons/smokegrenade.webp",
  molotov: "/weapons/molotov.svg",
  incendiary: "/weapons/incgrenade.webp",
  flash: "/weapons/flashbang.webp",
  he: "/weapons/hegrenade.svg",
  decoy: "/weapons/decoy.svg",
};

export interface TacticalBoardHandle {
  zoomBy: (factor: number) => void;
  resetView: () => void;
  screenshot: () => Promise<void>;
  /** Interpolate the whole sequence to a normalized time (0..1) — used by the scrubber. */
  seek: (t01: number) => void;
}

interface Props {
  mapMeta?: MapMetadata | null;
  /** Used to fall back to the local radar PNG when the API omits radarUrl. */
  mapName?: string | null;
  onReady?: (handle: TacticalBoardHandle) => void;
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

function entityColor(e: BoardEntity): number {
  if (e.kind === "player") return e.team === "tt" ? COLOR_TT : COLOR_CT;
  return UTIL_COLOR[e.kind] ?? 0xffffff;
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

// Smooth radial fill via stacked concentric circles (overlap accumulates
// alpha → denser centre, feathered edge) — reads like a real cloud/blast.
function radialFill(g: Graphics, r: number, color: number, layers = 9, perLayer = 0.055) {
  for (let k = layers; k >= 1; k--) {
    g.circle(0, 0, r * (k / layers)).fill({ color, alpha: perLayer });
  }
}

// Smoke: soft gray cloud + organic edge puffs + crisp accurate-radius ring.
function drawSmoke(g: Graphics, r: number) {
  radialFill(g, r, 0xd6dbe1, 9, 0.05);
  const puffs = [
    [0.4, 0.16], [-0.38, 0.26], [0.1, -0.4], [-0.2, -0.28], [0.32, -0.1], [-0.02, 0.4],
  ];
  for (const [dx, dy] of puffs) {
    g.circle(dx * r, dy * r, r * 0.46).fill({ color: 0xe6e9ed, alpha: 0.05 });
  }
  g.circle(0, 0, r * 0.32).fill({ color: 0xeef1f4, alpha: 0.1 });
  g.circle(0, 0, r).stroke({ color: 0xffffff, alpha: 0.12, width: 6 }); // soft glow edge
  g.circle(0, 0, r).stroke({ color: 0xe6e9ed, alpha: 0.7, width: 2 }); // accurate radius
}

// Molotov / incendiary: warm radial fire fill + hot core + radius ring.
function drawFire(g: Graphics, r: number) {
  for (let k = 9; k >= 1; k--) {
    const t = k / 9;
    const col = t > 0.66 ? 0x9c2a08 : t > 0.33 ? 0xd2480f : 0xef6820;
    g.circle(0, 0, r * t).fill({ color: col, alpha: 0.06 });
  }
  g.circle(0, 0, r * 0.3).fill({ color: 0xffb020, alpha: 0.16 });
  g.circle(0, 0, r * 0.14).fill({ color: 0xffe26a, alpha: 0.2 });
  g.circle(0, 0, r).stroke({ color: 0xff7a3a, alpha: 0.14, width: 6 });
  g.circle(0, 0, r).stroke({ color: 0xff8a3a, alpha: 0.75, width: 2 });
}

// HE: faint blast fill + crisp radius ring (distinct from a persistent area).
function drawHe(g: Graphics, r: number) {
  radialFill(g, r, 0xff7a3a, 6, 0.04);
  g.circle(0, 0, r).stroke({ color: 0xff7a3a, alpha: 0.7, width: 2 });
}

export function TacticalBoard({ mapMeta, mapName, onReady }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const appRef = useRef<Application | null>(null);
  const vpRef = useRef<Viewport | null>(null);
  const entityLayerRef = useRef<Container | null>(null);
  const strokeLayerRef = useRef<Container | null>(null);
  const tempGfxRef = useRef<Graphics | null>(null);
  const radarSpriteRef = useRef<Sprite | null>(null);
  const nodesRef = useRef<Map<string, Container>>(new Map());
  const utilTexRef = useRef<Map<string, Texture | null>>(new Map());
  const whiteFilterRef = useRef<ColorMatrixFilter | null>(null);
  const [ready, setReady] = useState(false);

  const radarSize = mapMeta?.radarSize ?? FALLBACK_RADAR_SIZE;
  const scale = mapMeta?.scale ?? FALLBACK_SCALE;
  // Prefer the API-provided radar; fall back to the local PNG (public/maps)
  // so the board always has a backdrop even if map metadata is missing.
  const radarUrl = mapMeta?.radarUrl ?? (mapName ? `/maps/${mapName}.png` : null);

  const entities = usePlaybook((s) => s.entities);
  const frames = usePlaybook((s) => s.frames);
  const currentFrameId = usePlaybook((s) => s.currentFrameId);
  const tool = usePlaybook((s) => s.tool);
  const color = usePlaybook((s) => s.color);
  const strokeWidth = usePlaybook((s) => s.strokeWidth);
  const selectedEntityId = usePlaybook((s) => s.selectedEntityId);
  const placingId = usePlaybook((s) => s.placingId);
  const isPlaying = usePlaybook((s) => s.isPlaying);

  const stateRef = useRef({ tool, color, strokeWidth, radarSize, scale, currentFrameId });
  stateRef.current = { tool, color, strokeWidth, radarSize, scale, currentFrameId };
  const placingRef = useRef<string | null>(placingId);
  placingRef.current = placingId;
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const currentFrame = frames.find((f) => f.id === currentFrameId) ?? frames[0];
  const currentFrameRef = useRef<PlaybookFrame | undefined>(currentFrame);
  currentFrameRef.current = currentFrame;

  const normToWorld = (p: Vec2) => ({ x: p.x * radarSize, y: p.y * radarSize });
  const radiusPx = (rw: number) => rw / scale;

  // ============== App init ==============
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    let cancelled = false;
    const app = new Application();
    appRef.current = app;

    (async () => {
      await app.init({
        background: "#05070b",
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

      // White-out filter for utility icons (forces RGB→white, keeps alpha).
      const wf = new ColorMatrixFilter();
      wf.matrix = [0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0];
      whiteFilterRef.current = wf;

      const vp = new Viewport({
        screenWidth: host.clientWidth,
        screenHeight: host.clientHeight,
        worldWidth: radarSize,
        worldHeight: radarSize,
        events: app.renderer.events,
      });
      app.stage.addChild(vp);
      vp.drag().pinch().wheel({ smooth: 5, percent: 0.12 }).clampZoom({ minScale: 0.3, maxScale: 8 });
      vp.fit();
      vp.moveCenter(radarSize / 2, radarSize / 2);
      vp.setZoom(host.clientWidth / radarSize, true);
      vpRef.current = vp;

      const radar = new Container();
      const strokes = new Container();
      const entitiesLayer = new Container();
      const temp = new Graphics();
      vp.addChild(radar, strokes, entitiesLayer, temp);
      (radar as Container & { __radar?: boolean }).__radar = true;
      strokeLayerRef.current = strokes;
      entityLayerRef.current = entitiesLayer;
      tempGfxRef.current = temp;

      // Preload real grenade icons.
      await Promise.all(
        (Object.keys(UTIL_ICON) as EntityKind[]).map(async (kind) => {
          try {
            const tex = await Assets.load(UTIL_ICON[kind]!);
            utilTexRef.current.set(kind, tex as Texture);
          } catch {
            utilTexRef.current.set(kind, null);
          }
        }),
      );
      if (cancelled) return;

      const stage = app.stage;
      stage.eventMode = "static";
      stage.hitArea = app.screen;
      stage.on("pointerdown", onStagePointerDown);
      stage.on("pointermove", onStagePointerMove);
      stage.on("pointerup", onStagePointerUp);
      stage.on("pointerupoutside", onStagePointerUp);

      setReady(true);
      app.renderer.render(app.stage);

      onReady?.({
        zoomBy: (factor: number) => {
          const v = vpRef.current;
          if (!v) return;
          v.setZoom(Math.min(8, Math.max(0.3, v.scale.x * factor)), true);
        },
        resetView: () => {
          const v = vpRef.current;
          if (!v) return;
          v.fit();
          v.moveCenter(radarSize / 2, radarSize / 2);
          v.setZoom(host.clientWidth / radarSize, true);
        },
        screenshot: async () => {
          const a = appRef.current;
          if (!a) return;
          try {
            const url = await (a.renderer.extract as any).base64(a.stage);
            const link = document.createElement("a");
            link.href = url;
            link.download = "riftscope-tactic.png";
            link.click();
          } catch {
            /* */
          }
        },
        seek: (t01: number) => applyAt(t01),
      });
      forceRedraw();
    })();

    return () => {
      cancelled = true;
      setReady(false);
      nodesRef.current.clear();
      if (appRef.current) {
        try {
          appRef.current.destroy(true, { children: true });
        } catch {
          /* */
        }
        appRef.current = null;
        vpRef.current = null;
        entityLayerRef.current = null;
        strokeLayerRef.current = null;
        tempGfxRef.current = null;
        radarSpriteRef.current = null;
        whiteFilterRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radarSize]);

  // ============== Resize ==============
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const ro = new ResizeObserver(() => {
      const app = appRef.current;
      const vp = vpRef.current;
      if (!app || !vp) return;
      app.renderer.resize(host.clientWidth, host.clientHeight);
      vp.resize(host.clientWidth, host.clientHeight, radarSize, radarSize);
    });
    ro.observe(host);
    return () => ro.disconnect();
  }, [radarSize]);

  // ============== Radar sprite ==============
  useEffect(() => {
    if (!ready) return;
    const vp = vpRef.current;
    if (!vp) return;
    let cancelled = false;
    const radarLayer = vp.children.find(
      (c) => (c as Container & { __radar?: boolean }).__radar,
    ) as Container | undefined;
    if (radarSpriteRef.current) {
      radarSpriteRef.current.destroy();
      radarSpriteRef.current = null;
    }
    if (!radarUrl || !radarLayer) return;
    (async () => {
      try {
        const tex = await Assets.load(radarUrl);
        if (cancelled) return;
        const sprite = new Sprite(tex);
        sprite.width = radarSize;
        sprite.height = radarSize;
        sprite.tint = 0xc2c8d0;
        radarLayer.addChild(sprite);
        radarSpriteRef.current = sprite;
        appRef.current?.renderer.render(appRef.current.stage);
      } catch {
        /* */
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, radarUrl, radarSize]);

  // ============== Tool → viewport drag ==============
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    try {
      if (tool === "select") vp.plugins.resume("drag");
      else vp.plugins.pause("drag");
    } catch {
      /* */
    }
  }, [tool]);

  // Track Shift for shape constraints (square / perfect circle).
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Shift") shiftRef.current = false;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ============== Redraw ==============
  useEffect(() => {
    if (!ready || isPlaying) return;
    forceRedraw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, entities, frames, currentFrameId, selectedEntityId, scale, radarSize, isPlaying]);

  function forceRedraw() {
    const layer = entityLayerRef.current;
    const strokeLayer = strokeLayerRef.current;
    if (!layer || !strokeLayer) return;
    const frame = currentFrame;
    if (!frame) return;
    const hidden = new Set(frame.hidden ?? []);

    const nodes = nodesRef.current;
    const seen = new Set<string>();
    for (const e of entities) {
      seen.add(e.id);
      let node = nodes.get(e.id);
      if (!node) {
        node = buildNode(e);
        layer.addChild(node);
        nodes.set(e.id, node);
      }
      const pos = frame.positions[e.id];
      if (pos) {
        const w = normToWorld(pos);
        node.position.set(w.x, w.y);
      }
      node.visible = !hidden.has(e.id);
      node.alpha = e.id === selectedEntityId ? 1 : 0.97;
      styleNode(node, e, e.id === selectedEntityId);
    }
    nodes.forEach((node, id) => {
      if (!seen.has(id)) {
        node.destroy({ children: true });
        nodes.delete(id);
      }
    });

    strokeLayer.removeChildren().forEach((c) => c.destroy());
    for (const s of frame.strokes) drawStroke(strokeLayer, s);

    appRef.current?.renderer.render(appRef.current.stage);
  }

  function buildNode(e: BoardEntity): Container {
    const node = new Container();
    node.eventMode = "static";
    node.cursor = "pointer";
    const visual = new Graphics();
    (visual as any).__role = "visual";
    const disc = new Graphics();
    (disc as any).__role = "disc";
    const icon = new Sprite();
    icon.anchor.set(0.5);
    icon.visible = false;
    (icon as any).__role = "icon";
    const label = new Text({
      text: "",
      style: new TextStyle({ fill: 0xffffff, fontSize: 15, fontWeight: "700", fontFamily: "monospace" }),
    });
    label.anchor.set(0.5);
    (label as any).__role = "label";
    node.addChild(visual, disc, icon, label);
    attachDrag(node, e.id);
    return node;
  }

  function styleNode(node: Container, e: BoardEntity, selected: boolean) {
    const col = entityColor(e);
    const visual = node.children.find((c) => (c as any).__role === "visual") as Graphics;
    const disc = node.children.find((c) => (c as any).__role === "disc") as Graphics;
    const icon = node.children.find((c) => (c as any).__role === "icon") as Sprite;
    const label = node.children.find((c) => (c as any).__role === "label") as Text;

    visual.clear();
    disc.clear();
    icon.filters = [];

    if (e.kind === "player") {
      icon.visible = false;
      const R = 12;
      // Aim "pico" — a triangle nub pointing in the facing direction.
      // Drawn first so the body circle covers its base, leaving the tip out.
      const rot = ((e.rot ?? 0) * Math.PI) / 180;
      const dx = Math.sin(rot);
      const dy = -Math.cos(rot);
      const px = -dy;
      const py = dx;
      const base = R - 1;
      const tip = R + 9;
      const hw = 6;
      disc
        .poly([
          dx * tip, dy * tip,
          dx * base + px * hw, dy * base + py * hw,
          dx * base - px * hw, dy * base - py * hw,
        ])
        .fill({ color: col });
      if (selected) disc.circle(0, 0, R + 5).stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
      disc.circle(0, 0, R + 2).fill({ color: 0x05070b, alpha: 0.9 });
      disc.circle(0, 0, R).fill({ color: col });
      disc.circle(0, 0, R).stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
      label.text = e.label ?? "";
      label.visible = true;
      label.style.fill = 0xffffff;
      label.style.fontSize = 13;
      return;
    }

    // bomb / C4 — drawn badge, no area or icon
    if (e.kind === "bomb") {
      if (selected) disc.roundRect(-20, -14, 40, 28, 6).stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
      disc.roundRect(-17, -11, 34, 22, 5).fill({ color: 0x05070b, alpha: 0.92 });
      disc.roundRect(-17, -11, 34, 22, 5).stroke({ color: col, alpha: 0.95, width: 1.5 });
      icon.visible = false;
      label.text = "C4";
      label.visible = true;
      label.style.fill = col;
      return;
    }

    // utility area visuals
    if (e.kind === "smoke") drawSmoke(visual, radiusPx(e.radiusWorld ?? 144));
    else if (e.kind === "molotov" || e.kind === "incendiary") drawFire(visual, radiusPx(e.radiusWorld ?? 150));
    else if (e.kind === "he" && e.radiusWorld) drawHe(visual, radiusPx(e.radiusWorld));

    // draggable icon handle
    const R = 13;
    if (selected) disc.circle(0, 0, R + 5).stroke({ color: 0xffffff, alpha: 0.9, width: 2 });
    disc.circle(0, 0, R).fill({ color: 0x05070b, alpha: 0.82 });
    disc.circle(0, 0, R).stroke({ color: col, alpha: 0.85, width: 1.5 });

    const tex = utilTexRef.current.get(e.kind);
    if (tex) {
      icon.texture = tex;
      icon.width = R * 1.7;
      icon.height = R * 1.7;
      icon.visible = true;
      if (whiteFilterRef.current) icon.filters = [whiteFilterRef.current];
      label.visible = false;
    } else {
      icon.visible = false;
      label.text = e.kind === "he" ? "HE" : (e.label ?? "?")[0];
      label.visible = true;
      label.style.fill = 0xffffff;
    }
  }

  function paintStroke(g: Graphics, s: BoardStroke) {
    if (s.points.length < 2) return;
    const w = Math.max(1, s.width * radarSize);
    const pts = s.points.map((p) => normToWorld(p));
    if (s.tool === "rect" || s.tool === "circle") {
      const a = pts[0];
      const b = pts[1];
      const x = Math.min(a.x, b.x);
      const y = Math.min(a.y, b.y);
      const ww = Math.abs(b.x - a.x);
      const hh = Math.abs(b.y - a.y);
      if (s.tool === "rect") {
        g.rect(x, y, ww, hh).fill({ color: s.color, alpha: 0.06 });
        g.rect(x, y, ww, hh).stroke({ color: s.color, width: w, join: "round" });
      } else {
        g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, ww / 2, hh / 2).fill({ color: s.color, alpha: 0.06 });
        g.ellipse((a.x + b.x) / 2, (a.y + b.y) / 2, ww / 2, hh / 2).stroke({ color: s.color, width: w });
      }
      return;
    }
    g.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
    g.stroke({ color: s.color, width: w, cap: "round", join: "round" });
    if (s.tool === "arrow" && pts.length >= 2) {
      const a = pts[pts.length - 2];
      const b = pts[pts.length - 1];
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      const head = Math.max(14, w * 3.2);
      const left = ang + Math.PI - 0.5;
      const right = ang + Math.PI + 0.5;
      g.moveTo(b.x, b.y)
        .lineTo(b.x + Math.cos(left) * head, b.y + Math.sin(left) * head)
        .moveTo(b.x, b.y)
        .lineTo(b.x + Math.cos(right) * head, b.y + Math.sin(right) * head)
        .stroke({ color: s.color, width: w, cap: "round" });
    }
  }
  function drawStroke(layer: Container, s: BoardStroke) {
    const g = new Graphics();
    paintStroke(g, s);
    layer.addChild(g);
  }

  function attachDrag(node: Container, entityId: string) {
    let grabOffset = { x: 0, y: 0 };
    node.on("pointerdown", (e: any) => {
      // While placing a new entity, let the click fall through to the stage
      // so it drops at the click point instead of starting a drag.
      if (placingRef.current) return;
      if (stateRef.current.tool !== "select") return;
      e.stopPropagation();
      const vp = vpRef.current;
      if (!vp) return;
      usePlaybook.getState().selectEntity(entityId);
      try { vp.plugins.pause("drag"); } catch { /* */ }
      const w = vp.toWorld(e.global);
      grabOffset = { x: node.position.x - w.x, y: node.position.y - w.y };
      dragRef.current = { entityId, node, grabOffset };
    });
  }
  const dragRef = useRef<{ entityId: string; node: Container; grabOffset: Vec2 } | null>(null);
  const drawRef = useRef<{ tool: "pen" | "arrow" | "rect" | "circle"; pts: Vec2[] } | null>(null);
  const shiftRef = useRef(false);

  function onStagePointerDown(e: any) {
    const vp = vpRef.current;
    if (!vp) return;
    const t = stateRef.current.tool;
    const w = vp.toWorld(e.global);
    const rs = stateRef.current.radarSize;
    const norm = { x: w.x / rs, y: w.y / rs };
    // Placement mode: a freshly-added entity follows the cursor; this click drops it.
    if (placingRef.current) {
      usePlaybook.getState().setEntityPosition(placingRef.current, {
        x: clamp01(norm.x),
        y: clamp01(norm.y),
      });
      usePlaybook.getState().setPlacing(null);
      return;
    }
    if (t === "pen" || t === "arrow" || t === "rect" || t === "circle") {
      drawRef.current = { tool: t, pts: [norm] };
    } else if (t === "eraser") eraseAt(norm);
    else if (t === "select") usePlaybook.getState().selectEntity(null);
  }
  function onStagePointerMove(e: any) {
    const vp = vpRef.current;
    if (!vp) return;
    const w = vp.toWorld(e.global);
    // Placement: the pending entity tracks the cursor until dropped.
    if (placingRef.current) {
      const node = nodesRef.current.get(placingRef.current);
      if (node) {
        const rs = stateRef.current.radarSize;
        node.position.set(Math.max(0, Math.min(rs, w.x)), Math.max(0, Math.min(rs, w.y)));
        appRef.current?.renderer.render(appRef.current.stage);
      }
      return;
    }
    if (dragRef.current) {
      const { node, grabOffset } = dragRef.current;
      const rs = stateRef.current.radarSize;
      const nx = Math.max(0, Math.min(rs, w.x + grabOffset.x));
      const ny = Math.max(0, Math.min(rs, w.y + grabOffset.y));
      node.position.set(nx, ny);
      appRef.current?.renderer.render(appRef.current.stage);
      return;
    }
    const draw = drawRef.current;
    if (draw) {
      const rs = stateRef.current.radarSize;
      const norm = { x: w.x / rs, y: w.y / rs };
      if (draw.tool === "pen") {
        draw.pts.push(norm);
      } else {
        let end = norm;
        // Shift constrains rect → square and circle → perfect circle.
        if ((draw.tool === "rect" || draw.tool === "circle") && shiftRef.current) {
          const s0 = draw.pts[0];
          const dx = norm.x - s0.x;
          const dy = norm.y - s0.y;
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          end = { x: s0.x + Math.sign(dx) * m, y: s0.y + Math.sign(dy) * m };
        }
        draw.pts = [draw.pts[0], end];
      }
      previewStroke(draw);
    }
  }
  function onStagePointerUp() {
    if (dragRef.current) {
      const { entityId, node } = dragRef.current;
      const rs = stateRef.current.radarSize;
      usePlaybook.getState().setEntityPosition(entityId, {
        x: clamp01(node.position.x / rs),
        y: clamp01(node.position.y / rs),
      });
      dragRef.current = null;
      if (stateRef.current.tool === "select") {
        try { vpRef.current?.plugins.resume("drag"); } catch { /* */ }
      }
      return;
    }
    const draw = drawRef.current;
    if (draw) {
      tempGfxRef.current?.clear();
      if (draw.pts.length >= 2) {
        usePlaybook.getState().addStroke({
          tool: draw.tool,
          color: stateRef.current.color,
          width: stateRef.current.strokeWidth,
          points: draw.pts,
        });
      }
      drawRef.current = null;
    }
  }
  function previewStroke(draw: { tool: "pen" | "arrow" | "rect" | "circle"; pts: Vec2[] }) {
    const temp = tempGfxRef.current;
    if (!temp) return;
    temp.clear();
    paintStroke(temp, {
      id: "temp",
      tool: draw.tool,
      color: stateRef.current.color,
      width: stateRef.current.strokeWidth,
      points: draw.pts,
    });
    appRef.current?.renderer.render(appRef.current.stage);
  }
  function eraseAt(norm: Vec2) {
    const frame = currentFrameRef.current;
    if (!frame) return;
    const threshold = 0.025;
    const target = frame.strokes.find((s) =>
      s.points.some((p) => Math.hypot(p.x - norm.x, p.y - norm.y) < threshold),
    );
    if (target) usePlaybook.getState().removeStroke(target.id);
  }

  // Total duration (ms) of the step sequence (sum of transition durations).
  function totalMs(): number {
    const fr = framesRef.current;
    let acc = 0;
    for (let i = 1; i < fr.length; i++) acc += fr[i].durationMs;
    return acc;
  }

  // Interpolate every entity to a normalized time across the whole sequence
  // and paint it. Shared by the scrubber (seek) and the play loop.
  function applyAt(t01: number) {
    const fr = framesRef.current;
    const nodes = nodesRef.current;
    const rs = stateRef.current.radarSize;
    if (!fr || fr.length === 0) return;
    const place = (a: PlaybookFrame, b: PlaybookFrame, u: number) => {
      const hiddenA = new Set(a.hidden ?? []);
      const hiddenB = new Set(b.hidden ?? []);
      for (const e of entitiesRef.current) {
        const node = nodes.get(e.id);
        if (!node) continue;
        const pa = a.positions[e.id];
        const pb = b.positions[e.id];
        if (pa && pb) node.position.set(lerp(pa.x, pb.x, u) * rs, lerp(pa.y, pb.y, u) * rs);
        else if (pa) node.position.set(pa.x * rs, pa.y * rs);
        node.visible = u < 0.5 ? !hiddenA.has(e.id) : !hiddenB.has(e.id);
      }
    };
    if (fr.length === 1) {
      place(fr[0], fr[0], 0);
      appRef.current?.renderer.render(appRef.current.stage);
      return;
    }
    const total = totalMs();
    const t = Math.max(0, Math.min(1, t01)) * total;
    let segStart = 0;
    let fromIdx = 0;
    let toIdx = 1;
    let dur = fr[1].durationMs;
    for (let i = 1; i < fr.length; i++) {
      const d = fr[i].durationMs;
      if (t <= segStart + d || i === fr.length - 1) {
        fromIdx = i - 1;
        toIdx = i;
        dur = d;
        break;
      }
      segStart += d;
    }
    const u = easeInOut(Math.max(0, Math.min(1, (t - segStart) / Math.max(1, dur))));
    place(fr[fromIdx], fr[toIdx], u);
    appRef.current?.renderer.render(appRef.current.stage);
  }

  // ============== Playback ==============
  useEffect(() => {
    if (!ready || !isPlaying) return;
    const app = appRef.current;
    if (!app) return;
    if (framesRef.current.length < 2) {
      usePlaybook.getState().setPlaying(false);
      return;
    }
    const total = totalMs();
    // Resume from the current playhead (so play continues after a scrub);
    // restart from 0 if we're already at the end.
    let clock = usePlaybook.getState().playhead * total;
    if (clock >= total) clock = 0;

    const tick = () => {
      const speed = usePlaybook.getState().speed || 1;
      clock += app.ticker.deltaMS * speed;
      if (clock >= total) {
        if (usePlaybook.getState().loop) {
          clock = 0;
        } else {
          applyAt(1);
          usePlaybook.getState().setPlayhead(1);
          usePlaybook.getState().setPlaying(false);
          return;
        }
      }
      const t01 = total > 0 ? clock / total : 0;
      applyAt(t01);
      usePlaybook.getState().setPlayhead(t01);
    };
    app.ticker.add(tick);
    return () => {
      app.ticker.remove(tick);
      // On stop/pause, land on the nearest step so the static view matches.
      const fr = framesRef.current;
      if (fr && fr.length > 1) {
        const tt = usePlaybook.getState().playhead * total;
        let acc = 0;
        let nearest = 0;
        let best = Math.abs(tt);
        for (let i = 1; i < fr.length; i++) {
          acc += fr[i].durationMs;
          const d = Math.abs(tt - acc);
          if (d < best) {
            best = d;
            nearest = i;
          }
        }
        const id = fr[nearest].id;
        if (usePlaybook.getState().currentFrameId !== id) {
          usePlaybook.getState().setCurrentFrame(id);
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, isPlaying]);

  return <div ref={containerRef} className="absolute inset-0" />;
}
