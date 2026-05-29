"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";
import type { AntiStratTeam } from "@/types/anti-strat";

/**
 * Shared header for the scouting sections (Anti-strat / Vetos / Pre-partida).
 * Renders the section title + a team selector backed by ``?team=`` in the URL,
 * auto-selecting the first team so a section never starts empty.
 */
export function SectionHeader({
  title,
  icon: Icon,
}: {
  title: string;
  icon: React.ElementType;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const team = useSearchParams().get("team");
  const [teams, setTeams] = useState<AntiStratTeam[] | null>(null);

  useEffect(() => {
    api.antiStrat.teams().then(setTeams).catch(() => setTeams([]));
  }, []);

  useEffect(() => {
    if (!team && teams && teams.length) {
      router.replace(`${pathname}?team=${encodeURIComponent(teams[0].name)}`);
    }
  }, [team, teams, pathname, router]);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-4 mb-5">
      <h1 className="text-xl font-display font-bold flex items-center gap-2">
        <Icon size={18} className="text-primary" /> {title}
      </h1>
      <select
        value={team ?? ""}
        onChange={(e) =>
          router.push(`${pathname}?team=${encodeURIComponent(e.target.value)}`)
        }
        className="bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/60 min-w-[190px]"
      >
        {!team && <option value="">Elegí un equipo…</option>}
        {(teams ?? []).map((t) => (
          <option key={t.name} value={t.name}>
            {t.name} ({t.rounds})
          </option>
        ))}
      </select>
    </div>
  );
}
