"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, PlayCircle, Bomb, Crosshair } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/anti-strat/SectionHeader";
import type {
  MapReport,
  PlayGroup,
  TacticKind,
  TeamReport,
} from "@/types/anti-strat";

const TYPE_META: Record<TacticKind, { label: string; color: string }> = {
  execute: { label: "Execute", color: "#ff6b5c" },
  fake: { label: "Fake", color: "#c084fc" },
  default: { label: "Default", color: "#5aa9ff" },
};

const SITE_COLOR: Record<string, string> = { A: "#ffb347", B: "#0ddde8" };
const BUCKET_LABELS = ["0", "10", "20", "30", "40", "50", "60+"];

function mapLabel(m: string): string {
  return m.replace(/^de_/, "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ScoutingPage() {
  const team = useSearchParams().get("team");
  const [report, setReport] = useState<TeamReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [mapFilter, setMapFilter] = useState("all");

  useEffect(() => {
    if (!team) {
      setReport(null);
      return;
    }
    setLoading(true);
    setMapFilter("all");
    api.antiStrat
      .report(team)
      .then(setReport)
      .catch(() => setReport(null))
      .finally(() => setLoading(false));
  }, [team]);

  const visibleMaps = useMemo(() => {
    if (!report) return [];
    return mapFilter === "all"
      ? report.maps
      : report.maps.filter((m) => m.map === mapFilter);
  }, [report, mapFilter]);

  return (
    <div className="flex flex-col h-full">
      <SectionHeader title="Anti-strat" icon={Crosshair} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10">
        {!team ? (
          <Centered>Elegí un equipo para ver su scouting.</Centered>
        ) : loading ? (
          <Centered>
            <Loader2 className="animate-spin mr-2" size={18} /> Cargando scouting…
          </Centered>
        ) : !report ? (
          <Centered>Sin datos de scouting para este equipo.</Centered>
        ) : (
          <>
            <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
              <p className="text-sm text-muted-foreground">
                {report.totalRounds} rondas de ataque analizadas en{" "}
                {report.maps.length} mapa{report.maps.length === 1 ? "" : "s"}.
              </p>
              <div className="flex flex-wrap gap-1.5">
                <FilterChip
                  active={mapFilter === "all"}
                  onClick={() => setMapFilter("all")}
                  label="Todos"
                />
                {report.maps.map((m) => (
                  <FilterChip
                    key={m.map}
                    active={mapFilter === m.map}
                    onClick={() => setMapFilter(m.map)}
                    label={mapLabel(m.map)}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-8">
              {visibleMaps.map((m) => (
                <MapSection key={m.map} report={m} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-center py-32 text-muted-foreground">
      {children}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors capitalize",
        active
          ? "bg-primary text-primary-foreground"
          : "bg-surface border border-border text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      {label}
    </button>
  );
}

function MapSection({ report }: { report: MapReport }) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/maps/${report.map}.png`}
          alt={report.map}
          className="w-9 h-9 rounded-md object-cover border border-border/60"
        />
        <div>
          <h3 className="font-display font-semibold">{mapLabel(report.map)}</h3>
          <span className="text-[11px] text-muted-foreground font-mono-rs">
            {report.rounds} rondas T
          </span>
        </div>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {report.plays.map((p, i) => (
          <PlayCard key={`${p.site}-${p.type}-${i}`} play={p} />
        ))}
      </div>
    </section>
  );
}

function PlayCard({ play }: { play: PlayGroup }) {
  const meta = TYPE_META[play.type] ?? TYPE_META.default;
  const winPct = Math.round(play.winRate * 100);
  const peak = play.timing.indexOf(Math.max(...play.timing));
  const hasTiming = play.timing.some((b) => b > 0);

  return (
    <div className="rounded-xl border border-border/60 bg-surface-elevated/40 p-4 hover:border-border transition-colors">
      <div className="flex items-center justify-between mb-3">
        <span
          className="px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-wide"
          style={{ color: meta.color, backgroundColor: `${meta.color}1a` }}
        >
          {meta.label}
        </span>
        {play.site ? (
          <span
            className="text-xs font-mono-rs font-bold"
            style={{ color: SITE_COLOR[play.site] ?? "inherit" }}
          >
            Site {play.site}
          </span>
        ) : (
          <span className="text-xs font-mono-rs text-muted-foreground">Sin plant</span>
        )}
      </div>

      <div className="flex items-end justify-between mb-3">
        <div>
          <div className="text-2xl font-display font-bold leading-none">{play.count}</div>
          <div className="text-[11px] text-muted-foreground mt-1">veces</div>
        </div>
        <div className="text-right">
          <div
            className="text-lg font-display font-bold leading-none"
            style={{ color: winPct >= 50 ? "#4ade80" : "#f87171" }}
          >
            {winPct}%
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">win rate</div>
        </div>
      </div>
      <div className="h-1.5 rounded-full bg-surface overflow-hidden mb-3">
        <div
          className="h-full rounded-full transition-all"
          style={{
            width: `${winPct}%`,
            backgroundColor: winPct >= 50 ? "#4ade80" : "#f87171",
          }}
        />
      </div>

      {hasTiming && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
            <span>Timing de ejecución</span>
            {play.avgPlantTime != null && (
              <span className="font-mono-rs inline-flex items-center gap-1">
                <Bomb size={10} /> {play.avgPlantTime}s
              </span>
            )}
          </div>
          <div className="flex items-end gap-0.5 h-10">
            {play.timing.map((v, i) => {
              const max = Math.max(...play.timing, 1);
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full rounded-sm transition-all"
                      style={{
                        height: `${Math.max(v > 0 ? 12 : 0, (v / max) * 100)}%`,
                        backgroundColor:
                          i === peak && v > 0 ? meta.color : `${meta.color}55`,
                      }}
                      title={`${BUCKET_LABELS[i]}s: ${v}`}
                    />
                  </div>
                  <span className="text-[8px] text-muted-foreground font-mono-rs">
                    {BUCKET_LABELS[i]}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-1 pt-1 border-t border-border/40 mt-1">
        <span className="text-[10px] text-muted-foreground w-full mb-0.5">Ver rondas:</span>
        {play.rounds.map((r) => (
          <Link
            key={`${r.demoId}-${r.roundNumber}`}
            href={`/demo/${r.demoId}/replay?round=${r.roundNumber}`}
            title={`Demo ${r.demoId} · Ronda ${r.roundNumber}${r.won ? " (ganada)" : " (perdida)"}`}
            className={cn(
              "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono-rs border transition-colors",
              r.won
                ? "border-[#4ade8055] text-[#4ade80] hover:bg-[#4ade8015]"
                : "border-border/60 text-muted-foreground hover:bg-surface hover:text-foreground",
            )}
          >
            <PlayCircle size={9} /> R{r.roundNumber}
          </Link>
        ))}
      </div>
    </div>
  );
}
