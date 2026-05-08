"use client";

import { useParams } from "next/navigation";
import { useDemo, useDemoAnalysis } from "@/lib/hooks/useDemos";
import { cn, formatMoney } from "@/lib/utils";
import type { EconomyRound } from "@/types/demo";

const TYPE_BADGE: Record<EconomyRound["ctType"], string> = {
  full:  "bg-win/15 text-win",
  semi:  "bg-primary/15 text-primary",
  force: "bg-accent/15 text-accent",
  eco:   "bg-loss/15 text-loss",
};

export default function EconomyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { data: demo } = useDemo(id ?? null);
  const ready = demo?.status === "completed";
  const { data: analysis } = useDemoAnalysis(id ?? null, ready);

  if (!ready || !analysis) {
    return <div className="h-72 rounded-xl shimmer-loading" />;
  }

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full rs-table">
          <thead>
            <tr>
              <th className="text-left">Round</th>
              <th className="text-right">CT Bank</th>
              <th className="text-right">CT Spent</th>
              <th className="text-center">CT Type</th>
              <th className="text-right">T Bank</th>
              <th className="text-right">T Spent</th>
              <th className="text-center">T Type</th>
            </tr>
          </thead>
          <tbody>
            {analysis.economy.map((row) => (
              <tr key={row.round}>
                <td className="font-mono-rs text-sm font-semibold">R{row.round}</td>
                <td className="text-right font-mono-rs text-sm text-ct">
                  {formatMoney(row.ctBankBefore)}
                </td>
                <td className="text-right font-mono-rs text-sm text-muted-foreground">
                  {formatMoney(row.ctSpent)}
                </td>
                <td className="text-center">
                  <span className={cn("rs-badge", TYPE_BADGE[row.ctType])}>
                    {row.ctType}
                  </span>
                </td>
                <td className="text-right font-mono-rs text-sm text-tt">
                  {formatMoney(row.ttBankBefore)}
                </td>
                <td className="text-right font-mono-rs text-sm text-muted-foreground">
                  {formatMoney(row.ttSpent)}
                </td>
                <td className="text-center">
                  <span className={cn("rs-badge", TYPE_BADGE[row.ttType])}>
                    {row.ttType}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
