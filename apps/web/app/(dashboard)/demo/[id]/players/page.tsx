"use client";

import { useParams } from "next/navigation";
import { PlayerTable } from "@/components/demo/PlayerTable";
import { useDemo, useDemoAnalysis } from "@/lib/hooks/useDemos";

export default function PlayersDemoPage() {
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
      <PlayerTable players={analysis.players} />
    </div>
  );
}
