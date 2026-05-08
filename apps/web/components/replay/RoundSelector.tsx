"use client";

import { cn } from "@/lib/utils";
import type { Round } from "@/types/demo";

interface RoundSelectorProps {
  rounds: Round[];
  current: number;
  onSelect: (roundNumber: number) => void;
}

export function RoundSelector({ rounds, current, onSelect }: RoundSelectorProps) {
  if (rounds.length === 0) return null;

  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
          Rounds
        </h3>
        <span className="text-xs font-mono-rs text-muted-foreground">
          {current} / {rounds.length}
        </span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(36px,1fr))] gap-1.5">
        {rounds.map((r) => {
          const active = r.number === current;
          const ctWon = r.winner === "ct";
          return (
            <button
              key={r.number}
              onClick={() => onSelect(r.number)}
              className={cn(
                "relative h-12 rounded-md flex flex-col items-center justify-center text-xs font-mono-rs transition-all",
                active
                  ? "ring-2 ring-primary scale-105"
                  : "hover:ring-1 hover:ring-border",
                ctWon ? "bg-ct/15 text-ct" : "bg-tt/15 text-tt",
              )}
              title={`Round ${r.number} — ${r.winner.toUpperCase()} ${
                r.endReason
              }`}
            >
              <span className="text-[10px] opacity-70 leading-none">R</span>
              <span className="font-bold leading-tight">{r.number}</span>
              {r.bombPlanted && (
                <span
                  className="absolute top-0.5 right-0.5 w-1 h-1 rounded-full"
                  style={{ background: "hsl(0 80% 55%)" }}
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
