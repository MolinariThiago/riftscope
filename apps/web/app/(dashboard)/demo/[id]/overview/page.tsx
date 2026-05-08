"use client";

import { useParams } from "next/navigation";
import { Clock, Crosshair, Shield, Target, TrendingUp, Zap } from "lucide-react";

import { StatCard } from "@/components/demo/StatCard";
import { PlayerTable } from "@/components/demo/PlayerTable";
import { RoundBar } from "@/components/demo/RoundBar";
import { useDemo, useDemoAnalysis } from "@/lib/hooks/useDemos";
import { formatDuration } from "@/lib/utils";

export default function OverviewPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: demo } = useDemo(id ?? null);
  const ready = demo?.status === "completed";
  const { data: analysis, isLoading } = useDemoAnalysis(id ?? null, ready);

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
