"use client";

import { cn } from "@/lib/utils";
import type { Round } from "@/types/demo";

const MOCK_ROUNDS: Pick<Round, "winner" | "number">[] = Array.from({ length: 28 }, (_, i) => ({
  number: i + 1,
  winner: i % 3 === 0 ? "tt" : "ct",
}));

export function RoundBar({ rounds }: { rounds?: Round[] }) {
  const data = rounds ?? (MOCK_ROUNDS as Round[]);

  return (
    <div className="space-y-2">
      <div className="flex gap-0.5 overflow-x-auto">
        {data.map((r) => (
          <div
            key={r.number}
            className={cn(
              "flex-1 min-w-[14px] h-8 rounded-sm transition-all",
              r.winner === "ct" ? "bg-ct/80 hover:bg-ct" : "bg-tt/80 hover:bg-tt",
            )}
            title={`Round ${r.number} — ${r.winner.toUpperCase()} wins`}
          />
        ))}
      </div>
      <div className="flex justify-between text-xs font-mono-rs text-muted-foreground">
        <span>R1</span>
        <span>R{data.length}</span>
      </div>
    </div>
  );
}
