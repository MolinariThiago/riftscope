"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Info, Search, User } from "lucide-react";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/useT";
import { useSettings } from "@/lib/stores/settings";
import { cn } from "@/lib/utils";

export default function PlayersPage() {
  const t = useT();
  const [query, setQuery] = useState("");
  const hltvUrl = useSettings((s) => s.hltvProfileUrl);

  const { data, isLoading } = useQuery({
    queryKey: ["players-search", query],
    queryFn: () => api.players.search(query),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-bold">{t("nav.players")}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Search players across your analyzed demos.
          </p>
        </div>
        <SourceAttribution />
      </div>

      {/* Source notice when HLTV is linked */}
      {hltvUrl && (
        <div className="glass-card rounded-lg p-3 flex items-center gap-3 text-xs">
          <Info size={14} className="text-primary flex-shrink-0" />
          <span className="text-muted-foreground">
            HLTV profile linked:{" "}
            <a
              href={hltvUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1"
            >
              {hltvUrl} <ExternalLink size={10} />
            </a>
          </span>
        </div>
      )}

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
          <div className="p-12 text-center text-sm text-muted-foreground">
            {t("common.loading")}
          </div>
        ) : !data || data.results.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <User size={28} className="mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              {query
                ? `No players matching "${query}".`
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
                <th className="text-right">K/D</th>
                <th className="text-right">Avg ADR</th>
                <th className="text-right">Avg Rating</th>
                <th className="text-right">External</th>
              </tr>
            </thead>
            <tbody>
              {data.results.map((p) => {
                const kd = p.totalDeaths > 0 ? p.totalKills / p.totalDeaths : p.totalKills;
                return (
                  <tr key={p.steamId}>
                    <td>
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-primary-dim flex items-center justify-center flex-shrink-0">
                          <User size={12} className="text-primary" />
                        </div>
                        <span className="text-sm font-semibold">{p.name}</span>
                      </div>
                    </td>
                    <td className="text-right font-mono-rs text-sm">{p.demosPlayed}</td>
                    <td className="text-right font-mono-rs text-sm text-kill">{p.totalKills}</td>
                    <td className="text-right font-mono-rs text-sm text-death">{p.totalDeaths}</td>
                    <td className="text-right font-mono-rs text-sm">{kd.toFixed(2)}</td>
                    <td className="text-right font-mono-rs text-sm">{p.avgAdr}</td>
                    <td className="text-right">
                      <span
                        className={cn(
                          "rs-badge",
                          p.avgRating >= 1.1
                            ? "bg-win/15 text-win"
                            : p.avgRating >= 0.9
                              ? "bg-primary/15 text-primary"
                              : "bg-loss/10 text-loss",
                        )}
                      >
                        {p.avgRating.toFixed(2)}
                      </span>
                    </td>
                    <td className="text-right">
                      <ExternalLinks steamId={p.steamId} name={p.name} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <DataSourcesPanel />
    </div>
  );
}

function ExternalLinks({ steamId, name }: { steamId: string; name: string }) {
  const links = [
    {
      label: "Steam",
      href: `https://steamcommunity.com/profiles/${steamId}`,
      title: "Steam profile",
    },
    {
      label: "HLTV",
      href: `https://www.hltv.org/search?query=${encodeURIComponent(name)}`,
      title: "Search on HLTV",
    },
    {
      label: "Liquipedia",
      href: `https://liquipedia.net/counterstrike/index.php?search=${encodeURIComponent(name)}`,
      title: "Search on Liquipedia",
    },
  ];
  return (
    <div className="inline-flex items-center gap-1.5">
      {links.map((l) => (
        <a
          key={l.label}
          href={l.href}
          target="_blank"
          rel="noreferrer"
          title={l.title}
          className="text-[10px] font-mono-rs px-1.5 py-0.5 rounded border border-border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
        >
          {l.label}
        </a>
      ))}
    </div>
  );
}

function SourceAttribution() {
  return (
    <div className="text-[11px] text-muted-foreground italic max-w-xs text-right">
      Stats: based on your uploaded demos.
      <br />
      External links: Steam · HLTV · Liquipedia.
    </div>
  );
}

function DataSourcesPanel() {
  return (
    <div className="glass-card rounded-xl p-4 space-y-3">
      <h3 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
        Data sources
      </h3>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SourceCard
          name="Local demos"
          status="active"
          description="Stats aggregated from demos you've uploaded and parsed locally."
        />
        <SourceCard
          name="Liquipedia"
          status="planned"
          description="Pro player profiles, teams and tournament context. CC BY-SA 4.0."
          href="https://liquipedia.net/counterstrike"
        />
        <SourceCard
          name="HLTV"
          status="manual"
          description="Per-player profile URL is opt-in via Settings → Integrations."
          href="https://www.hltv.org"
        />
      </div>
      <p className="text-[10px] text-muted-foreground">
        Steam Web API + Faceit Open API integrations land in Phase 3B (auth required).
      </p>
    </div>
  );
}

function SourceCard({
  name,
  status,
  description,
  href,
}: {
  name: string;
  status: "active" | "planned" | "manual";
  description: string;
  href?: string;
}) {
  const statusStyles = {
    active: "bg-win/15 text-win",
    planned: "bg-primary/15 text-primary",
    manual: "bg-muted/30 text-muted-foreground",
  } as const;
  return (
    <div className="rounded-lg border border-border bg-surface-elevated/40 p-3 space-y-1.5">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{name}</span>
        <span className={cn("rs-badge", statusStyles[status])}>{status}</span>
      </div>
      <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
      {href && (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Visit <ExternalLink size={10} />
        </a>
      )}
    </div>
  );
}
