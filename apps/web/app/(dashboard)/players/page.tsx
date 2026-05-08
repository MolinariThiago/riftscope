"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, User } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export default function PlayersPage() {
  const [query, setQuery] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["players-search", query],
    queryFn: () => api.players.search(query),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Players</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Search players across all your analyzed demos.
        </p>
      </div>

      <div className="relative max-w-md">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by player name…"
          className="w-full bg-surface-elevated border border-border rounded-lg pl-9 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
        />
      </div>

      <div className="glass-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">Loading…</div>
        ) : !data || data.results.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <User size={28} className="mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {query
                ? `No players matching “${query}”.`
                : "Upload a demo to start indexing players."}
            </p>
          </div>
        ) : (
          <table className="w-full rs-table">
            <thead>
              <tr>
                <th className="text-left">Player</th>
                <th className="text-right">Demos</th>
                <th className="text-right">Total K</th>
                <th className="text-right">Total D</th>
                <th className="text-right">Avg ADR</th>
                <th className="text-right">Avg Rating</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((p) => (
                <tr key={p.steamId}>
                  <td className="text-sm font-semibold">{p.name}</td>
                  <td className="text-right font-mono-rs text-sm">{p.demosPlayed}</td>
                  <td className="text-right font-mono-rs text-sm text-kill">{p.totalKills}</td>
                  <td className="text-right font-mono-rs text-sm text-death">{p.totalDeaths}</td>
                  <td className="text-right font-mono-rs text-sm">{p.avgAdr}</td>
                  <td className="text-right">
                    <span
                      className={cn(
                        "rs-badge",
                        p.avgRating >= 1.1 ? "bg-win/15 text-win"
                        : p.avgRating >= 0.9 ? "bg-primary/15 text-primary"
                        : "bg-loss/10 text-loss",
                      )}
                    >
                      {p.avgRating.toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
