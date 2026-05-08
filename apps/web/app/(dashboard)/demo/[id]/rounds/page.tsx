"use client";

import { useParams } from "next/navigation";
import { Bomb, Skull, Timer } from "lucide-react";

import { useDemo, useDemoAnalysis } from "@/lib/hooks/useDemos";
import { cn } from "@/lib/utils";
import type { Round } from "@/types/demo";

export default function RoundsPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;

  const { data: demo } = useDemo(id ?? null);
  const ready = demo?.status === "completed";
  const { data: analysis } = useDemoAnalysis(id ?? null, ready);

  if (!ready || !analysis) {
    return <SkeletonRounds />;
  }

  return (
    <div className="space-y-3">
      {analysis.rounds.map((r) => (
        <RoundCard key={r.number} round={r} />
      ))}
    </div>
  );
}

function RoundCard({ round }: { round: Round }) {
  const ctWon = round.winner === "ct";
  return (
    <div className="glass-card rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 text-center font-mono-rs text-sm font-bold text-muted-foreground">
        R{round.number}
      </div>

      <div
        className={cn(
          "w-1 h-10 rounded-full flex-shrink-0",
          ctWon ? "bg-ct" : "bg-tt",
        )}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">
            {ctWon ? "CT" : "T"} wins
          </span>
          <EndReason reason={round.endReason} />
          <span className="text-xs text-muted-foreground font-mono-rs">
            <Timer size={10} className="inline mr-1" />
            {round.durationSeconds}s
          </span>
          {round.bombPlanted && (
            <span className="text-xs text-tt font-mono-rs">
              <Bomb size={10} className="inline mr-1" />
              Site {round.bombSite}
            </span>
          )}
        </div>
        <div className="text-xs text-muted-foreground mt-1 font-mono-rs">
          CT eq ${round.ctEquipmentValue.toLocaleString()} • T eq ${round.ttEquipmentValue.toLocaleString()}
        </div>
      </div>

      <div
        className={cn(
          "rs-badge",
          ctWon ? "bg-ct/15 text-ct" : "bg-tt/15 text-tt",
        )}
      >
        Half {round.half}
      </div>
    </div>
  );
}

function EndReason({ reason }: { reason: Round["endReason"] }) {
  const map = {
    elimination: { label: "Elimination", icon: Skull },
    defuse:      { label: "Bomb defused", icon: Bomb },
    explode:     { label: "Bomb exploded", icon: Bomb },
    time:        { label: "Time", icon: Timer },
    surrender:   { label: "Surrender", icon: Skull },
  } as const;
  const cfg = map[reason];
  const Icon = cfg.icon;
  return (
    <span className="text-xs text-muted-foreground font-mono-rs">
      <Icon size={10} className="inline mr-1" />
      {cfg.label}
    </span>
  );
}

function SkeletonRounds() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-16 rounded-xl shimmer-loading" />
      ))}
    </div>
  );
}
