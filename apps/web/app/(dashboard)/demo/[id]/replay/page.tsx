"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import {
  ArrowLeft,
  Box,
  Grid3x3,
  Loader2,
  Lock,
  MinusCircle,
  PlusCircle,
  RotateCcw,
} from "lucide-react";

import dynamic from "next/dynamic";

import { ExchangesPanel } from "@/components/replay/ExchangesPanel";
import { InsightsPanel } from "@/components/replay/InsightsPanel";
import { KillFeed } from "@/components/replay/KillFeed";
import { LayersPanel } from "@/components/replay/LayersPanel";
import { DEFAULT_LAYERS, type ReplayLayers } from "@/components/replay/layers";
import { ReplayTimelineBar } from "@/components/replay/ReplayTimelineBar";
import { TeamLoadoutPanel } from "@/components/replay/TeamLoadoutPanel";

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
import { cn } from "@/lib/utils";
import type { PlayerStats } from "@/types/demo";

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
  const [layers, setLayers] = useState<ReplayLayers>(DEFAULT_LAYERS);
  const [showLayers, setShowLayers] = useState(false);

  useEffect(() => {
    if (analysis && currentRound === null && analysis.rounds.length > 0) {
      setCurrentRound(analysis.rounds[0].number);
    }
  }, [analysis, currentRound]);

  const { data: timeline, isLoading: timelineLoading } = useRoundTimeline(
    demoId ?? null,
    currentRound,
    ready,
  );

  const { data: mapMeta } = useMapMeta(analysis?.demo.map ?? null);

  const [state, controls] = useRoundPlayback(timeline);

  const playerLookup = useMemo(() => {
    const map = new Map<string, PlayerStats>();
    analysis?.players.forEach((p) => map.set(p.steamId, p));
    return map;
  }, [analysis?.players]);

  const round = analysis?.rounds.find((r) => r.number === currentRound);
  const duration = timeline?.durationSeconds ?? 0;
  const remaining = Math.max(0, duration - state.time);

  // ============== Loading / processing states ==============
  if (!ready) {
    return (
      <div className="h-full w-full flex items-center justify-center bg-background">
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
      <div className="h-full w-full p-4 flex flex-col gap-3 bg-background">
        <div className="h-12 shimmer-loading rounded-lg" />
        <div className="flex-1 shimmer-loading rounded-xl" />
        <div className="h-32 shimmer-loading rounded-lg" />
      </div>
    );
  }

  return (
    <div className="h-full w-full flex flex-col bg-background overflow-hidden">
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
        {/* MAP — fills the entire main area as background */}
        <div className="absolute inset-0">
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
            playerLookup={playerLookup}
            layers={layers}
            fullBleed
          />
        </div>

        {/* TOP CENTER — Big round timer, cs2.cam-style */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="rounded-md bg-background/85 backdrop-blur-md border border-border/50 px-4 py-1.5 shadow-lg flex items-center gap-3">
            <span className="font-display font-bold text-lg tabular-nums tracking-tight">
              {formatTime(remaining)}
            </span>
          </div>
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
            onClick={() => {/* MapCanvas handles wheel zoom — kept as visual cue */}}
            disabled
          />
          <ToolStripBtn
            icon={MinusCircle}
            title="Zoom out"
            disabled
          />
          <ToolStripBtn
            icon={RotateCcw}
            title="Reset view"
            disabled
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
        </aside>

        {/* RIGHT TOP — Insights (precomputed) + Exchanges + Killfeed */}
        <aside className="absolute top-3 right-3 w-[280px] flex flex-col gap-2 pointer-events-none max-h-[calc(100%-1.5rem)] overflow-y-auto">
          {demoId && (
            <div className="pointer-events-auto">
              <InsightsPanel demoId={demoId} currentRound={currentRound} />
            </div>
          )}
          <div className="pointer-events-auto">
            <ExchangesPanel
              events={state.pastEvents}
              playerLookup={playerLookup}
            />
          </div>
          <div className="pointer-events-auto">
            <KillFeed
              events={state.pastEvents}
              playerLookup={playerLookup}
              onHover={setHoveredPlayer}
            />
          </div>
        </aside>

        {/* RIGHT BOTTOM — Team loadouts (CT + T stacked) */}
        <aside className="absolute bottom-3 right-3 w-[280px] flex flex-col gap-2 pointer-events-none">
          <div className="pointer-events-auto">
            <TeamLoadoutPanel
              frame={state.currentFrame}
              loadouts={timeline?.loadouts}
              playerLookup={playerLookup}
              focusedSteamId={hoveredPlayer}
              onHover={setHoveredPlayer}
            />
          </div>
        </aside>

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
