"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  Bomb,
  CheckCircle2,
  Crosshair,
  Flame,
  Loader2,
  Shield,
  TrendingUp,
  Zap,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { useDemoInsights } from "@/lib/hooks/useDemos";
import type { InsightSeverity, RoundInsight } from "@/types/demo";

interface InsightsPanelProps {
  demoId: string | number;
  /** Filter to a specific round; pass null/undefined for all-rounds view. */
  currentRound?: number | null;
}

/**
 * Insights panel — reads pre-computed analytics from the
 * /demos/{id}/insights endpoint. Renders a compact summary card plus a
 * filterable list of round-level insights (trades, ecos, fast plants,
 * opening duels, etc.) with severity badges.
 */
export function InsightsPanel({ demoId, currentRound }: InsightsPanelProps) {
  const { data, isLoading, error } = useDemoInsights(demoId);

  const list: { round: number; ins: RoundInsight }[] = useMemo(() => {
    if (!data) return [];
    const out: { round: number; ins: RoundInsight }[] = [];
    for (const g of data.rounds) {
      if (currentRound !== undefined && currentRound !== null && g.round !== currentRound) continue;
      for (const ins of g.insights) out.push({ round: g.round, ins });
    }
    return out;
  }, [data, currentRound]);

  if (isLoading) {
    return (
      <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 p-4 shadow-lg flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 size={13} className="animate-spin" /> Loading insights…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 p-4 shadow-lg text-xs text-muted-foreground">
        No insights available.
      </div>
    );
  }

  const s = data.summary;

  return (
    <div className="space-y-2">
      {/* Summary chips */}
      <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 shadow-lg overflow-hidden">
        <h3 className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border/40 flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-primary animate-pulse" />
          Insights
        </h3>
        <div className="grid grid-cols-3 gap-1 p-2">
          <Chip icon={Crosshair} label="Kills" value={s.totalKills} />
          <Chip icon={Zap} label="HS" value={s.headshots} />
          <Chip icon={Flame} label="Fast plants" value={s.fastPlants} />
          <Chip icon={Bomb} label="Eco wins" value={s.ecoWins} />
          <Chip icon={Shield} label="Trades" value={s.tradeKills} />
          <Chip icon={TrendingUp} label="Op. duels" value={s.openingDuels} />
        </div>
        {s.topPerformer && (
          <div className="px-3 py-2 border-t border-border/40 flex items-center justify-between text-[11px]">
            <span className="text-muted-foreground">Top performer</span>
            <span className={cn("font-bold uppercase tracking-wide", s.topPerformer.team === "ct" ? "text-ct" : "text-tt")}>
              {s.topPerformer.name}
            </span>
            <span className="font-mono-rs text-foreground tabular-nums">{s.topPerformer.rating.toFixed(2)}</span>
          </div>
        )}
      </div>

      {/* Insight list */}
      {list.length > 0 && (
        <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 shadow-lg overflow-hidden">
          <h3 className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border/40">
            {currentRound ? `Round ${currentRound} · ${list.length}` : `All rounds · ${list.length}`}
          </h3>
          <div className="max-h-[320px] overflow-y-auto divide-y divide-border-subtle/40">
            {list.map(({ round, ins }, i) => (
              <InsightRow key={`${round}-${i}`} round={round} ins={ins} showRound={!currentRound} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Chip({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: number }) {
  return (
    <div className="flex flex-col items-center justify-center px-2 py-1.5 rounded-md bg-surface-elevated/60 hover:bg-surface-elevated transition-colors">
      <Icon size={12} className="text-primary opacity-80" />
      <span className="font-mono-rs text-sm tabular-nums text-foreground mt-1">{value}</span>
      <span className="text-[9px] uppercase tracking-wide text-muted-foreground/80">{label}</span>
    </div>
  );
}

function InsightRow({
  round,
  ins,
  showRound,
}: {
  round: number;
  ins: RoundInsight;
  showRound: boolean;
}) {
  const sev: Record<InsightSeverity, { fg: string; bg: string; icon: React.ElementType }> = {
    good: { fg: "text-win", bg: "bg-win/10", icon: CheckCircle2 },
    bad: { fg: "text-loss", bg: "bg-loss/10", icon: AlertTriangle },
    info: { fg: "text-primary", bg: "bg-primary-dim/40", icon: TrendingUp },
  };
  const s = sev[ins.severity] ?? sev.info;
  const Icon = s.icon;
  return (
    <div className="px-3 py-2 flex items-start gap-2.5 text-[11px]">
      <span className={cn("inline-flex items-center justify-center w-5 h-5 rounded-md flex-shrink-0", s.bg)}>
        <Icon size={11} className={s.fg} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          {showRound && (
            <span className="font-mono-rs text-[10px] text-muted-foreground tabular-nums">R{round}</span>
          )}
          <span className="font-bold tracking-wide truncate text-foreground">{ins.title}</span>
          {ins.team && (
            <span className={cn("rs-badge text-[8px]", ins.team === "ct" ? "bg-ct/15 text-ct" : "bg-tt/15 text-tt")}>
              {ins.team.toUpperCase()}
            </span>
          )}
        </div>
        <p className="text-muted-foreground/90 mt-0.5 leading-snug">{ins.summary}</p>
      </div>
    </div>
  );
}
