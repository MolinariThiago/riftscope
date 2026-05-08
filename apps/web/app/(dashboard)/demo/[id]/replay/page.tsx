"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, AlertCircle } from "lucide-react";

import { KillFeed } from "@/components/replay/KillFeed";
import { MapCanvas } from "@/components/replay/MapCanvas";
import { PlaybackControlsBar } from "@/components/replay/PlaybackControls";
import { RoundSelector } from "@/components/replay/RoundSelector";
import {
  useDemo,
  useDemoAnalysis,
  useRoundTimeline,
} from "@/lib/hooks/useDemos";
import { useRoundPlayback } from "@/lib/hooks/useRoundPlayback";
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

  // Default to round 1 once analysis arrives
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

  const [state, controls] = useRoundPlayback(timeline);

  const playerLookup = useMemo(() => {
    const map = new Map<string, PlayerStats>();
    analysis?.players.forEach((p) => map.set(p.steamId, p));
    return map;
  }, [analysis?.players]);

  // ================== UI states ==================
  if (!ready) {
    return (
      <div className="glass-card rounded-xl p-10 flex items-center gap-3 justify-center">
        <Loader2 className="animate-spin text-primary" size={18} />
        <span className="text-sm text-muted-foreground">
          Waiting for demo to finish processing…
        </span>
      </div>
    );
  }

  if (analysisLoading || !analysis) {
    return (
      <div className="space-y-4">
        <div className="h-20 shimmer-loading rounded-xl" />
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
          <div className="aspect-square shimmer-loading rounded-xl" />
          <div className="h-[600px] shimmer-loading rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <RoundSelector
        rounds={analysis.rounds}
        current={currentRound ?? 1}
        onSelect={(n) => setCurrentRound(n)}
      />

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-3">
          <div className="relative">
            {timelineLoading && (
              <div className="absolute inset-0 z-10 rounded-xl bg-background/70 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="animate-spin" size={14} />
                  Loading round {currentRound}…
                </div>
              </div>
            )}
            <MapCanvas
              mapName={analysis.demo.map}
              frame={state.currentFrame}
              pastEvents={state.pastEvents}
              currentTime={state.time}
              focusedSteamId={hoveredPlayer}
              playerLookup={playerLookup}
            />
          </div>

          <PlaybackControlsBar
            state={state}
            controls={controls}
            duration={timeline?.durationSeconds ?? 0}
            events={timeline?.events ?? []}
          />
        </div>

        <div className="space-y-3">
          <RoundInfo
            roundNumber={currentRound ?? 1}
            analysis={analysis}
          />
          <KillFeed
            events={state.pastEvents}
            playerLookup={playerLookup}
            onHover={setHoveredPlayer}
          />
        </div>
      </div>
    </div>
  );
}

function RoundInfo({
  roundNumber,
  analysis,
}: {
  roundNumber: number;
  analysis: NonNullable<ReturnType<typeof useDemoAnalysis>["data"]>;
}) {
  const round = analysis.rounds.find((r) => r.number === roundNumber);
  const economy = analysis.economy.find((e) => e.round === roundNumber);

  if (!round) return null;

  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
          Round info
        </h3>
        <span
          className="rs-badge"
          style={{
            background:
              round.winner === "ct"
                ? "hsl(213 100% 65% / 0.15)"
                : "hsl(33 100% 64% / 0.15)",
            color:
              round.winner === "ct"
                ? "hsl(213 100% 65%)"
                : "hsl(33 100% 64%)",
          }}
        >
          {round.winner.toUpperCase()} · {round.endReason}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Duration" value={`${round.durationSeconds}s`} />
        <Stat label="Half" value={`${round.half}`} />
        {round.bombPlanted && (
          <Stat label="Bomb site" value={round.bombSite ?? "—"} />
        )}
        <Stat
          label="CT eq"
          value={`$${round.ctEquipmentValue.toLocaleString()}`}
        />
        <Stat
          label="T eq"
          value={`$${round.ttEquipmentValue.toLocaleString()}`}
        />
      </div>

      {economy && (
        <div className="pt-2 border-t border-border/50 grid grid-cols-2 gap-2 text-xs">
          <Stat
            label="CT type"
            value={<span className="capitalize">{economy.ctType}</span>}
          />
          <Stat
            label="T type"
            value={<span className="capitalize">{economy.ttType}</span>}
          />
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <div className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div className="font-mono-rs text-sm text-foreground">{value}</div>
    </div>
  );
}
