"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  Box,
  Grid3x3,
  Layout,
  Loader2,
  Lock,
  MinusCircle,
  PlusCircle,
  RotateCcw,
} from "lucide-react";

import dynamic from "next/dynamic";

import { ExchangesPanel } from "@/components/replay/ExchangesPanel";
import { FloatingPanel, resetFloatingPanel } from "@/components/replay/FloatingPanel";
import { InsightsPanel } from "@/components/replay/InsightsPanel";
import { KillFeed } from "@/components/replay/KillFeed";
import { LayersPanel } from "@/components/replay/LayersPanel";
import { DEFAULT_LAYERS, type ReplayLayers } from "@/components/replay/layers";
import type { PixiMapCanvasHandle } from "@/components/replay/PixiMapCanvas";
import { ReplayTimelineBar } from "@/components/replay/ReplayTimelineBar";
import { ReplayToolsPanel } from "@/components/replay/ReplayToolsPanel";
import { SingleTeamLoadoutPanel } from "@/components/replay/TeamLoadoutPanel";
import { TransientKillFeed } from "@/components/replay/TransientKillFeed";

// Pixi/WebGL renderer is browser-only — bundled separately so SSR + first
// paint don't pay the WebGL cost.
const PixiMapCanvas = dynamic(
  () => import("@/components/replay/PixiMapCanvas").then((m) => m.PixiMapCanvas),
  { ssr: false },
);
import {
  useDemo,
  useDemoAnalysis,
  useRoundTimeline,
} from "@/lib/hooks/useDemos";
import { useMapMeta } from "@/lib/hooks/useMaps";
import { useRoundPlayback } from "@/lib/hooks/useRoundPlayback";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SaveRoundDialog, type SaveRoundOpts } from "@/components/replay/SaveRoundDialog";
import type { PlayerStats } from "@/types/demo";
import type { BoardEntity, PlaybookData, Vec2 } from "@/types/playbook";

