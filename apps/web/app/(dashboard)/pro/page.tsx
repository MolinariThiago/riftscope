"use client";

import {
  AlertCircle,
  ExternalLink,
  Loader2,
  RefreshCw,
  Trophy,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";

export default function ProMatchesPage() {
  const t = useT();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["pro-matches"],
    queryFn: () => api.pro.matches(100),
  });

  const sync = useMutation({
    mutationFn: () => api.pro.sync(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pro-matches"] }),
  });

  const matches = data?.matches ?? [];
  const upcoming = matches.filter(
    (m) =>
      m.playedAt &&
      new Date(m.playedAt) > new Date() &&
      (m.scoreA == null || m.scoreA + (m.scoreB ?? 0) === 0),
  );
  const completed = matches.filter(
    (m) => !upcoming.includes(m),
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="w-11 h-11 rounded-xl bg-primary-dim flex items-center justify-center flex-shrink-0">
            <Trophy size={20} className="text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-display font-bold">{t("pro.title")}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("pro.subtitle")}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1 italic">
              {t("pro.sourceLiquipedia")} ·{" "}
              <a
                href="https://liquipedia.net/counterstrike/Liquipedia:Copyrights"
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                CC BY-SA
              </a>
            </p>
          </div>
        </div>

        <button
          onClick={() => sync.mutate()}
          disabled={sync.isPending}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs border border-border hover:border-primary hover:text-primary transition-colors disabled:opacity-50"
        >
          {sync.isPending ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          {t("pro.syncNow")}
        </button>
      </div>

      {sync.data && (
        <div className="glass-card rounded-lg p-3 text-xs text-muted-foreground">
          Sync: <span className="text-foreground">{sync.data.inserted}</span> new ·{" "}
          <span className="text-foreground">{sync.data.updated}</span> updated
          {sync.data.errors.length > 0 && (
            <span className="text-loss"> · {sync.data.errors.length} errors</span>
          )}
        </div>
      )}

      {error && (
        <div className="glass-card border-loss/30 rounded-lg p-4 flex items-center gap-3">
          <AlertCircle size={16} className="text-loss" />
          <span className="text-sm text-loss">Failed to load pro matches.</span>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-16 shimmer-loading rounded-lg" />
          ))}
        </div>
      ) : matches.length === 0 ? (
        <div className="glass-card rounded-xl p-12 text-center text-sm text-muted-foreground">
          {t("pro.noMatches")}
        </div>
      ) : (
        <div className="space-y-6">
          {upcoming.length > 0 && (
            <Section title={t("pro.upcoming")}>
              {upcoming.map((m) => (
                <MatchRow key={m.id} match={m} upcoming />
              ))}
            </Section>
          )}
          {completed.length > 0 && (
            <Section title={t("pro.completed")}>
              {completed.map((m) => (
                <MatchRow key={m.id} match={m} />
              ))}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
        {title}
      </h2>
      <div className="glass-card rounded-xl divide-y divide-border-subtle">
        {children}
      </div>
    </section>
  );
}

function MatchRow({
  match,
  upcoming = false,
}: {
  match: NonNullable<Awaited<ReturnType<typeof api.pro.matches>>["matches"][number]>;
  upcoming?: boolean;
}) {
  const t = useT();
  const aWon = match.scoreA != null && match.scoreB != null && match.scoreA > match.scoreB;
  const bWon = match.scoreA != null && match.scoreB != null && match.scoreB > match.scoreA;

  return (
    <div className="px-4 py-3 flex items-center gap-3 hover:bg-surface-elevated/40 transition-colors">
      <div className="text-[11px] font-mono-rs text-muted-foreground w-20 flex-shrink-0">
        {match.playedAt
          ? new Date(match.playedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })
          : "—"}
      </div>

      <div className="flex-1 grid grid-cols-[1fr_auto_1fr] items-center gap-3 min-w-0">
        <div className={cn("text-sm truncate text-right", aWon && "font-semibold text-foreground", !aWon && match.scoreA != null && "text-muted-foreground")}>
          {capitalize(match.teamA)}
        </div>
        <div className="font-mono-rs text-sm text-foreground text-center min-w-[60px]">
          {match.scoreA != null && match.scoreB != null ? (
            <span>
              {match.scoreA} <span className="text-muted-foreground">·</span> {match.scoreB}
            </span>
          ) : (
            <span className="text-muted-foreground">vs</span>
          )}
        </div>
        <div className={cn("text-sm truncate", bWon && "font-semibold text-foreground", !bWon && match.scoreB != null && "text-muted-foreground")}>
          {capitalize(match.teamB)}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-shrink-0">
        {upcoming && (
          <span className="rs-badge bg-primary/10 text-primary">{t("pro.upcoming")}</span>
        )}
        {match.demoUrl && (
          <a
            href={match.demoUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
            title={match.demoUrl}
          >
            demo <ExternalLink size={10} />
          </a>
        )}
      </div>
    </div>
  );
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
