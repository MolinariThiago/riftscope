"use client";

import { cn } from "@/lib/utils";
import type { Round } from "@/types/demo";

interface RoundSelectorProps {
  rounds: Round[];
  current: number;
  onSelect: (roundNumber: number) => void;
}

/**
 * CS2.CAM-style horizontal round strip — every round always visible.
 *
 * Each cell uses ``flex-1`` so the strip fills the container width regardless
 * of how many rounds the demo has (16, 22, 30, +OT). Cells shrink uniformly
 * down to a minimum of ~26px before relying on container scroll. The half
 * break (R12 → R13) is shown as a thin vertical divider rather than a gap
 * the user has to scroll past.
 */
export function RoundSelector({ rounds, current, onSelect }: RoundSelectorProps) {
  if (rounds.length === 0) return null;

  const halfPoint = Math.floor(rounds.length / 2);

  return (
    <div className="rounded-xl bg-gradient-to-b from-surface-elevated/60 to-surface-elevated/30 border border-border/40 backdrop-blur-sm p-2 shadow-lg">
      <div className="flex items-stretch gap-[2px] w-full">
        {rounds.map((r, idx) => {
          const active = r.number === current;
          const ctWon = r.winner === "ct";
          const showHalfBreak = idx === halfPoint && idx > 0;
          return (
            <div key={r.number} className="flex items-stretch flex-1 min-w-0">
              {showHalfBreak && (
                <div
                  className="self-stretch w-px bg-border/60 mx-1"
                  aria-hidden
                />
              )}
              <RoundCell round={r} active={active} ctWon={ctWon} onSelect={onSelect} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RoundCell({
  round: r,
  active,
  ctWon,
  onSelect,
}: {
  round: Round;
  active: boolean;
  ctWon: boolean;
  onSelect: (n: number) => void;
}) {
  return (
    <button
      onClick={() => onSelect(r.number)}
      className={cn(
        "relative flex-1 h-12 min-w-0 flex flex-col items-center justify-center font-mono-rs",
        "rounded-md border transition-all duration-150",
        active
          ? "border-primary scale-[1.04] z-10 shadow-md shadow-primary/30"
          : "border-transparent hover:border-border/60",
        active
          ? ctWon
            ? "bg-ct/20"
            : "bg-tt/20"
          : ctWon
            ? "bg-ct/8 hover:bg-ct/15"
            : "bg-tt/8 hover:bg-tt/15",
      )}
      title={`Round ${r.number} — ${r.winner.toUpperCase()} ${r.endReason}${r.bombPlanted ? ` · bomb ${r.bombSite}` : ""}`}
    >
      <span
        className={cn(
          "text-[9px] uppercase opacity-50 leading-none",
          ctWon ? "text-ct" : "text-tt",
        )}
      >
        R
      </span>
      <span
        className={cn(
          "text-sm font-bold leading-none tabular-nums mt-0.5",
          ctWon ? "text-ct" : "text-tt",
        )}
      >
        {r.number}
      </span>
      {r.bombPlanted && (
        <span
          className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-loss shadow-[0_0_4px_currentColor] text-loss"
          title={`Bomb planted on ${r.bombSite ?? "?"}`}
        />
      )}
      {/* end-reason micro-indicator */}
      <span
        className={cn(
          "absolute bottom-0.5 left-1/2 -translate-x-1/2 h-0.5 rounded-full transition-all",
          active ? "w-6" : "w-3 opacity-60",
          ctWon ? "bg-ct" : "bg-tt",
        )}
      />
    </button>
  );
}
