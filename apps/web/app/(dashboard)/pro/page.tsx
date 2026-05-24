"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  Download,
  ExternalLink,
  Globe,
  Loader2,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  Trophy,
} from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { ProMatchUploadModal } from "@/components/replay/ProMatchUploadModal";
import { useT } from "@/lib/i18n/useT";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

type ProMatch = Awaited<ReturnType<typeof api.pro.matches>>["matches"][number];

type DateFilter = "today" | "week" | "month" | "all";

const DATE_FILTERS: { key: DateFilter; label: string; days: number | null }[] = [
  { key: "today", label: "Hoy",           days: 1 },
  { key: "week",  label: "Última semana", days: 7 },
  { key: "month", label: "Último mes",    days: 30 },
  { key: "all",   label: "Todas",         days: null },
];

export default function ProMatchesPage() {
  const t = useT();
  const qc = useQueryClient();
  const [dateFilter, setDateFilter] = useState<DateFilter>("week");
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["pro-matches"],
    queryFn: () => api.pro.matches(200),
    refetchInterval: 60_000,
  });

  const { data: schedulerStatus } = useQuery({
    queryKey: ["pro-scheduler"],
    queryFn: () => api.pro.schedulerStatus(),
    // Poll less aggressively — the scheduler ticks every 30 s anyway,
    // and this is purely informational. Stale data here is fine.
    refetchInterval: 30_000,
  });

  const sync = useMutation({
    mutationFn: () => api.pro.sync(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pro-matches"] }),
  });

  const proxyTest = useMutation({
    mutationFn: () => api.pro.testProxy(),
  });

  const isAdmin = useAuthStore((s) => s.user?.is_admin ?? false);
  const [uploadOpen, setUploadOpen] = useState(false);

  const allMatches = data?.matches ?? [];

  // Show ONLY past completed matches. Upcoming and live sections were
  // removed per spec — the user only cares about matches that can be
  // watched in 2D. A match counts as "past + watchable candidate" if:
  //   - it has a final score AND total >= 2  (a decisive BO result),
  //   - OR its scheduled time is >= 4 h in the past (Liquipedia
  //     sometimes forgets to fill in the score for finished matches).
  // Everything else (upcoming, in-progress, no data) gets hidden.
  const pastMatches = useMemo(
    () => allMatches.filter(isPastMatch),
    [allMatches],
  );

  // Apply user filters (date window + free-text search) and sort:
  //   1. Imported + parsed first (have a demoId, ready to watch).
  //   2. Then by played_at desc — newer matches first.
  const visible = useMemo(() => {
    const filtered = filterByDate(pastMatches, dateFilter).filter((m) =>
      matchesSearch(m, search),
    );
    return [...filtered].sort((a, b) => {
      // Watchable rises to the top.
      const aWatchable = a.demoId != null ? 1 : 0;
      const bWatchable = b.demoId != null ? 1 : 0;
      if (aWatchable !== bWatchable) return bWatchable - aWatchable;
      // Then newest first.
      const ta = a.playedAt ? new Date(a.playedAt).getTime() : 0;
      const tb = b.playedAt ? new Date(b.playedAt).getTime() : 0;
      return tb - ta;
    });
  }, [pastMatches, dateFilter, search]);

  const watchableCount = pastMatches.filter((m) => m.demoId != null).length;
  const importableCount = pastMatches.filter(
    (m) => m.demoId == null && !!m.demoUrl,
  ).length;

  // Group visible matches by date so the UI mirrors HLTV's
  // "results page" structure — each day is a separate stripe.
  const groupedByDate = useMemo(() => groupByDate(visible), [visible]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {/* HERO */}
      <header className="glass-card rounded-2xl p-6 sm:p-8 relative overflow-hidden">
        <div
          aria-hidden
          className="absolute -top-20 -right-20 w-72 h-72 bg-primary/10 rounded-full blur-3xl pointer-events-none"
        />
        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-xl bg-primary-dim flex items-center justify-center flex-shrink-0 ring-1 ring-primary/30">
              <Trophy size={26} className="text-primary" />
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-display font-black tracking-tight">
                {t("pro.title")}
              </h1>
              <p className="text-sm text-muted-foreground mt-1 max-w-xl">
                Partidas pro terminadas, listas para ver en 2D. Se agregan
                automáticamente apenas terminan.
              </p>
              <p className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground/70 mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {schedulerStatus?.index_from && (
                  <>
                    <span>Desde</span>
                    <span className="text-primary/80">
                      {formatCutoff(schedulerStatus.index_from)}
                    </span>
                    <span>·</span>
                  </>
                )}
                <span>{t("pro.sourceLiquipedia")}</span>
                <span>·</span>
                <a
                  href="https://liquipedia.net/counterstrike/Liquipedia:Copyrights"
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary/80 hover:text-primary hover:underline"
                >
                  CC BY-SA
                </a>
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 self-start sm:self-center">
            {isAdmin && (
              <button
                onClick={() => setUploadOpen(true)}
                title="Subir un .dem manualmente con metadata del match"
                className={cn(
                  "inline-flex items-center gap-2 px-4 py-2.5 rounded-lg",
                  "bg-primary text-primary-foreground text-sm font-semibold",
                  "hover:bg-primary/90 transition-colors shadow-sm glow-primary",
                  "whitespace-nowrap",
                )}
              >
                <Plus size={14} />
                Subir partida
              </button>
            )}
            <button
              onClick={() => proxyTest.mutate()}
              disabled={proxyTest.isPending}
              title="Verifica que el proxy configurado en .env esté ruteando tráfico"
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2.5 rounded-lg",
                "bg-surface-elevated text-foreground/80 text-xs font-semibold border border-border",
                "hover:bg-surface hover:text-foreground hover:border-border-strong",
                "disabled:opacity-50 transition-colors whitespace-nowrap",
              )}
            >
              {proxyTest.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Globe size={13} />
              )}
              Probar proxy
            </button>
            <button
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              title="Pull manual de Liquipedia (el scheduler lo hace cada 15 min)"
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2.5 rounded-lg",
                "bg-surface-elevated text-foreground/80 text-xs font-semibold border border-border",
                "hover:bg-surface hover:text-foreground hover:border-border-strong",
                "disabled:opacity-50 transition-colors whitespace-nowrap",
              )}
            >
              {sync.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCw size={13} />
              )}
              Sync
            </button>
          </div>
        </div>

        {/* Admin-only upload modal — mounted at the header level so it
            stays above the page content. Refreshes the match list on
            success so the just-uploaded match appears immediately. */}
        {isAdmin && (
          <ProMatchUploadModal
            open={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onSuccess={() => {
              qc.invalidateQueries({ queryKey: ["pro-matches"] });
            }}
          />
        )}

        {/* Counters strip — at-a-glance totals so the user immediately
            knows the state of the library. */}
        <div className="relative mt-5 grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3">
          <Counter
            label="LISTAS PARA 2D"
            value={watchableCount}
            highlight
          />
          <Counter
            label="IMPORTABLES"
            value={importableCount}
          />
          <Counter
            label="TOTAL"
            value={pastMatches.length}
          />
        </div>

        {/* Background-scheduler indicator + diagnostic chips. */}
        <div className="relative mt-4 flex flex-wrap items-center gap-2">
          {schedulerStatus?.running && (
            <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-primary/10 border border-primary/30 text-primary">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
              </span>
              <span>Auto-import activo</span>
              {schedulerStatus.last_import_count > 0 && (
                <>
                  <span className="text-primary/50">·</span>
                  <span>{schedulerStatus.last_import_count} recientes</span>
                </>
              )}
            </div>
          )}
          {/* Liquipedia rate-limit banner. When our IP is throttled,
              show how many seconds until we can hit them again — this
              is the most common reason matches aren't appearing. */}
          {schedulerStatus &&
            schedulerStatus.liquipedia_cooldown_seconds > 0 && (
              <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-500">
                <AlertCircle size={11} />
                <span>
                  Liquipedia en cooldown ·{" "}
                  {Math.ceil(schedulerStatus.liquipedia_cooldown_seconds / 60)} min
                </span>
              </div>
            )}
          {/* RAR extraction status — only flag when MISSING. When
              available we stay silent (it's expected to work). */}
          {schedulerStatus && !schedulerStatus.rar_extraction.available && (
            <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-loss/10 border border-loss/30 text-loss">
              <AlertCircle size={11} />
              <span>unrar no disponible · demos .rar quedan sin extraer</span>
            </div>
          )}
          {/* Proxy-test result — shown after the user clicks "Probar
              proxy". Three states: success (green), proxy-not-set
              (gray), or error (red). Helps validate paid-proxy
              credentials BEFORE depending on them for scheduler runs. */}
          {proxyTest.data && (
            <div
              className={cn(
                "inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md",
                proxyTest.data.proxy_ok
                  ? "bg-win/10 border border-win/30 text-win"
                  : proxyTest.data.configured == null
                    ? "bg-surface-elevated border border-border text-muted-foreground"
                    : "bg-loss/10 border border-loss/30 text-loss",
              )}
            >
              {proxyTest.data.proxy_ok ? (
                <>
                  <CheckCircle2 size={11} />
                  <span>
                    Proxy OK · sale por{" "}
                    <span className="text-foreground">{proxyTest.data.proxy_ip}</span>
                    {proxyTest.data.proxy_latency_ms != null && (
                      <> · {proxyTest.data.proxy_latency_ms}ms</>
                    )}
                  </span>
                </>
              ) : proxyTest.data.configured == null ? (
                <>
                  <AlertCircle size={11} />
                  <span>
                    No hay proxy configurado · directo desde{" "}
                    <span className="text-foreground">
                      {proxyTest.data.direct_ip ?? "?"}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <AlertCircle size={11} />
                  <span>
                    Proxy falló · {proxyTest.data.errors[0] ?? "ver logs"}
                  </span>
                </>
              )}
            </div>
          )}
          {sync.data && (
            <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-surface-elevated border border-border/50">
              <span className="text-muted-foreground">manual sync:</span>
              <span className="text-foreground">{sync.data.inserted}</span>
              <span className="text-muted-foreground">new</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-foreground">{sync.data.updated}</span>
              <span className="text-muted-foreground">updated</span>
              {sync.data.errors.length > 0 && (
                <>
                  <span className="text-muted-foreground">·</span>
                  <span className="text-loss">{sync.data.errors.length} errors</span>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* FILTER BAR */}
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <div className="flex gap-1.5 p-1 bg-surface rounded-xl border border-border w-fit overflow-x-auto">
          {DATE_FILTERS.map((f) => {
            const count = countForFilter(pastMatches, f.key);
            const active = dateFilter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setDateFilter(f.key)}
                className={cn(
                  "px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all flex items-center gap-1.5",
                  active
                    ? "bg-surface-elevated text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {f.label}
                <span
                  className={cn(
                    "px-1.5 rounded text-[10px] font-mono-rs",
                    active
                      ? "bg-primary/20 text-primary"
                      : "bg-surface-elevated text-muted-foreground/70",
                  )}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            size={13}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar equipo o torneo…"
            className="w-full bg-surface border border-border rounded-lg pl-9 pr-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
        </div>
      </div>

      {/* CONTENT */}
      {error ? (
        <div className="glass-card border-loss/30 rounded-xl p-6 flex items-center gap-3">
          <AlertCircle size={18} className="text-loss" />
          <span className="text-sm text-loss">Failed to load pro matches.</span>
        </div>
      ) : isLoading ? (
        <SkeletonList />
      ) : visible.length === 0 ? (
        <EmptyState
          onSync={() => sync.mutate()}
          syncing={sync.isPending}
          allCount={allMatches.length}
          pastCount={pastMatches.length}
        />
      ) : (
        <div className="space-y-5">
          {groupedByDate.map(({ dateLabel, matches }) => (
            <DateGroup
              key={dateLabel}
              dateLabel={dateLabel}
              matches={matches}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// Counter — small KPI tiles in the header
// ============================================================

function Counter({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg px-3 py-2 border",
        highlight
          ? "bg-primary/10 border-primary/30"
          : "bg-surface-elevated/50 border-border/40",
      )}
    >
      <div
        className={cn(
          "text-[9px] font-mono-rs uppercase tracking-widest font-semibold",
          highlight ? "text-primary/80" : "text-muted-foreground",
        )}
      >
        {label}
      </div>
      <div
        className={cn(
          "font-mono-rs text-xl font-bold mt-0.5",
          highlight ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}

// ============================================================
// Date group + match row
// ============================================================

function DateGroup({
  dateLabel,
  matches,
}: {
  dateLabel: string;
  matches: ProMatch[];
}) {
  return (
    <section>
      <div className="flex items-center gap-3 mb-2 px-1">
        <h2 className="text-xs font-mono-rs uppercase tracking-widest font-semibold text-muted-foreground">
          {dateLabel}
        </h2>
        <span className="text-[10px] font-mono-rs text-muted-foreground/60">
          {matches.length} {matches.length === 1 ? "partida" : "partidas"}
        </span>
        <div className="flex-1 h-px bg-border/50" />
      </div>
      <div className="glass-card rounded-xl divide-y divide-border/40 overflow-hidden">
        {matches.map((m) => (
          <MatchRow key={m.id} match={m} />
        ))}
      </div>
    </section>
  );
}

function MatchRow({ match }: { match: ProMatch }) {
  const aWon =
    match.scoreA != null &&
    match.scoreB != null &&
    match.scoreA > match.scoreB;
  const bWon =
    match.scoreA != null &&
    match.scoreB != null &&
    match.scoreB > match.scoreA;
  const watchable = match.demoId != null;

  return (
    <div
      className={cn(
        "px-4 py-3 flex items-center gap-4 transition-colors",
        "hover:bg-surface-elevated/30",
        watchable && "bg-primary/[0.03]",
      )}
    >
      {/* Time + event — compact left column */}
      <div className="hidden sm:flex flex-col gap-0.5 w-32 flex-shrink-0">
        <div className="text-[11px] font-mono-rs text-muted-foreground">
          {formatTime(match.playedAt)}
        </div>
        <div
          className="text-[11px] text-muted-foreground/80 truncate"
          title={match.event ?? undefined}
        >
          {match.event ?? "—"}
        </div>
      </div>

      {/* Teams + score — the centerpiece */}
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <TeamCell name={match.teamA} winner={aWon} losing={bWon} side="left" />
        <div className="flex items-center gap-1.5 font-mono-rs text-lg font-bold px-2">
          <span className={cn(aWon ? "text-primary" : "text-muted-foreground")}>
            {match.scoreA ?? 0}
          </span>
          <span className="text-muted-foreground/40 text-sm">:</span>
          <span className={cn(bWon ? "text-primary" : "text-muted-foreground")}>
            {match.scoreB ?? 0}
          </span>
        </div>
        <TeamCell name={match.teamB} winner={bWon} losing={aWon} side="right" />
      </div>

      {/* Actions — right-aligned */}
      <div className="flex-shrink-0">
        <MatchActions match={match} />
      </div>
    </div>
  );
}

function TeamCell({
  name,
  winner,
  losing,
  side,
}: {
  name: string;
  winner: boolean;
  losing: boolean;
  side: "left" | "right";
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 min-w-0",
        side === "right" && "flex-row-reverse text-right",
      )}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center font-mono-rs font-bold text-[11px] flex-shrink-0",
          winner
            ? "bg-primary/15 text-primary ring-1 ring-primary/40"
            : losing
              ? "bg-surface-elevated text-muted-foreground/70"
              : "bg-surface-elevated text-foreground/80",
        )}
      >
        {initials(name)}
      </div>
      <span
        className={cn(
          "truncate text-sm",
          winner && "font-bold text-foreground",
          losing && "text-muted-foreground",
          !winner && !losing && "font-semibold text-foreground/90",
        )}
        title={name}
      >
        {capitalize(name)}
      </span>
    </div>
  );
}

// ============================================================
// Action column — three states (watchable / importable / no demo)
// ============================================================

function MatchActions({ match }: { match: ProMatch }) {
  const qc = useQueryClient();
  const importMatch = useMutation({
    mutationFn: () => api.pro.import(match.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pro-matches"] }),
  });

  // STATE: already imported → primary "Ver en 2D" button.
  if (match.demoId) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href={`/demo/${match.demoId}/replay`}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-semibold",
            "px-3 py-1.5 rounded-md bg-primary text-primary-foreground",
            "hover:bg-primary/90 transition-colors shadow-sm",
          )}
        >
          <PlayCircle size={13} />
          Ver en 2D
          <ArrowRight size={11} />
        </Link>
        <Link
          href={`/demo/${match.demoId}`}
          className={cn(
            "inline-flex items-center gap-1 text-xs",
            "px-2.5 py-1.5 rounded-md border border-border text-muted-foreground",
            "hover:text-foreground hover:border-border-strong transition-colors",
          )}
          title="Estadísticas del partido"
        >
          <BarChart3 size={12} />
          Stats
        </Link>
      </div>
    );
  }

  // STATE: importable (has a HLTV demo URL but not imported yet).
  if (match.demoUrl) {
    const result = importMatch.data;
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => importMatch.mutate()}
            disabled={importMatch.isPending}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold",
              "px-3 py-1.5 rounded-md border border-primary/40 text-primary",
              "hover:bg-primary/10 disabled:opacity-50 transition-colors",
            )}
          >
            {importMatch.isPending ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Importando…
              </>
            ) : (
              <>
                <Download size={12} />
                Importar al 2D
              </>
            )}
          </button>
          <a
            href={match.demoUrl.replace("/download/demo/", "/matches/")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground"
            title="Abrir en HLTV"
          >
            HLTV <ExternalLink size={9} />
          </a>
        </div>
        {result && (
          <div
            className={cn(
              "text-[10px] max-w-xs text-right rounded-md px-2 py-1",
              result.status === "unsupported_archive"
                ? "bg-loss/10 text-loss border border-loss/30"
                : "bg-primary/10 text-primary border border-primary/30",
            )}
          >
            {result.message}
            {result.status === "queued" && (
              <>
                {" · "}
                <Link
                  href={`/demo/${result.demo_id}/replay`}
                  className="underline hover:no-underline"
                >
                  ver progreso
                </Link>
              </>
            )}
          </div>
        )}
        {importMatch.error && (
          <div className="text-[10px] max-w-xs text-right rounded-md px-2 py-1 bg-loss/10 text-loss border border-loss/30">
            {(importMatch.error as Error).message || "No se pudo importar"}
          </div>
        )}
      </div>
    );
  }

  // STATE: no demo available — just show a neutral indicator.
  return (
    <span className="text-[10px] font-mono-rs text-muted-foreground/60 uppercase">
      sin demo
    </span>
  );
}

// ============================================================
// Empty + loading states
// ============================================================

function SkeletonList() {
  return (
    <div className="space-y-5">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <div className="h-3 w-40 shimmer-loading rounded" />
          <div className="glass-card rounded-xl divide-y divide-border/40">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 shimmer-loading" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({
  onSync,
  syncing,
  allCount,
  pastCount,
}: {
  onSync: () => void;
  syncing: boolean;
  allCount: number;
  pastCount: number;
}) {
  // Tailor the copy to the actual state — first-time visit vs. just
  // an unlucky filter window — so the user knows what to do.
  const firstTime = allCount === 0;
  const noPastInFilter = !firstTime && pastCount === 0;

  return (
    <div className="glass-card rounded-2xl p-12 text-center">
      <div className="w-14 h-14 rounded-2xl bg-primary-dim mx-auto flex items-center justify-center">
        <Trophy size={26} className="text-primary opacity-70" />
      </div>
      {firstTime ? (
        <>
          <h3 className="mt-4 text-base font-display font-semibold">
            Todavía no hay partidas indexadas
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Click "Sincronizar ahora" para traer las últimas partidas pro
            desde Liquipedia. Después podés importar cada demo al visor 2D
            con un click.
          </p>
        </>
      ) : noPastInFilter ? (
        <>
          <h3 className="mt-4 text-base font-display font-semibold">
            Ninguna partida terminada en este rango
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Probá con un rango más amplio (Última semana / Último mes /
            Todas) o sincronizá para traer nuevas.
          </p>
        </>
      ) : (
        <>
          <h3 className="mt-4 text-base font-display font-semibold">
            Sin resultados
          </h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
            Limpiá la búsqueda o cambiá el filtro de fecha.
          </p>
        </>
      )}
      <button
        onClick={onSync}
        disabled={syncing}
        className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {syncing ? (
          <Loader2 size={13} className="animate-spin" />
        ) : (
          <RefreshCw size={13} />
        )}
        Sincronizar ahora
      </button>
    </div>
  );
}

// ============================================================
// Match classification (past-only) + helpers
// ============================================================

/**
 * A match counts as "past" — and therefore eligible to appear on
 * this page — when either:
 *   (a) it has a final-looking score (sum >= 2), OR
 *   (b) its scheduled time is more than 4 h in the past.
 *
 * That covers every state we care about: completed matches with a
 * recorded score, AND matches Liquipedia forgot to populate but
 * are clearly over by now. Live + upcoming matches are excluded
 * since they have nothing to watch yet.
 */
function isPastMatch(m: ProMatch): boolean {
  const hasScore = m.scoreA != null && m.scoreB != null;
  const sum = (m.scoreA ?? 0) + (m.scoreB ?? 0);
  if (hasScore && sum >= 2) return true;
  if (m.playedAt) {
    const t = new Date(m.playedAt).getTime();
    if (Date.now() - t > 4 * 60 * 60 * 1000) return true;
  }
  return false;
}

function filterByDate(matches: ProMatch[], filter: DateFilter): ProMatch[] {
  if (filter === "all") return matches;
  const spec = DATE_FILTERS.find((f) => f.key === filter);
  if (!spec || spec.days == null) return matches;
  const cutoff = Date.now() - spec.days * 24 * 60 * 60 * 1000;
  return matches.filter((m) => {
    if (!m.playedAt) return false;
    return new Date(m.playedAt).getTime() >= cutoff;
  });
}

function countForFilter(matches: ProMatch[], filter: DateFilter): number {
  return filterByDate(matches, filter).length;
}

function matchesSearch(m: ProMatch, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return (
    m.teamA.toLowerCase().includes(needle) ||
    m.teamB.toLowerCase().includes(needle) ||
    (m.event ?? "").toLowerCase().includes(needle)
  );
}

function groupByDate(
  matches: ProMatch[],
): { dateLabel: string; matches: ProMatch[] }[] {
  const map = new Map<string, ProMatch[]>();
  for (const m of matches) {
    const key = formatDateGroupKey(m.playedAt);
    const arr = map.get(key);
    if (arr) arr.push(m);
    else map.set(key, [m]);
  }
  // Order: most recent date first.
  return Array.from(map.entries())
    .map(([dateLabel, items]) => ({ dateLabel, matches: items }))
    .sort((a, b) => {
      const ta = a.matches[0]?.playedAt
        ? new Date(a.matches[0].playedAt).getTime()
        : 0;
      const tb = b.matches[0]?.playedAt
        ? new Date(b.matches[0].playedAt).getTime()
        : 0;
      return tb - ta;
    });
}

function formatDateGroupKey(iso: string | null): string {
  if (!iso) return "Sin fecha";
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  if (d >= startOfToday) return "Hoy";
  if (d >= startOfYesterday) return "Ayer";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: d.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatCutoff(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function initials(name: string): string {
  if (!name) return "?";
  const words = name.trim().split(/\s+/);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

function capitalize(s: string): string {
  if (!s) return s;
  return s
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