export default function ReplayPage() {
  const params = useParams<{ id: string }>();
  const demoId = params?.id;

  const { data: demo } = useDemo(demoId ?? null);
  const ready = demo?.status === "completed";
  const { data: analysis, isLoading: analysisLoading } = useDemoAnalysis(
    demoId ?? null,
    ready,
  );

  const [currentRound, setCurrentRound] = useState<number | null>(null);
  const [hoveredPlayer, setHoveredPlayer] = useState<string | null>(null);
  const [followSteamId, setFollowSteamId] = useState<string | null>(null);
  const [layers, setLayers] = useState<ReplayLayers>(DEFAULT_LAYERS);
  const [showLayers, setShowLayers] = useState(false);
  // Freehand drawing tool. When on, the map's drag-to-pan is paused
  // and pointer events draw strokes that pan/zoom with the viewport
  // (cs2.cam-style tactical-board annotation). Cleared via the trash
  // button on the bottom toolbar.
  const [drawingMode, setDrawingMode] = useState(false);
  // Imperative handle on PixiMapCanvas so the tools panel can fire a
  // screenshot without needing the canvas to subscribe to a prop change.
  const canvasRef = useRef<PixiMapCanvasHandle | null>(null);
  // Transient confirmation after "save round to Playbook".
  const [savedPill, setSavedPill] = useState<string | null>(null);
  const router = useRouter();
  const [saveOpen, setSaveOpen] = useState(false);

  // Panel customization mode. Default OFF — panels are locked at their
  // CS2-style positions (team cards on the right, transient killfeed top
  // left). The user opts into edit mode via the gear icon in the toolbar,
  // which exposes drag/resize/opacity/hide controls on every panel.
  // The choice is persisted so it survives reloads.
  const [editPanels, setEditPanels] = useState(false);
  useEffect(() => {
    try {
      const v = localStorage.getItem("riftscope.editPanels");
      if (v === "1") setEditPanels(true);
    } catch { /* */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem("riftscope.editPanels", editPanels ? "1" : "0"); } catch { /* */ }
  }, [editPanels]);

  const searchParams = useSearchParams();
  // Initial round: honor ?round=N from anti-strat / playbook deep links
  // when it points at a real round, otherwise start at the first round.
  useEffect(() => {
    if (analysis && currentRound === null && analysis.rounds.length > 0) {
      const wanted = Number(searchParams.get("round"));
      const valid =
        Number.isFinite(wanted) && analysis.rounds.some((r) => r.number === wanted);
      setCurrentRound(valid ? wanted : analysis.rounds[0].number);
    }
  }, [analysis, currentRound, searchParams]);

  const { data: timeline, isLoading: timelineLoading } = useRoundTimeline(
    demoId ?? null,
    currentRound,
    ready,
  );

  const { data: mapMeta } = useMapMeta(analysis?.demo.map ?? null);

  // Playable range. When the "show pre/post round" layer is OFF
  // we clamp playback to the actual play window so the user
  // skips the freeze + post seconds entirely. When ON (the
  // default) we let the rAF loop scrub through the whole
  // extended timeline. Falls back to the legacy full-range when
  // the parser didn't emit playStartT / playEndT (older demos
  // parsed before the freeze/post extension landed).
  const playableRange = useMemo(() => {
    if (!timeline) return undefined;
    if (layers.showFreezeAndPost) return undefined; // full range
    const startT = timeline.playStartT ?? 0;
    const endT = timeline.playEndT ?? timeline.durationSeconds;
    return { startT, endT };
  }, [timeline, layers.showFreezeAndPost]);

  const [state, controls] = useRoundPlayback(timeline, playableRange);

  const playerLookup = useMemo(() => {
    const map = new Map<string, PlayerStats>();
    analysis?.players.forEach((p) => map.set(p.steamId, p));
    return map;
  }, [analysis?.players]);

  const round = analysis?.rounds.find((r) => r.number === currentRound);
  const duration = timeline?.durationSeconds ?? 0;
  const remaining = Math.max(0, duration - state.time);
  // Live cumulative score through the currently-selected round. ``+1``
  // counts the current round IFF it's already over (analysis has a
  // winner); otherwise it shows the score BEFORE this round started.
  const ctScoreLive = useMemo(
    () => (analysis?.rounds ?? []).filter(
      (r) => r.winner === "ct" && r.number <= (currentRound ?? 0),
    ).length,
    [analysis?.rounds, currentRound],
  );
  const ttScoreLive = useMemo(
    () => (analysis?.rounds ?? []).filter(
      (r) => r.winner === "tt" && r.number <= (currentRound ?? 0),
    ).length,
    [analysis?.rounds, currentRound],
  );

  // Snapshot the current round's player positions → PlaybookData (the
  // "Import from 2D" flow behind the timeline-bar star).
  const buildRoundData = (): PlaybookData | null => {
    const frame = state.currentFrame;
    if (!analysis || !frame || !frame.players?.length) return null;
    const rs = mapMeta?.radarSize ?? 1024;
    const sc = mapMeta?.scale ?? 4.5;
    const px = mapMeta?.posX ?? -2000;
    const py = mapMeta?.posY ?? 2000;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const uid = () =>
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);

    const entities: BoardEntity[] = [];
    const positions: Record<string, Vec2> = {};
    let ctN = 0;
    let ttN = 0;
    for (const p of frame.players) {
      if (!p) continue;
      const team: "ct" | "tt" = p.team === "tt" ? "tt" : "ct";
      const id = uid();
      entities.push({ id, kind: "player", team, label: String(team === "ct" ? ++ctN : ++ttN), rot: 0 });
      positions[id] = {
        x: clamp01((p.x - px) / (sc * rs)),
        y: clamp01((py - p.y) / (sc * rs)),
      };
    }
    return {
      schemaVersion: 1,
      entities,
      frames: [{ id: uid(), name: `Round ${currentRound ?? 1}`, durationMs: 1000, positions, hidden: [], strokes: [] }],
    };
  };

  // Called by the SaveRoundDialog after the user picks name / type / folder.
  const confirmSaveRound = async ({ name, type, folderId, openAfter }: SaveRoundOpts) => {
    if (!analysis) throw new Error("No round to save yet");
    const map = analysis.demo.map ?? "de_mirage";

    if (openAfter) {
      // "Save & draw": snapshot the positions onto the tactical board so the
      // user can annotate. This is a hand-drawn tactic, not a round reference.
      const data = buildRoundData();
      if (!data) throw new Error("No round to save yet");
      const created = await api.playbooks.create({
        title: name, map, side: null, type, tags: [],
        teamId: null, folderId, kind: "tactic", data,
      });
      setSavedPill("Guardado ✓");
      setTimeout(() => setSavedPill(null), 2500);
      router.push(`/tactics?load=${created.id}`);
      return;
    }

    // Default "Save": store a REAL reference to this demo round, so replaying
    // it later jumps back to the actual round in the 2D viewer.
    await api.playbooks.create({
      title: name, map, side: null, type, tags: [],
      teamId: null, folderId, kind: "round",
      demoId: demoId ? Number(demoId) : null,
      roundNumber: currentRound,
    });
    setSavedPill("Ronda guardada ✓");
    setTimeout(() => setSavedPill(null), 2500);
  };

  // ============== Loading / processing states ==============
  if (!ready) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-background">
        <div className="flex items-center gap-3 px-6 py-3 rounded-lg bg-surface-elevated/60 border border-border">
          <Loader2 className="animate-spin text-primary" size={18} />
          <span className="text-sm text-muted-foreground">
            Waiting for demo to finish processing…
          </span>
        </div>
      </div>
    );
  }

  if (analysisLoading || !analysis) {
    return (
      <div className="absolute inset-0 p-4 flex flex-col gap-3 bg-background">
        <div className="h-12 shimmer-loading rounded-lg" />
        <div className="flex-1 shimmer-loading rounded-xl" />
        <div className="h-32 shimmer-loading rounded-lg" />
      </div>
    );
  }

  return (
    // ``absolute inset-0`` fills the parent ``<main>`` (which is
    // ``position: relative`` on the replay route) exactly. This
    // bypasses the flex-chain height-cascade issue that left a black
    // strip below the timeline bar with ``h-full`` or ``flex-1``.
    <div className="absolute inset-0 flex flex-col bg-background overflow-hidden">
      {/* ================= TOP BAR (minimal) ================= */}
      <header className="relative h-10 flex items-center px-3 border-b border-border/40 bg-surface/40 backdrop-blur-sm z-20">
        <Link
          href={`/demo/${demoId}/overview`}
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft size={13} />
          Back
        </Link>

        <span className="ml-3 text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground">
          {mapMeta?.displayName ?? analysis.demo.map ?? "—"}
        </span>

        {round && (
          <span
            className={cn(
              "rs-badge ml-auto",
              round.winner === "ct" ? "bg-ct/15 text-ct" : "bg-tt/15 text-tt",
            )}
          >
            R{round.number} · {round.winner.toUpperCase()} · {round.endReason}
          </span>
        )}
      </header>

      {/* ================= MAIN AREA ================= */}
      <main className="relative flex-1 overflow-hidden">
        {savedPill && (
          <div className="absolute top-16 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-lg bg-background/90 backdrop-blur border border-primary/40 text-xs font-mono-rs text-primary shadow-lg pointer-events-none">
            {savedPill}
          </div>
        )}
        {/* MAP — fills the entire main area as background */}
        <div className="absolute inset-0">
          {/* Subtle vignette around the canvas edges — radial gradient
              from transparent in the centre to ~22 % black in the
              corners. Pulls the eye toward the centre playable area
              and lets the dark UI chrome blend in cleanly. Pure CSS,
              no Pixi cost. ``pointer-events-none`` so it never
              intercepts clicks on the canvas underneath. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-[5]"
            style={{
              background:
                "radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.22) 100%)",
            }}
          />
          {timelineLoading && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/70 backdrop-blur-sm pointer-events-none">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="animate-spin text-primary" size={14} />
                Loading round {currentRound}…
              </div>
            </div>
          )}
          <PixiMapCanvas
            mapName={analysis.demo.map}
            mapMeta={mapMeta}
            frame={state.currentFrame}
            pastEvents={state.pastEvents}
            currentTime={state.time}
            allFrames={timeline?.frames}
            focusedSteamId={hoveredPlayer}
            followSteamId={followSteamId}
            playerLookup={playerLookup}
            layers={layers}
            fullBleed
            drawingMode={drawingMode}
            onReady={(h) => { canvasRef.current = h; }}
          />
        </div>

        {/* TOP CENTER — Live scoreboard: CT score | round timer | TT score.
            The score is the primary signal of a replay (who's winning) and
            was previously absent — viewers had no way to tell the match
            state at a glance. Team-coloured numbers flank the timer
            (HLTV / Leetify / cs2.cam pattern). */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none flex flex-col items-center gap-2">
          <div className="rounded-md bg-background/85 backdrop-blur-md border border-border/50 px-3 py-1.5 shadow-lg flex items-center gap-3">
            {/* CT score */}
            <span
              className="font-display font-extrabold text-2xl tabular-nums leading-none"
              style={{ color: "#4a9eff" }}  // TEAM_COLOR_CT
              title="Counter-Terrorist score"
            >
              {ctScoreLive}
            </span>
            {/* Timer + round number */}
            <div className="flex flex-col items-center gap-0.5 px-2 border-x border-border/50">
              <span className="font-display font-bold text-lg tabular-nums tracking-tight leading-none">
                {formatTime(remaining)}
              </span>
              <span className="text-[9px] font-mono-rs uppercase tracking-widest text-muted-foreground leading-none">
                Round {currentRound ?? "—"}
              </span>
            </div>
            {/* TT score */}
            <span
              className="font-display font-extrabold text-2xl tabular-nums leading-none"
              style={{ color: "#ffb347" }}  // TEAM_COLOR_TT
              title="Terrorist score"
            >
              {ttScoreLive}
            </span>
          </div>
          {/* Replay operator tools: Follow / Jump-to-time / Screenshot */}
          <ReplayToolsPanel
            players={analysis.players}
            followSteamId={followSteamId}
            onFollowChange={setFollowSteamId}
            currentTime={state.time}
            duration={duration}
            onJumpTo={(s) => controls.seek(s)}
            onScreenshot={() =>
              canvasRef.current?.screenshot({
                mapLabel: mapMeta?.displayName ?? analysis.demo.map ?? "map",
              })
            }
          />
        </div>

        {/* LEFT EDGE — Map tools strip (lock / zoom / refresh / grid / 3D) */}
        <aside className="absolute top-3 left-3 flex flex-col items-stretch rounded-lg overflow-hidden bg-background/85 backdrop-blur-md border border-border/50 shadow-lg pointer-events-auto">
          <ToolStripBtn
            icon={Lock}
            title="Lock view (coming soon)"
            disabled
          />
          <ToolStripBtn
            icon={PlusCircle}
            title="Zoom in"
            onClick={() => canvasRef.current?.zoomBy(1.4)}
          />
          <ToolStripBtn
            icon={MinusCircle}
            title="Zoom out"
            onClick={() => canvasRef.current?.zoomBy(1 / 1.4)}
          />
          <ToolStripBtn
            icon={RotateCcw}
            title="Reset view"
            onClick={() => canvasRef.current?.resetView()}
          />
          <ToolStripBtn
            icon={Grid3x3}
            title="Toggle grid"
            active={layers.grid}
            onClick={() => setLayers((l) => ({ ...l, grid: !l.grid }))}
          />
          <ToolStripBtn
            icon={Box}
            title="3D view (coming soon)"
            disabled
          />
          <ToolStripBtn
            icon={Layout}
            title={editPanels ? "Lock panels (exit edit mode)" : "Edit panel layout"}
            active={editPanels}
            onClick={() => setEditPanels((v) => !v)}
          />
          {editPanels && (
            <ToolStripBtn
              icon={RotateCcw}
              title="Reset panels to defaults"
              onClick={() => {
                for (const pid of [
                  "insights", "exchanges", "killfeed",
                  "team-alpha", "team-bravo",
                ]) {
                  try {
                    localStorage.removeItem(`riftscope.panel.${pid}`);
                  } catch {/* */}
                }
                resetFloatingPanel("team-alpha");
              }}
            />
          )}
        </aside>

        {/* ====== HUD PANELS ======
            Two modes:
              • LOCKED (default) — CS2-style HUD with team cards pinned on
                the right and a transient killfeed top-left that fades after
                a few seconds. No drag chrome, no opacity slider.
              • EDIT — every panel becomes a FloatingPanel with drag/resize/
                opacity controls + persistent state in localStorage, plus
                the auxiliary Insights / Exchanges panels become available.
            We compute panel defaults once per render so the locked layout
            tracks the current viewport width without needing the user to
            reset state when they swap monitors.
        */}
        {(() => {
          const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
          const vh = typeof window !== "undefined" ? window.innerHeight : 1080;
          const PANEL_W = 320;
          const RIGHT_X = vw - PANEL_W - 12;

          // ``<main>`` is the floating-panel coordinate space. Its height
          // is viewport height minus the page's own header (h-10 = 40 px)
          // and the bottom timeline bar (compact = ~78 px).
          //
          // IMPORTANT: locked FloatingPanels use ``position: fixed`` so
          // their ``y`` is measured from the VIEWPORT TOP, not from the
          // main area. We add ``PAGE_HEADER`` when handing the y to the
          // panel so the panel sits BELOW the "Back / INFERNO" header
          // instead of overlapping it. (The TEAM_H math still uses
          // main-relative space because that's the visible canvas area.)
          const PAGE_HEADER = 40;
          const BOTTOM_BAR = 78;
          const mainH = vh - PAGE_HEADER - BOTTOM_BAR;
          const TOP_Y = 8;
          // Two stacked panels with an 8px gap. Subtract the top inset,
          // the gap, and a small bottom margin so the second panel never
          // touches the bottom-bar border line.
          const PANEL_GAP = 8;
          const BOTTOM_INSET = 8;
          // Each panel needs to fit: 28 px header + up to 6 player rows
          // (~42 px alive) = up to 280 px in the worst case (some demos
          // have a non-player or coach slot pushing the roster to 6).
          // Floor at 290 so the last player is never clipped on small
          // viewports.
          const TEAM_H = Math.max(
            290,
            Math.floor((mainH - TOP_Y - PANEL_GAP - BOTTOM_INSET) / 2),
          );
          const BOTTOM_Y = TOP_Y + TEAM_H + PANEL_GAP;
          // Viewport-relative coordinates for the fixed-positioned panels.
          const TOP_Y_VIEWPORT = TOP_Y + PAGE_HEADER;
          const BOTTOM_Y_VIEWPORT = BOTTOM_Y + PAGE_HEADER;

          // Per-team scores derived from completed rounds (live as we scrub).
          const ctScore = analysis.rounds.filter((r) => r.winner === "ct" && r.number <= (currentRound ?? 0)).length;
          const ttScore = analysis.rounds.filter((r) => r.winner === "tt" && r.number <= (currentRound ?? 0)).length;

          return (
            <>
              {/* --- Transient killfeed (locked mode only) --- */}
              {!editPanels && (
                <TransientKillFeed
                  events={state.pastEvents}
                  playerLookup={playerLookup}
                  currentTime={state.time}
                  ttl={4}
                />
              )}

              {/*
                Team Alpha + Team Bravo rendering.

                In LOCKED mode (default HUD) we render BOTH panels inside
                a single ``flex flex-col gap-2`` container so they auto-
                stack tightly — Team Bravo always docks right under
                Team Alpha, regardless of how many players each team
                has. The container has no maximum height so both panels
                claim only the vertical space their content needs and
                the rest of the right column is left for the canvas /
                zoom controls.

                In EDIT mode each panel becomes its own ``FloatingPanel``
                with drag + resize + opacity slider, positioned at the
                same defaults but independently movable thereafter.
              */}
              {!editPanels ? (
                <div
                  className="fixed z-30 flex flex-col gap-2 pointer-events-none"
                  style={{
                    right: 12,
                    top: TOP_Y_VIEWPORT,
                    width: PANEL_W,
                  }}
                >
                  <div className="pointer-events-auto">
                    <SingleTeamLoadoutPanel
                      team="ct"
                      teamName="Team Alpha"
                      frame={state.currentFrame}
                      loadouts={timeline?.loadouts}
                      playerLookup={playerLookup}
                      pastEvents={state.pastEvents}
                      score={ctScore}
                      focusedSteamId={hoveredPlayer}
                      onHover={setHoveredPlayer}
                      roundNumber={currentRound ?? undefined}
                    />
                  </div>
                  <div className="pointer-events-auto">
                    <SingleTeamLoadoutPanel
                      team="tt"
                      teamName="Team Bravo"
                      frame={state.currentFrame}
                      loadouts={timeline?.loadouts}
                      playerLookup={playerLookup}
                      pastEvents={state.pastEvents}
                      score={ttScore}
                      focusedSteamId={hoveredPlayer}
                      onHover={setHoveredPlayer}
                      roundNumber={currentRound ?? undefined}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <FloatingPanel
                    id="team-alpha"
                    title="Team Alpha"
                    transparent
                    defaults={{ x: RIGHT_X, y: TOP_Y_VIEWPORT, w: PANEL_W, h: TEAM_H, opacity: 0.95 }}
                    minWidth={240}
                    minHeight={180}
                  >
                    <SingleTeamLoadoutPanel
                      team="ct"
                      teamName="Team Alpha"
                      frame={state.currentFrame}
                      loadouts={timeline?.loadouts}
                      playerLookup={playerLookup}
                      pastEvents={state.pastEvents}
                      score={ctScore}
                      focusedSteamId={hoveredPlayer}
                      onHover={setHoveredPlayer}
                      roundNumber={currentRound ?? undefined}
                    />
                  </FloatingPanel>
                  <FloatingPanel
                    id="team-bravo"
                    title="Team Bravo"
                    transparent
                    defaults={{ x: RIGHT_X, y: BOTTOM_Y_VIEWPORT, w: PANEL_W, h: TEAM_H, opacity: 0.95 }}
                    minWidth={240}
                    minHeight={180}
                  >
                    <SingleTeamLoadoutPanel
                      team="tt"
                      teamName="Team Bravo"
                      frame={state.currentFrame}
                      loadouts={timeline?.loadouts}
                      playerLookup={playerLookup}
                      pastEvents={state.pastEvents}
                      score={ttScore}
                      focusedSteamId={hoveredPlayer}
                      onHover={setHoveredPlayer}
                      roundNumber={currentRound ?? undefined}
                    />
                  </FloatingPanel>
                </>
              )}

              {/* --- Auxiliary panels: only available in edit mode --- */}
              {editPanels && demoId && (
                <>
                  <FloatingPanel
                    id="insights"
                    title="Insights"
                    defaults={{ x: 12, y: TOP_Y, w: 340, h: 220, opacity: 0.92 }}
                    minWidth={260}
                    minHeight={140}
                  >
                    <InsightsPanel demoId={demoId} currentRound={currentRound} />
                  </FloatingPanel>
                  <FloatingPanel
                    id="exchanges"
                    title="Exchanges"
                    defaults={{ x: 12, y: TOP_Y + 240, w: 340, h: 180, opacity: 0.92 }}
                    minWidth={240}
                    minHeight={120}
                  >
                    <ExchangesPanel
                      events={state.pastEvents}
                      playerLookup={playerLookup}
                    />
                  </FloatingPanel>
                  <FloatingPanel
                    id="killfeed"
                    title="Killfeed (persistent)"
                    defaults={{ x: 12, y: TOP_Y + 440, w: 340, h: 220, opacity: 0.92 }}
                    minWidth={260}
                    minHeight={120}
                  >
                    <KillFeed
                      events={state.pastEvents}
                      playerLookup={playerLookup}
                      onHover={setHoveredPlayer}
                    />
                  </FloatingPanel>
                </>
              )}
            </>
          );
        })()}

        {/* LEFT BOTTOM — Layers panel (toggle from bottom bar gear) */}
        {showLayers && (
          <aside className="absolute bottom-3 left-16 w-[260px] z-10 animate-fade-in pointer-events-auto">
            <LayersPanel layers={layers} onChange={setLayers} />
          </aside>
        )}
      </main>

      {/* ================= BOTTOM BAR (unified) ================= */}
      <ReplayTimelineBar
        rounds={analysis.rounds}
        currentRound={currentRound ?? 1}
        onRoundChange={setCurrentRound}
        state={state}
        controls={controls}
        duration={duration}
        events={timeline?.events ?? []}
        playerLookup={playerLookup}
        onHover={setHoveredPlayer}
        onToggleLayers={() => setShowLayers((v) => !v)}
        drawingMode={drawingMode}
        onToggleDrawing={() => setDrawingMode((v) => !v)}
        onClearDrawings={() => canvasRef.current?.clearDrawings()}
        onBookmark={() => setSaveOpen(true)}
      />

      <SaveRoundDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        suggestedName={`${mapMeta?.displayName ?? analysis.demo.map ?? "Map"} · Round ${currentRound ?? 1}`}
        onConfirm={confirmSaveRound}
      />
    </div>
  );
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) s = 0;
  const mm = Math.floor(s / 60).toString().padStart(2, "0");
  const ss = Math.floor(s % 60).toString().padStart(2, "0");
  return `${mm}:${ss}`;
}

function ToolStripBtn({
  icon: Icon,
  title,
  onClick,
  disabled = false,
  active = false,
}: {
  icon: React.ElementType;
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        "w-9 h-9 flex items-center justify-center transition-colors border-b border-border/30 last:border-b-0",
        active
          ? "bg-primary-dim text-primary"
          : disabled
            ? "text-muted-foreground/40 cursor-not-allowed"
            : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={14} />
    </button>
  );
}
