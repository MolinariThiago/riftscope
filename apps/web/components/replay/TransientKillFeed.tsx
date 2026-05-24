"use client";

import { useMemo } from "react";
import { Target } from "lucide-react";

import { cn } from "@/lib/utils";
import { weaponIconUrl } from "@/components/replay/weaponIcons";
import type { PlayerStats, TimelineEvent } from "@/types/demo";

interface TransientKillFeedProps {
  events: TimelineEvent[];
  playerLookup: Map<string, PlayerStats>;
  currentTime: number;
  /** How long each kill stays visible after it happens (seconds). */
  ttl?: number;
}

/**
 * In-game-style killfeed — each kill flashes in for ``ttl`` seconds then
 * fades out. Lives in the top-left of the replay viewport, mirroring the
 * vanilla CS2 HUD behavior.
 *
 * Implementation: derive the visible slice from `events + currentTime`
 * rather than maintaining a React queue. That way scrubbing the timeline
 * backward correctly hides future kills, and forward-jumping doesn't
 * leave stale notifications on screen.
 */
export function TransientKillFeed({
  events,
  playerLookup,
  currentTime,
  ttl = 4,
}: TransientKillFeedProps) {
  const visible = useMemo(() => {
    // Most recent first. The HUD shows the freshest kill on top, like CS2.
    const recent: { e: TimelineEvent; alpha: number; age: number }[] = [];
    for (const e of events) {
      if (e.type !== "kill") continue;
      const age = currentTime - e.t;
      if (age < 0 || age > ttl) continue;
      // Stay fully opaque for the first 75% of the lifetime then fade.
      const fadeStart = ttl * 0.75;
      const alpha = age <= fadeStart
        ? 1
        : Math.max(0, 1 - (age - fadeStart) / (ttl - fadeStart));
      recent.push({ e, alpha, age });
    }
    recent.sort((a, b) => b.e.t - a.e.t);
    return recent.slice(0, 6);
  }, [events, currentTime, ttl]);

  if (visible.length === 0) return null;

  return (
    // Killfeed lives just below the top-center scoreboard, anchored
    // to the LEFT edge of the available canvas. Pulled out of the
    // canvas-corner slot so it doesn't collide with the right-side
    // team panels — the user couldn't see it before because it sat
    // behind the tools strip.
    <div className="absolute top-20 left-3 z-20 flex flex-col gap-1.5 pointer-events-none">
      {visible.map(({ e, alpha, age }) => {
        const killer = e.killer ? playerLookup.get(e.killer) : null;
        const victim = e.victim ? playerLookup.get(e.victim) : null;
        const weapon = (e.weapon ?? "").replace(/^weapon_/, "");
        const weaponIcon = weaponIconUrl(weapon);
        // Slide-in for the first 150ms — the fresh kill animates in
        // from the right so the user notices the new entry. After
        // that age becomes irrelevant and the card sits still.
        const slide = Math.max(0, 1 - age / 0.15) * 24;
        return (
          <div
            key={`${e.t}-${e.killer}-${e.victim}`}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md bg-background/95 backdrop-blur-md border border-border/60 text-[12px] shadow-xl self-start"
            style={{
              opacity: alpha,
              transform: `translateX(${slide}px)`,
              transition: "transform 120ms ease-out",
            }}
          >
            <span
              className={cn(
                "font-bold tracking-wide truncate max-w-[110px]",
                killer?.team === "ct" ? "text-ct" : "text-tt",
              )}
              title={killer?.name ?? "?"}
            >
              {killer?.name ?? "?"}
            </span>
            <span className="inline-flex items-center gap-1.5 text-foreground/80">
              {e.headshot && <Target size={11} className="text-loss" />}
              {weaponIcon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={weaponIcon}
                  alt={weapon}
                  className="h-3.5 w-auto object-contain"
                  style={{
                    maxWidth: "44px",
                    filter:
                      "brightness(0) invert(1) drop-shadow(0 0 1px rgba(0,0,0,0.7))",
                  }}
                  draggable={false}
                />
              ) : (
                <span className="font-mono-rs text-[10px] uppercase tracking-wider">
                  {prettyWeapon(weapon)}
                </span>
              )}
            </span>
            <span
              className={cn(
                "font-bold tracking-wide truncate max-w-[110px] line-through",
                victim?.team === "ct" ? "text-ct/55" : "text-tt/55",
              )}
              title={victim?.name ?? "?"}
            >
              {victim?.name ?? "?"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function prettyWeapon(w: string): string {
  const m: Record<string, string> = {
    ak47: "AK-47",
    m4a1: "M4A4",
    m4a1_silencer: "M4A1-S",
    awp: "AWP",
    deagle: "DEAGLE",
    usp_silencer: "USP-S",
    p2000: "P2000",
    glock: "GLOCK",
    fiveseven: "FIVE-7",
    tec9: "TEC-9",
    p250: "P250",
    cz75a: "CZ-75",
    elite: "DUAL",
    revolver: "R8",
    famas: "FAMAS",
    galilar: "GALIL",
    sg556: "SG553",
    aug: "AUG",
    mac10: "MAC10",
    mp9: "MP9",
    mp7: "MP7",
    mp5sd: "MP5",
    ump45: "UMP",
    p90: "P90",
    bizon: "BIZON",
    nova: "NOVA",
    mag7: "MAG7",
    xm1014: "XM1014",
    sawedoff: "SAWED",
    ssg08: "SCOUT",
    scar20: "SCAR",
    g3sg1: "G3SG1",
    hegrenade: "HE",
    inferno: "FIRE",
    knife: "KNIFE",
  };
  if (m[w]) return m[w];
  if (w.includes("knife") || w === "bayonet") return "KNIFE";
  return w.slice(0, 8).toUpperCase();
}
