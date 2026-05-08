"use client";

import { useState } from "react";

import { useDemos } from "@/lib/hooks/useDemos";
import { cn } from "@/lib/utils";

export default function ComparePage() {
  const { data: demos } = useDemos();
  const completed = demos?.filter((d) => d.status === "completed") ?? [];
  const [a, setA] = useState<string>("");
  const [b, setB] = useState<string>("");

  const demoA = completed.find((d) => d.id === a);
  const demoB = completed.find((d) => d.id === b);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Compare</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Side-by-side match comparison.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DemoPicker label="Match A" value={a} onChange={setA} options={completed} otherSelected={b} />
        <DemoPicker label="Match B" value={b} onChange={setB} options={completed} otherSelected={a} />
      </div>

      {demoA && demoB ? (
        <ComparisonTable demoA={demoA} demoB={demoB} />
      ) : (
        <div className="glass-card rounded-xl p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Select two completed demos above to compare them.
          </p>
        </div>
      )}
    </div>
  );
}

function DemoPicker({
  label,
  value,
  onChange,
  options,
  otherSelected,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; filename: string; map: string | null; score: [number, number] | null }[];
  otherSelected: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50"
      >
        <option value="">— select a demo —</option>
        {options.map((d) => (
          <option key={d.id} value={d.id} disabled={d.id === otherSelected}>
            {d.filename} {d.map ? `• ${d.map}` : ""} {d.score ? `${d.score[0]}–${d.score[1]}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function ComparisonTable({
  demoA,
  demoB,
}: {
  demoA: ReturnType<typeof useDemos>["data"] extends (infer T)[] | undefined ? T : never;
  demoB: ReturnType<typeof useDemos>["data"] extends (infer T)[] | undefined ? T : never;
}) {
  const rows: { label: string; a: string | number | null | undefined; b: string | number | null | undefined }[] = [
    { label: "Map", a: demoA.map, b: demoB.map },
    { label: "Score", a: demoA.score?.join("–"), b: demoB.score?.join("–") },
    { label: "Rounds", a: demoA.roundCount, b: demoB.roundCount },
    { label: "Tickrate", a: demoA.tickrate, b: demoB.tickrate },
    { label: "Duration (s)", a: demoA.durationSeconds, b: demoB.durationSeconds },
  ];

  return (
    <div className="glass-card rounded-xl overflow-hidden">
      <table className="w-full rs-table">
        <thead>
          <tr>
            <th className="text-left">Metric</th>
            <th className="text-left">{demoA.filename}</th>
            <th className="text-left">{demoB.filename}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td className="text-sm font-semibold">{r.label}</td>
              <td className={cn("text-sm font-mono-rs", r.a == null && "text-muted-foreground")}>
                {r.a ?? "—"}
              </td>
              <td className={cn("text-sm font-mono-rs", r.b == null && "text-muted-foreground")}>
                {r.b ?? "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
