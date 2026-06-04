"use client";

// Leaderboards — HLTV-2.0-rated player ranking across every completed
// demo in the platform. Public page with a "beta" chip while the demo
// corpus is small; the underlying parser was upgraded so the numbers
// (ADR / KAST / assists / utility damage) come from real per-tick
// events instead of formula estimates.
//
// Phase 2 (deferred): Roles (Anchor/Lurk/Rotation/Half-Lurk/Pack/
// Allround) and CT/T side split. Both need per-round-per-side
// aggregation calibrated on a larger pro corpus.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Trophy, Users } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { LeaderboardEntry } from "@/types/leaderboards";

// Active CS2 map pool. Same canonical order as /pro so the two pages
// feel consistent. ``all`` shows the cross-map leaderboard.
const MAP_POOL = [
  "mirage",
  "dust2",
  "inferno",
  "ancient",
  "nuke",
  "overpass",
  "train",
  "vertigo",
  "anubis",
  "cache",
] as const;

const DATE_RANGES: ReadonlyArray<{ key: string; label: string; days: number | null }> = [
  { key: "30d", label: "30 días", days: 30 },
  { key: "90d", label: "90 días", days: 90 },
  { key: "12m", label: "12 meses", days: 365 },
  { key: "all", label: "Todo", days: null },
];

const TOP_N_OPTIONS = [20, 30, 50, 100];

