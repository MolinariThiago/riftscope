"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { cn } from "@/lib/utils";
import type { PlayerStats } from "@/types/demo";

const MOCK_PLAYERS: PlayerStats[] = [
  { steamId: "1", name: "s1mple",     team: "ct", kills: 28, deaths: 14, assists: 5, headshots: 16, adr: 112.4, kast: 81, hsPercent: 58, rating: 1.41, openingKills: 6, openingDeaths: 2, clutchWins: 2, clutchAttempts: 3, utilityDamage: 240, flashAssists: 4, mvpRounds: 6 },
  { steamId: "2", name: "NiKo",       team: "ct", kills: 24, deaths: 16, assists: 7, headshots: 18, adr: 98.1,  kast: 78, hsPercent: 72, rating: 1.28, openingKills: 4, openingDeaths: 3, clutchWins: 1, clutchAttempts: 3, utilityDamage: 180, flashAssists: 5, mvpRounds: 4 },
  { steamId: "3", name: "ZywOo",      team: "ct", kills: 21, deaths: 17, assists: 4, headshots: 11, adr: 89.3,  kast: 74, hsPercent: 52, rating: 1.19, openingKills: 3, openingDeaths: 4, clutchWins: 3, clutchAttempts: 4, utilityDamage: 150, flashAssists: 2, mvpRounds: 5 },
  { steamId: "4", name: "electronic", team: "tt", kills: 18, deaths: 19, assists: 6, headshots: 9,  adr: 76.2,  kast: 67, hsPercent: 48, rating: 1.05, openingKills: 5, openingDeaths: 4, clutchWins: 0, clutchAttempts: 2, utilityDamage: 120, flashAssists: 3, mvpRounds: 3 },
  { steamId: "5", name: "frozen",     team: "tt", kills: 16, deaths: 20, assists: 3, headshots: 11, adr: 71.8,  kast: 63, hsPercent: 66, rating: 0.96, openingKills: 2, openingDeaths: 5, clutchWins: 1, clutchAttempts: 2, utilityDamage: 90,  flashAssists: 2, mvpRounds: 2 },
];

type Col = { key: keyof PlayerStats; label: string; align?: string; format?: (v: number) => string };

const COLUMNS: Col[] = [
  { key: "name",       label: "Player" },
  { key: "kills",      label: "K",        align: "text-right" },
  { key: "deaths",     label: "D",        align: "text-right" },
  { key: "assists",    label: "A",        align: "text-right" },
  { key: "adr",        label: "ADR",      align: "text-right", format: (v) => v.toFixed(1) },
  { key: "kast",       label: "KAST%",    align: "text-right", format: (v) => `${v}%` },
  { key: "hsPercent",  label: "HS%",      align: "text-right", format: (v) => `${v}%` },
  { key: "openingKills", label: "Opening", align: "text-right" },
  { key: "clutchWins", label: "Clutches", align: "text-right" },
  { key: "rating",     label: "Rating",   align: "text-right" },
];

export function PlayerTable({ players: propPlayers }: { players?: PlayerStats[] }) {
  const players = propPlayers ?? MOCK_PLAYERS;
  const [sortKey, setSortKey] = useState<keyof PlayerStats>("rating");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const sorted = [...players].sort((a, b) => {
    const va = a[sortKey];
    const vb = b[sortKey];
    if (typeof va === "number" && typeof vb === "number") {
      return sortDir === "desc" ? vb - va : va - vb;
    }
    return String(va).localeCompare(String(vb)) * (sortDir === "desc" ? -1 : 1);
  });

  const toggle = (key: keyof PlayerStats) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full rs-table">
        <thead>
          <tr>
            {COLUMNS.map((col) => (
              <th
                key={String(col.key)}
                className={cn("cursor-pointer select-none", col.align ?? "text-left")}
                onClick={() => toggle(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key &&
                    (sortDir === "desc" ? <ChevronDown size={10} /> : <ChevronUp size={10} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => (
            <tr key={p.steamId}>
              <td>
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-1 h-8 rounded-full flex-shrink-0"
                    style={{ background: p.team === "ct" ? "hsl(var(--ct))" : "hsl(var(--tt))" }}
                  />
                  <div>
                    <div className="text-sm font-semibold">{p.name}</div>
                    <div className={cn("text-xs font-mono-rs", p.team === "ct" ? "text-ct" : "text-tt")}>
                      {p.team.toUpperCase()}
                    </div>
                  </div>
                </div>
              </td>
              <td className="text-right text-sm text-kill font-mono-rs">{p.kills}</td>
              <td className="text-right text-sm text-death font-mono-rs">{p.deaths}</td>
              <td className="text-right text-sm text-assist font-mono-rs">{p.assists}</td>
              <td className="text-right text-sm font-mono-rs">{p.adr.toFixed(1)}</td>
              <td className="text-right text-sm font-mono-rs">{p.kast}%</td>
              <td className="text-right text-sm font-mono-rs">{p.hsPercent}%</td>
              <td className="text-right text-sm font-mono-rs">{p.openingKills}</td>
              <td className="text-right text-sm font-mono-rs">{p.clutchWins}</td>
              <td className="text-right">
                <RatingBadge value={p.rating} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RatingBadge({ value }: { value: number }) {
  const color =
    value >= 1.2 ? "text-win bg-win/10"
    : value >= 1.0 ? "text-primary bg-primary/15"
    : value >= 0.85 ? "text-foreground bg-surface-elevated"
    : "text-loss bg-loss/10";

  return (
    <span className={cn("inline-block px-2 py-0.5 rounded font-mono-rs font-bold text-xs", color)}>
      {value.toFixed(2)}
    </span>
  );
}
