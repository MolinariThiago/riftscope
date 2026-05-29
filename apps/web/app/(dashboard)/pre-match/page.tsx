"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, ClipboardList } from "lucide-react";

import { api } from "@/lib/api";
import { SectionHeader } from "@/components/anti-strat/SectionHeader";
import type { PreMatchReport, TacticKind } from "@/types/anti-strat";

const TYPE_COLOR: Record<TacticKind, string> = {
  execute: "#ff6b5c",
  fake: "#c084fc",
  default: "#5aa9ff",
};

function mapLabel(m: string): string {
  return m.replace(/^de_/, "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PreMatchPage() {
  const team = useSearchParams().get("team");
  const [data, setData] = useState<PreMatchReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!team) {
      setData(null);
      return;
    }
    setLoading(true);
    api.antiStrat
      .preMatch(team)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [team]);

  return (
    <div className="flex flex-col h-full">
      <SectionHeader title="Pre-partida" icon={ClipboardList} />
      <div className="flex-1 min-h-0 overflow-y-auto pb-10 max-w-5xl">
        {!team ? (
          <Centered>Elegí un equipo para preparar el partido.</Centered>
        ) : loading ? (
          <Centered>
            <Loader2 className="animate-spin mr-2" size={18} /> Armando dossier…
          </Centered>
        ) : !data ? (
          <Centered>Sin datos para este equipo.</Centered>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Demos" value={data.demos} />
              <Stat label="Mapas" value={data.maps.length} />
              <Stat label="Rondas analizadas" value={data.totalRounds} />
            </div>

            <div className="grid lg:grid-cols-2 gap-6">
              {/* Players */}
              <section>
                <h3 className="font-display font-semibold mb-3">Jugadores clave</h3>
                <div className="rounded-xl border border-border/60 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-[11px] text-muted-foreground bg-surface-elevated/40">
                        <th className="text-left font-medium px-3 py-2">Jugador</th>
                        <th className="px-2 py-2 font-medium">Rating</th>
                        <th className="px-2 font-medium">ADR</th>
                        <th className="px-2 font-medium">KAST</th>
                        <th className="px-2 pr-3 font-medium">OK</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.players.map((p) => (
                        <tr key={p.steamId} className="border-t border-border/40">
                          <td className="px-3 py-2 font-medium truncate max-w-[140px]">
                            {p.name}
                          </td>
                          <td
                            className="text-center font-mono-rs"
                            style={{ color: p.rating >= 1 ? "#4ade80" : "inherit" }}
                          >
                            {p.rating.toFixed(2)}
                          </td>
                          <td className="text-center font-mono-rs">{p.adr}</td>
                          <td className="text-center font-mono-rs">{p.kast}%</td>
                          <td className="text-center font-mono-rs pr-3">
                            {p.openingKills}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Signature plays */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-display font-semibold">Plays firma</h3>
                  <Link
                    href={`/anti-strat?team=${encodeURIComponent(team)}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver scouting →
                  </Link>
                </div>
                {data.signaturePlays.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin plays repetidos detectados todavía.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {data.signaturePlays.map((s, i) => (
                      <div
                        key={i}
                        className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-elevated/40 px-3 py-2"
                      >
                        <span
                          className="text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded"
                          style={{
                            color: TYPE_COLOR[s.type],
                            backgroundColor: `${TYPE_COLOR[s.type]}1a`,
                          }}
                        >
                          {s.type}
                        </span>
                        <span className="text-sm truncate">
                          {mapLabel(s.map)}
                          {s.site ? ` · Site ${s.site}` : ""}
                        </span>
                        <span className="ml-auto text-xs text-muted-foreground font-mono-rs whitespace-nowrap">
                          x{s.count} · {Math.round(s.winRate * 100)}%
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            {/* Maps */}
            <section>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-semibold">Mapas</h3>
                <Link
                  href={`/vetos?team=${encodeURIComponent(team)}`}
                  className="text-xs text-primary hover:underline"
                >
                  Ver detalle →
                </Link>
              </div>
              <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">
                {data.maps.map((m) => {
                  const overall = Math.round(
                    (m.roundsWon / Math.max(1, m.roundsPlayed)) * 100,
                  );
                  return (
                    <div
                      key={m.map}
                      className="rounded-xl border border-border/60 bg-surface-elevated/40 p-3 flex items-center gap-3"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/maps/${m.map}.png`}
                        alt={m.map}
                        className="w-10 h-10 rounded object-cover border border-border/60 flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-sm">{mapLabel(m.map)}</div>
                        <div className="text-[10px] text-muted-foreground font-mono-rs">
                          jugado {m.played}x
                        </div>
                      </div>
                      <div
                        className="text-lg font-display font-bold"
                        style={{ color: overall >= 50 ? "#4ade80" : "#f87171" }}
                      >
                        {overall}%
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl border border-border/60 bg-surface-elevated/40 p-4">
      <div className="text-2xl font-display font-bold leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5">{label}</div>
    </div>
  );
}
