"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Clock, Crosshair, Loader2, RotateCw, Shield, Target, TrendingUp, Zap } from "lucide-react";

import { StatCard } from "@/components/demo/StatCard";
import { PlayerTable } from "@/components/demo/PlayerTable";
import { RoundBar } from "@/components/demo/RoundBar";
import { api } from "@/lib/api";
import { useDemo, useDemoAnalysis } from "@/lib/hooks/useDemos";
import { formatDuration } from "@/lib/utils";

export default function OverviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const qc = useQueryClient();
  const [reparsing, setReparsing] = useState(false);
  const [reparseError, setReparseError] = useState<string | null>(null);

  const { data: demo } = useDemo(id ?? null);
  const ready = demo?.status === "completed";
  const { data: analysis, isLoading } = useDemoAnalysis(id ?? null, ready);

  async function handleReparse() {
    if (!id) return;
    setReparsing(true);
    setReparseError(null);
    try {
      await api.demos.reprocess(id);
      // Bust the demo + analysis + timeline caches so the UI re-fetches
      // fresh once the worker finishes.
      await qc.invalidateQueries({ queryKey: ["demo", id] });
      await qc.invalidateQueries({ queryKey: ["demoAnalysis", id] });
      await qc.invalidateQueries({ queryKey: ["roundTimeline", id] });
      await qc.invalidateQueries({ queryKey: ["demoInsights", id] });
    } catch (err: any) {
      setReparseError(err?.message ?? "Re-parse failed");
    } finally {
      setReparsing(false);
    }
  }

  if (!ready || !analysis) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 rounded-xl shimmer-loading" />
          ))}
        </div>
        <div className="h-32 rounded-xl shimmer-loading" />
        <div className="h-72 rounded-xl shimmer-loading" />
        {isLoading && (
          <p className="text-xs text-center text-muted-foreground">Loading analysis…</p>
        )}
      </div>
    );
  }

  const players = analysis.players;
  const rounds = analysis.rounds;
  const totalKills = players.reduce((acc, p) => acc + p.kills, 0);
  const avgAdr = players.reduce((acc, p) => acc + p.adr, 0) / players.length;
  const avgKast = players.reduce((acc, p) => acc + p.kast, 0) / players.length;
  const avgHs = players.reduce((acc, p) => acc + p.hsPercent, 0) / players.length;
  const ctRoundsWon = rounds.filter((r) => r.winner === "ct").length;
  const ctWinPct = Math.round((ctRoundsWon / rounds.length) * 100);

  return (
    <div className="space-y-6">
      {/* Re-parse strip — invalidates cache + re-runs the worker so newer
          parser features (weapons, isJumping, real trajectories, fixed CT/T
          assignment after halftime) populate on demos uploaded before the
          fix. */}
      <div className="flex items-center justify-between rounded-xl glass-card px-4 py-2.5">
        <div className="flex flex-col">
          <span className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground">
            Engine
          </span>
          <span className="text-sm font-bold tracking-wide">
            Re-parse with the latest analyzer to refresh weapons, jumps & teams
          </span>
        </div>
        <div className="flex items-center gap-2">
          {reparseError && (
            <span className="text-[11px] text-loss">{reparseError}</span>
          )}
          <button
            onClick={handleReparse}
            disabled={reparsing}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold bg-primary/15 hover:bg-primary/25 text-primary border border-primary/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {reparsing ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <RotateCw size={12} />
            )}
            {reparsing ? "Queued…" : "Re-parse demo"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Total Kills" value={String(totalKills)} icon={Crosshair} color="text-kill" />
        <StatCard label="Avg ADR" value={avgAdr.toFixed(1)} icon={Target} color="text-primary" />
        <StatCard label="Avg KAST" value={`${avgKast.toFixed(0)}%`} icon={TrendingUp} color="text-win" />
        <StatCard label="HS Rate" value={`${avgHs.toFixed(0)}%`} icon={Zap} color="text-accent" />
        <StatCard label="CT Win %" value={`${ctWinPct}%`} icon={Shield} color="text-ct" />
        <StatCard
          label="Duration"
          value={demo?.durationSeconds ? formatDuration(demo.durationSeconds) : "—"}
          icon={Clock}
          color="text-muted-foreground"
        />
      </div>

      <div className="glass-card p-5 rounded-xl">
        <h2 className="font-display font-bold text-base mb-4">Round Results</h2>
        <RoundBar rounds={rounds} />
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        <div className="p-5 border-b border-border">
          <h2 className="font-display font-bold text-base">Player Performance</h2>
        </div>
        <PlayerTable players={players} />
      </div>
    </div>
  );
}
