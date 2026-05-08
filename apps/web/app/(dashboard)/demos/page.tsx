"use client";

import Link from "next/link";
import { Activity, ArrowRight, Crosshair, Flame, Loader2, Shield } from "lucide-react";

import { StatCard } from "@/components/demo/StatCard";
import { DemoUploadCard } from "@/components/upload/DemoUploadCard";
import { DemoList } from "@/components/demo/DemoList";
import { useDemos } from "@/lib/hooks/useDemos";

export default function DemosPage() {
  const { data: demos, isLoading } = useDemos();

  const completed = demos?.filter((d) => d.status === "completed") ?? [];
  const totalRounds = completed.reduce((acc, d) => acc + (d.roundCount ?? 0), 0);
  const wins = completed.filter((d) => {
    if (!d.score) return false;
    const [a, b] = d.score;
    return a > b; // CT side wins (placeholder logic — refine when "your team" is known)
  }).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">My Demos</h1>
          <p className="text-muted-foreground mt-1">
            Upload, analyze and track your CS2 matches.
          </p>
        </div>
        <Link
          href="/demos/upload"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-all glow-primary"
        >
          New upload <ArrowRight size={14} />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Demos analyzed"
          value={String(completed.length)}
          icon={Activity}
          subtitle={demos ? `${demos.length} total` : "—"}
        />
        <StatCard
          label="Rounds played"
          value={String(totalRounds)}
          icon={Crosshair}
          color="text-win"
          subtitle="Across completed demos"
        />
        <StatCard
          label="Match wins"
          value={String(wins)}
          icon={Shield}
          subtitle={
            completed.length
              ? `${Math.round((wins / completed.length) * 100)}% winrate`
              : "—"
          }
        />
        <StatCard
          label="Active jobs"
          value={String(
            demos?.filter((d) =>
              ["uploaded", "queued", "processing"].includes(d.status),
            ).length ?? 0,
          )}
          icon={Flame}
          color="text-primary"
          subtitle="Currently processing"
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-6">
        <DemoUploadCard />

        <div className="glass-card rounded-2xl p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">Recent uploads</h2>
              <p className="text-sm text-muted-foreground mt-1">
                Live status updates as your demos process.
              </p>
            </div>
            {isLoading && <Loader2 size={14} className="animate-spin text-muted-foreground" />}
          </div>

          <DemoList />
        </div>
      </div>
    </div>
  );
}
