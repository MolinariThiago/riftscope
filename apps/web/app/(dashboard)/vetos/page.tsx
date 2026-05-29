"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2, Ban } from "lucide-react";

import { api } from "@/lib/api";
import { SectionHeader } from "@/components/anti-strat/SectionHeader";
import type { MapStrength } from "@/types/anti-strat";

function mapLabel(m: string): string {
  return m.replace(/^de_/, "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function VetosPage() {
  const team = useSearchParams().get("team");
  const [maps, setMaps] = useState<MapStrength[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!team) {
      setMaps(null);
      return;
    }
    setLoading(true);
    api.antiStrat
      .maps(team)
      .then(setMaps)
      .catch(() => setMaps([]))
      .finally(() => setLoading(false));
  }, [team]);

  const sorted = maps
    ? [...maps].sort(
        (a, b) =>
          b.roundsWon / Math.max(1, b.roundsPlayed) -
          a.roundsWon / Math.max(1, a.roundsPlayed),
      )
    : [];

  return (
    <div className="flex flex-col h-full">
      <SectionHeader title="Vetos" icon={Ban} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10 max-w-4xl">
        {!team ? (
          <Centered>Elegí un equipo para ver sus mapas.</Centered>
        ) : loading ? (
          <Centered>
            <Loader2 className="animate-spin mr-2" size={18} /> Cargando mapas…
          </Centered>
        ) : !maps || maps.length === 0 ? (
          <Centered>Sin datos de mapas para este equipo.</Centered>
        ) : (
          <>
            <p className="text-sm text-muted-foreground mb-5">
              Fortalezas por mapa según los demos analizados — win rate de rondas y
              rendimiento por lado. Útil para anticipar el veto.
            </p>
            <div className="space-y-3">
              {sorted.map((m) => (
                <MapRow key={m.map} m={m} />
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

function MapRow({ m }: { m: MapStrength }) {
  const overall = Math.round((m.roundsWon / Math.max(1, m.roundsPlayed)) * 100);
  const ct = m.ctRoundWinRate != null ? Math.round(m.ctRoundWinRate * 100) : null;
  const t = m.tRoundWinRate != null ? Math.round(m.tRoundWinRate * 100) : null;

  return (
    <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-surface-elevated/40 p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/maps/${m.map}.png`}
        alt={m.map}
        className="w-14 h-14 rounded-md object-cover border border-border/60 flex-shrink-0"
      />
      <div className="w-36 flex-shrink-0">
        <div className="font-display font-semibold">{mapLabel(m.map)}</div>
        <div className="text-[11px] text-muted-foreground font-mono-rs">
          jugado {m.played}x · {m.roundsWon}/{m.roundsPlayed} rondas
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-5 min-w-0">
        <SideBar label="CT" pct={ct} color="#5aa9ff" />
        <SideBar label="T" pct={t} color="#ffb347" />
      </div>

      <div className="text-right w-20 flex-shrink-0">
        <div
          className="text-2xl font-display font-bold leading-none"
          style={{ color: overall >= 50 ? "#4ade80" : "#f87171" }}
        >
          {overall}%
        </div>
        <div className="text-[10px] text-muted-foreground mt-1">rondas</div>
      </div>
    </div>
  );
}

function SideBar({
  label,
  pct,
  color,
}: {
  label: string;
  pct: number | null;
  color: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex justify-between text-[11px] mb-1">
        <span className="font-mono-rs font-bold" style={{ color }}>
          {label}
        </span>
        <span className="text-muted-foreground">{pct == null ? "—" : `${pct}%`}</span>
      </div>
      <div className="h-2 rounded-full bg-surface overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${pct ?? 0}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}
