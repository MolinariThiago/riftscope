"use client";

import type { PlayerStats, TimelineEvent } from "@/types/demo";

interface ExchangesPanelProps {
  events: TimelineEvent[];
  playerLookup: Map<string, PlayerStats>;
  /** Optional team name override for the badge (e.g. "AM"). */
  ctTeamName?: string;
  ttTeamName?: string;
}

/**
 * Kill exchanges panel — cs2.cam style.
 *
 * Shows kill chains in the format:
 *
 *   killer → [weapon] → victim TEAM
 *
 * One row per kill, oldest at top. Trade-detection marks back-to-back kills
 * within ~5s as "exchanges" by indenting the second.
 */
export function ExchangesPanel({
  events,
  playerLookup,
  ctTeamName = "CT",
  ttTeamName = "T",
}: ExchangesPanelProps) {
  const kills = events.filter((e) => e.type === "kill");

  if (kills.length === 0) {
    return (
      <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 p-3 shadow-lg">
        <h3 className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground flex items-center gap-2">
          <span className="w-1 h-1 rounded-full bg-primary animate-pulse" />
          Exchanges
        </h3>
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          No kills yet
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-surface/70 backdrop-blur-md border border-border/40 shadow-lg overflow-hidden">
      <h3 className="text-[10px] font-mono-rs uppercase tracking-widest text-muted-foreground px-3 py-2 border-b border-border/40 flex items-center gap-2">
        <span className="w-1 h-1 rounded-full bg-primary animate-pulse" />
        Exchanges
      </h3>
      <div className="max-h-[180px] overflow-y-auto p-1.5 space-y-0.5">
        {kills.map((k, i) => {
          const prev = i > 0 ? kills[i - 1] : null;
          const isTrade = !!(prev && k.t - prev.t < 5);
          const killer = k.killer ? playerLookup.get(k.killer) : undefined;
          const victim = k.victim ? playerLookup.get(k.victim) : undefined;
          const team = victim?.team === "ct" ? ctTeamName : ttTeamName;
          return (
            <div
              key={i}
              className={
                "flex items-center gap-1.5 px-2 py-1 text-[11px] font-mono-rs rounded " +
                (isTrade ? "ml-2.5 opacity-90" : "")
              }
            >
              <span
                className={
                  "truncate flex-1 text-right " +
                  (killer?.team === "ct" ? "text-ct" : "text-tt")
                }
              >
                {killer?.name ?? k.killer ?? "?"}
              </span>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground/80 lowercase whitespace-nowrap">
                {(k.weapon ?? "?").replace("weapon_", "")}
                {k.headshot && (
                  <span className="text-loss ml-0.5" title="headshot">·hs</span>
                )}
              </span>
              <span className="text-muted-foreground">→</span>
              <span
                className={
                  "truncate flex-1 line-through " +
                  (victim?.team === "ct" ? "text-ct/60" : "text-tt/60")
                }
              >
                {victim?.name ?? k.victim ?? "?"}
              </span>
              <span className="rs-badge bg-surface text-muted-foreground/80 ml-1 shrink-0">
                {team}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