function prettyMap(raw: string): string {
  if (raw === "dust2") return "Dust2";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

// Rating colour band — green for above-avg form, primary for the
// long middle, muted for under-performing. Threshold values match the
// distribution HLTV reports for tier-1 pros.
function ratingClass(rating: number): string {
  if (rating >= 1.1) return "text-emerald-400";
  if (rating >= 0.9) return "text-primary";
  return "text-muted-foreground";
}

export default function LeaderboardsPage() {
  const [mapFilter, setMapFilter] = useState<string>(""); // "" = all
  const [dateKey, setDateKey] = useState<string>("90d");
  const [minRounds, setMinRounds] = useState<number>(48);
  const [limit, setLimit] = useState<number>(30);
  const [search, setSearch] = useState<string>("");

  // Translate the date pill into an ISO ``since`` for the backend.
  const since = useMemo(() => {
    const r = DATE_RANGES.find((d) => d.key === dateKey);
    if (!r || r.days === null) return undefined;
    const d = new Date();
    d.setDate(d.getDate() - r.days);
    return d.toISOString();
  }, [dateKey]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["leaderboards", mapFilter, since, minRounds, limit],
    queryFn: () =>
      api.leaderboards.list({
        map: mapFilter || undefined,
        since,
        minRounds,
        limit,
      }),
  });

  // Client-side search filter — narrows the already-fetched top N by
  // nickname / clan substring. Cheap, no extra request.
  const visible: LeaderboardEntry[] = useMemo(() => {
    if (!data) return [];
    const needle = search.trim().toLowerCase();
    if (!needle) return data.entries;
    return data.entries.filter(
      (e) =>
        e.name.toLowerCase().includes(needle) ||
        (e.clan ?? "").toLowerCase().includes(needle),
    );
  }, [data, search]);

  return (
    <div className="space-y-6">
      {/* ---- Header ---------------------------------------------- */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            Leaderboards
            <span className="text-[10px] font-mono-rs uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary border border-primary/30">
              beta
            </span>
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Top jugadores por HLTV Rating 2.0 — agregado sobre todas las
            demos analizadas en la plataforma.
          </p>
        </div>
        {data && (
          <div className="text-xs text-muted-foreground font-mono-rs">
            {data.total} jugador{data.total === 1 ? "" : "es"} elegibles
          </div>
        )}
      </div>

      {/* ---- Map pills ------------------------------------------- */}
      <div className="flex gap-1.5 p-1 bg-surface rounded-xl border border-border w-fit overflow-x-auto">
        <button
          onClick={() => setMapFilter("")}
          className={cn(
            "px-3 py-1.5 rounded-lg text-xs font-mono-rs uppercase tracking-wider transition-colors",
            mapFilter === ""
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          All
        </button>
        {MAP_POOL.map((m) => (
          <button
            key={m}
            onClick={() => setMapFilter(m)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors",
              mapFilter === m
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {prettyMap(m)}
          </button>
        ))}
      </div>

      {/* ---- Secondary filters ----------------------------------- */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Date range */}
        <div className="flex gap-1 p-1 bg-surface rounded-lg border border-border">
          {DATE_RANGES.map((r) => (
            <button
              key={r.key}
              onClick={() => setDateKey(r.key)}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs transition-colors",
                dateKey === r.key
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Min rounds slider */}
        <label className="flex items-center gap-2 text-xs">
          <span className="font-mono-rs uppercase tracking-wider text-muted-foreground">
            Min rondas
          </span>
          <input
            type="range"
            min={16}
            max={500}
            step={16}
            value={minRounds}
            onChange={(e) => setMinRounds(Number(e.target.value))}
            className="w-28 accent-primary"
          />
          <span className="font-mono-rs text-foreground w-8 text-right">
            {minRounds}
          </span>
        </label>

        {/* Top N */}
        <label className="flex items-center gap-2 text-xs">
          <span className="font-mono-rs uppercase tracking-wider text-muted-foreground">
            Top
          </span>
          <select
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
            className="bg-surface border border-border rounded-md px-2 py-1 text-xs cursor-pointer focus:outline-none focus:border-primary/50"
          >
            {TOP_N_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>

        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search
            size={12}
            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar jugador o clan…"
            className="w-full bg-surface border border-border rounded-md pl-7 pr-2 py-1.5 text-xs placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {/* ---- Table ----------------------------------------------- */}
      <div className="glass-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Cargando leaderboard…
          </div>
        ) : error ? (
          <div className="p-12 text-center text-sm text-rose-400">
            Error cargando leaderboard.
          </div>
        ) : visible.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Users size={28} className="mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {search
                ? `Ningún jugador coincide con "${search}".`
                : "Aún no hay datos suficientes para este filtro. Subí demos o relaja el mínimo de rondas."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full rs-table">
              <thead>
                <tr>
                  <th className="text-left w-12">#</th>
                  <th className="text-left">Jugador</th>
                  <th className="text-right">Rating</th>
                  <th className="text-right">ADR</th>
                  <th className="text-right">K/D</th>
                  <th className="text-right">KPR</th>
                  <th className="text-right">DPR</th>
                  <th className="text-right">KAST%</th>
                  <th className="text-right">UDR</th>
                  <th className="text-right">FAR</th>
                  <th className="text-right">Rondas</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((e) => (
                  <tr key={e.steamId}>
                    <td className="font-mono-rs text-muted-foreground">
                      {e.rank <= 3 ? (
                        <span className="inline-flex items-center gap-1">
                          <Trophy
                            size={11}
                            className={cn(
                              e.rank === 1 && "text-amber-400",
                              e.rank === 2 && "text-slate-300",
                              e.rank === 3 && "text-amber-700",
                            )}
                          />
                          {e.rank}
                        </span>
                      ) : (
                        e.rank
                      )}
                    </td>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-primary-dim flex items-center justify-center text-[10px] font-mono-rs text-primary border border-border flex-shrink-0">
                          {(e.name || "?").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">
                            {e.name || "—"}
                          </div>
                          {e.clan && (
                            <div className="text-[10px] text-muted-foreground font-mono-rs truncate">
                              {e.clan}
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="text-right">
                      <span
                        className={cn(
                          "rs-badge font-mono-rs tabular-nums",
                          ratingClass(e.rating),
                        )}
                      >
                        {e.rating.toFixed(2)}
                      </span>
                    </td>
                    <td className="text-right tabular-nums">{e.adr.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{e.kd.toFixed(2)}</td>
                    <td className="text-right tabular-nums">{e.kpr.toFixed(2)}</td>
                    <td className="text-right tabular-nums">{e.dpr.toFixed(2)}</td>
                    <td className="text-right tabular-nums">{e.kast.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{e.udr.toFixed(1)}</td>
                    <td className="text-right tabular-nums">{e.far.toFixed(2)}</td>
                    <td className="text-right tabular-nums text-muted-foreground">
                      {e.rounds}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ---- Footnote — credit + methodology --------------------- */}
      <p className="text-[10px] text-muted-foreground font-mono-rs">
        Rating HLTV 2.0 · 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587
      </p>
    </div>
  );
}
