import Link from "next/link";
import { Play, BarChart3, Star } from "lucide-react";

export interface Match {
  map: string;
  event: string;
  teamA: string;
  teamB: string;
  scoreA: number;
  scoreB: number;
  topFragger: { name: string; rating: string; adr: string };
}

export function MatchCard({ match }: { match: Match }) {
  const aWins = match.scoreA > match.scoreB;

  return (
    <div className="group flex flex-col rounded-xl border border-border/60 bg-surface-elevated/40 overflow-hidden hover:border-border transition-colors">
      {/* Radar thumbnail */}
      <RadarThumb map={match.map} event={match.event} />

      {/* Score block */}
      <div className="px-4 py-3 space-y-2 border-b border-border/50">
        <ScoreRow team={match.teamA} score={match.scoreA} win={aWins} />
        <ScoreRow team={match.teamB} score={match.scoreB} win={!aWins} />
      </div>

      {/* Top fragger + actions */}
      <div className="px-4 py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Star size={12} className="text-primary flex-shrink-0" fill="currentColor" />
          <span className="text-xs font-semibold truncate">{match.topFragger.name}</span>
          <span className="text-xs font-mono-rs text-muted-foreground">{match.topFragger.rating}</span>
          <span className="text-[11px] font-mono-rs text-muted-foreground/70">· {match.topFragger.adr} ADR</span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Link
            href="/register"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-[11px] font-semibold"
          >
            <Play size={11} fill="currentColor" />
            2D
          </Link>
          <Link
            href="/register"
            aria-label="Stats"
            className="inline-flex items-center justify-center p-1.5 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-border/80 transition-colors"
          >
            <BarChart3 size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function ScoreRow({ team, score, win }: { team: string; score: number; win: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={`text-sm truncate ${win ? "font-semibold text-foreground" : "text-muted-foreground"}`}>
        {team}
      </span>
      <span className={`font-display font-black text-xl tabular-nums leading-none ${win ? "text-win" : "text-loss"}`}>
        {score}
      </span>
    </div>
  );
}

function RadarThumb({ map, event }: { map: string; event: string }) {
  const label = map.replace(/^de_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return (
    <div className="relative h-28 bg-[hsl(220_18%_7%)] overflow-hidden">
      <div className="absolute inset-0 map-grid opacity-70" />
      {/* Abstract calm map geometry */}
      <svg viewBox="0 0 200 110" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
        <g stroke="hsl(185 100% 52% / 0.18)" strokeWidth="1.2" fill="hsl(185 100% 52% / 0.04)">
          <rect x="22" y="18" width="58" height="40" rx="6" />
          <rect x="130" y="22" width="50" height="34" rx="6" />
          <rect x="84" y="62" width="40" height="34" rx="6" />
        </g>
        <path
          d="M51 58 L51 70 M155 56 L155 70 M104 96 L104 100"
          stroke="hsl(185 100% 52% / 0.18)" strokeWidth="1" strokeDasharray="3 3" fill="none"
        />
      </svg>
      {/* Bottom scrim with map + event */}
      <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-[hsl(220_18%_7%)] via-[hsl(220_18%_7%)]/70 to-transparent">
        <div className="font-display font-bold text-sm leading-none">{label}</div>
        <div className="text-[11px] text-muted-foreground font-mono-rs mt-1">{event}</div>
      </div>
    </div>
  );
}
