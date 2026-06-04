"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  RotateCcw,
  RefreshCcw,
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
  // Map / team / event filters — set to "" to mean "All". The dropdowns
  // are populated from the matches actually present in the feed so the
  // operator can only pick something that's going to give results.
  const [mapFilter, setMapFilter] = useState("");
  const [teamFilter, setTeamFilter] = useState("");
  const [eventFilter, setEventFilter] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["pro-matches"],
    queryFn: () => api.pro.matches(200),
    // Poll fast while any match is mid-download so its "Descargando…"
    // state updates promptly; idle back to once a minute otherwise.
    refetchInterval: (query) =>
      (query.state.data?.matches ?? []).some(
        (m) => m.importStatus === "importing",
      )
        ? 5_000
        : 60_000,
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

  // Reset demos stuck in ``processing`` for >30 min. The worker is
  // SIGKILL'd mid-parse on Railway Hobby OOM and the exception path
  // never runs, so the row stays "processing" forever and the card
  // spins. This button is the manual recovery — see backend
  // ``routers/admin.py::admin_reset_stuck_demos``.
  const resetStuck = useMutation({
    mutationFn: () => api.admin.resetStuckDemos(30),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pro-matches"] }),
  });

  // Re-queue every ``failed`` pro demo for parsing. Reuses the on-disk
  // .dem bytes — no re-download, no manual delete + re-upload. Scoped
  // to ``proOnly=true`` so a stray solo upload that failed for a
  // legit reason isn't accidentally retried alongside.
  const retryFailed = useMutation({
    mutationFn: () => api.admin.retryFailedDemos(true, 50),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pro-matches"] }),
  });

  // Purge follow-up: when retry detects demos whose .dem bytes are
  // missing from S3, this deletes those rows and frees the linked
  // ProMatches so the scheduler can re-grab them from HLTV.
  const purgeMissing = useMutation({
    mutationFn: () => api.admin.purgeMissingDemos(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["pro-matches"] }),
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

  // Apply user filters (date window + free-text search + map/team/event
  // dropdowns) and sort:
  //   1. Imported + parsed first (have a demoId, ready to watch).
  //   2. Then by played_at desc — newer matches first.
  const visible = useMemo(() => {
    const filtered = filterByDate(pastMatches, dateFilter)
      .filter((m) => matchesSearch(m, search))
      .filter((m) => matchesMap(m, mapFilter))
      .filter((m) => matchesTeam(m, teamFilter))
      .filter((m) => matchesEvent(m, eventFilter));
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
  }, [pastMatches, dateFilter, search, mapFilter, teamFilter, eventFilter]);

  // Distinct options for the dropdowns — derived from the matches the
  // user could actually pick. Sorted alphabetically. Counts (not used in
  // the UI today) could be added by upgrading these to {label, count}.
  const mapOptions = useMemo(() => collectMaps(pastMatches), [pastMatches]);
  const teamOptions = useMemo(() => collectTeams(pastMatches), [pastMatches]);
  const eventOptions = useMemo(() => collectEvents(pastMatches), [pastMatches]);

  const hasActiveFilters = !!(mapFilter || teamFilter || eventFilter || search);

  const watchableCount = pastMatches.filter((m) => m.demoId != null).length;
  // "Importable" = match is over (has a score) and we haven't pulled the
  // demo yet. demoUrl is optional now because HltvSource leaves it null
  // and the import worker resolves it on demand from the match page.
  const importableCount = pastMatches.filter(
    (m) => m.demoId == null && m.scoreA != null && m.scoreB != null,
  ).length;

  // Group visible matches by date so the UI mirrors HLTV's
  // "results page" structure — each day is a separate stripe.
  const groupedByDate = useMemo(() => groupByDate(visible), [visible]);

  // Public/Reader header — everyone (logged-in users) sees this minimal
  // banner so /pro stays scannable. The big "Partidas pro" block with
  // upload / sync controls, KPI counters and scheduler diagnostics moved
  // BELOW this and is gated to admins only — those tools aren't for
  // regular users and were dominating the view.
  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      {!isAdmin && (
        <header className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-dim flex items-center justify-center flex-shrink-0 ring-1 ring-primary/20">
            <Trophy size={18} className="text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-display font-black tracking-tight">
              {t("pro.title")}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Partidas pro terminadas, listas para ver en 2D.
            </p>
          </div>
        </header>
      )}

      {/* HERO — admin only. Holds the upload button, proxy / sync
          controls, KPI counters and the scheduler diagnostics chip row.
          None of that is useful to a regular user, and showing it made
          the page look like an admin panel. */}
      {isAdmin && (
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
              onClick={() => resetStuck.mutate()}
              disabled={resetStuck.isPending}
              title="Marca como fallidas las demos colgadas en 'processing' por más de 30 min (libera la UI cuando el worker fue OOM-killed mid-parse)"
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2.5 rounded-lg",
                "bg-surface-elevated text-foreground/80 text-xs font-semibold border border-border",
                "hover:bg-surface hover:text-foreground hover:border-border-strong",
                "disabled:opacity-50 transition-colors whitespace-nowrap",
              )}
            >
              {resetStuck.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              Reset atascadas
            </button>
            <button
              onClick={() => retryFailed.mutate()}
              disabled={retryFailed.isPending}
              title="Vuelve a parsear todas las demos pro que fallaron (reutiliza los bytes ya descargados, no toca disco)"
              className={cn(
                "inline-flex items-center gap-2 px-3 py-2.5 rounded-lg",
                "bg-surface-elevated text-foreground/80 text-xs font-semibold border border-border",
                "hover:bg-surface hover:text-foreground hover:border-border-strong",
                "disabled:opacity-50 transition-colors whitespace-nowrap",
              )}
            >
              {retryFailed.isPending ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RefreshCcw size={13} />
              )}
              Reintentar fallidas
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
          {/* Reset result — shown after the user clicks "Reset
              atascadas". Green chip with the counts when something
              was actually unstuck; muted chip when nothing matched
              the cutoff (the happy path on a healthy worker). */}
          {resetStuck.data && (
            <div
              className={cn(
                "inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md",
                resetStuck.data.demosReset > 0
                  ? "bg-win/10 border border-win/30 text-win"
                  : "bg-surface-elevated border border-border text-muted-foreground",
              )}
            >
              <CheckCircle2 size={11} />
              {resetStuck.data.demosReset > 0 ? (
                <span>
                  Liberadas{" "}
                  <span className="text-foreground">{resetStuck.data.demosReset}</span>{" "}
                  demos atascadas
                  {resetStuck.data.matchesReset > 0 && (
                    <>
                      {" "}· {resetStuck.data.matchesReset} matches reseteados
                    </>
                  )}
                </span>
              ) : (
                <span>Sin demos atascadas hace +30 min</span>
              )}
            </div>
          )}
          {resetStuck.isError && (
            <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-loss/10 border border-loss/30 text-loss">
              <AlertCircle size={11} />
              <span>Reset falló · ver logs</span>
            </div>
          )}
          {/* Retry-failed result. Three states:
              - Re-queued at least 1 → green chip with the count.
              - Found missing-byte demos → amber chip with a
                "Purgar y reimportar" button that fires the cleanup
                endpoint (delete row + clear ProMatch.demo_id so the
                scheduler re-downloads from HLTV).
              - Nothing matched → muted chip. */}
          {retryFailed.data && (
            <>
              {retryFailed.data.requeued > 0 && (
                <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-win/10 border border-win/30 text-win">
                  <CheckCircle2 size={11} />
                  <span>
                    Reencoladas{" "}
                    <span className="text-foreground">{retryFailed.data.requeued}</span>{" "}
                    demos fallidas
                  </span>
                </div>
              )}
              {retryFailed.data.missingBytes > 0 && (
                <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-500">
                  <AlertCircle size={11} />
                  <span>
                    <span className="text-foreground">
                      {retryFailed.data.missingBytes}
                    </span>{" "}
                    sin bytes en S3
                  </span>
                  <button
                    onClick={() => purgeMissing.mutate()}
                    disabled={purgeMissing.isPending}
                    className="ml-1 px-1.5 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 hover:text-amber-200 disabled:opacity-50 transition-colors"
                    title="Borra esas Demo rows y libera el ProMatch así el scheduler las vuelve a bajar de HLTV"
                  >
                    {purgeMissing.isPending ? "purgando…" : "purgar + reimportar"}
                  </button>
                </div>
              )}
              {retryFailed.data.requeued === 0 &&
                retryFailed.data.missingBytes === 0 && (
                  <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-surface-elevated border border-border text-muted-foreground">
                    <CheckCircle2 size={11} />
                    <span>Sin demos fallidas para reintentar</span>
                  </div>
                )}
            </>
          )}
          {/* Purge follow-up result. */}
          {purgeMissing.data && (
            <div
              className={cn(
                "inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md",
                purgeMissing.data.deleted > 0
                  ? "bg-win/10 border border-win/30 text-win"
                  : "bg-surface-elevated border border-border text-muted-foreground",
              )}
            >
              <CheckCircle2 size={11} />
              {purgeMissing.data.deleted > 0 ? (
                <span>
                  Purgadas{" "}
                  <span className="text-foreground">{purgeMissing.data.deleted}</span>{" "}
                  · {purgeMissing.data.matchesCleared} matches listos para re-import
                </span>
              ) : (
                <span>Nada para purgar</span>
              )}
            </div>
          )}
          {retryFailed.isError && (
            <div className="inline-flex items-center gap-2 text-[11px] font-mono-rs px-2.5 py-1 rounded-md bg-loss/10 border border-loss/30 text-loss">
              <AlertCircle size={11} />
              <span>Retry falló · ver logs</span>
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
      )}

      {/* FILTER BAR — row 1: date window pills + search */}
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

      {/* FILTER BAR — row 2: map / team / tournament dropdowns. Options
          are derived from the matches in the feed so the operator can
          only pick something that actually has results. Empty string =
          "all"; the clear-all button only appears when at least one of
          these (or the search) is active so the UI stays quiet. */}
      <div className="flex flex-wrap items-center gap-2 -mt-2">
        <FilterDropdown
          label="Mapa"
          value={mapFilter}
          onChange={setMapFilter}
          // Options come in as canonical lowercase IDs ("mirage", "dust2")
          // and the dropdown renders the display name ("Mirage", "Dust2").
          options={mapOptions.map((m) => ({ value: m, label: prettyMapName(m) }))}
          placeholder="Todos los mapas"
        />
        <FilterDropdown
          label="Equipo"
          value={teamFilter}
          onChange={setTeamFilter}
          options={teamOptions}
          placeholder="Todos los equipos"
        />
        <FilterDropdown
          label="Torneo"
          value={eventFilter}
          onChange={setEventFilter}
          options={eventOptions}
          placeholder="Todos los torneos"
        />
        {hasActiveFilters && (
          <button
            onClick={() => {
              setMapFilter("");
              setTeamFilter("");
              setEventFilter("");
              setSearch("");
            }}
            className="text-[11px] font-mono-rs text-muted-foreground hover:text-foreground px-2 py-1 rounded-md hover:bg-surface-elevated transition-colors"
          >
            Limpiar filtros
          </button>
        )}
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
// FilterDropdown — compact native <select> with our visual idiom
// ============================================================
// Accepts either a plain string[] (when the option's display label IS
// the value, e.g. team names) OR {value, label}[] (for the map filter,
// where ``value`` is the canonical "mirage" id but the label shown to
// the user is "Mirage"). Keeping it polymorphic avoids forcing every
// caller into the verbose object form.
type DropdownOption = string | { value: string; label: string };

function FilterDropdown({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: DropdownOption[];
  placeholder: string;
}) {
  const active = value !== "";
  return (
    <label
      className={cn(
        "relative flex items-center gap-1.5 rounded-lg border text-xs transition-colors",
        "px-2.5 py-1.5 pr-7",
        active
          ? "bg-primary/10 border-primary/40 text-primary"
          : "bg-surface border-border text-muted-foreground hover:text-foreground",
      )}
    >
      <span className="font-mono-rs text-[10px] uppercase tracking-wider opacity-70">
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-transparent outline-none cursor-pointer pr-3 max-w-[180px] truncate"
      >
        <option value="">{placeholder}</option>
        {options.map((opt) => {
          const v = typeof opt === "string" ? opt : opt.value;
          const l = typeof opt === "string" ? opt : opt.label;
          return (
            <option key={v} value={v}>
              {l}
            </option>
          );
        })}
      </select>
      <ChevronDown
        size={11}
        className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none opacity-60"
      />
    </label>
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

  // Bo3 / Bo5 — when more than one map is linked, the row expands into a
  // card showing the series header and a sub-row per map (cs2.cam style).
  // The series header retains the time / event / teams / score; each
  // map gets its own thumbnail, individual score and "Ver en 2D" button.
  const maps = match.maps ?? [];
  const isSeries = maps.length > 1;

  return (
    <div
      className={cn(
        "transition-colors",
        "hover:bg-surface-elevated/30",
        watchable && "bg-primary/[0.03]",
        isSeries && "border-b border-border/40 last:border-b-0",
      )}
    >
      {/* SERIES HEADER (same layout as the original single-row view) */}
      <div className="px-4 py-3 flex items-center gap-4">
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

        {/* Actions — right-aligned. For a Bo3 we collapse to a small
            "BO3 · N mapas" pill since each map gets its own CTA below;
            for a Bo1 the original action column is rendered as before. */}
        <div className="flex-shrink-0">
          {isSeries ? (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-elevated border border-border/50 text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground">
              <span className="text-primary font-bold">BO{maps.length}</span>
              <span>· {maps.length} mapas</span>
            </div>
          ) : (
            <MatchActions match={match} />
          )}
        </div>
      </div>

      {/* PER-MAP SUB-ROWS — only on Bo3/Bo5. Each map: thumbnail, score,
          map name + which team picked it, and a primary "Ver en 2D"
          button. Mirrors the cs2.cam Public Demos layout the user asked
          for. */}
      {isSeries && (
        <div className="px-4 pb-3 space-y-1.5">
          {maps.map((m, idx) => (
            <MatchMapSubRow
              key={m.demoId}
              index={idx}
              demoMap={m}
              teamA={match.teamA}
              teamB={match.teamB}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// One row per map inside a Bo3/Bo5 card. Inspired by cs2.cam's
// "Public Demos" layout: small visual indicator on the left (map
// initials in lieu of a thumbnail asset), per-map score, status, and a
// direct "Ver en 2D" CTA so the user doesn't need to expand anything.
function MatchMapSubRow({
  index,
  demoMap,
  teamA,
  teamB,
}: {
  index: number;
  demoMap: NonNullable<ProMatch["maps"]>[number];
  teamA: string;
  teamB: string;
}) {
  const aWon =
    demoMap.scoreA != null &&
    demoMap.scoreB != null &&
    demoMap.scoreA > demoMap.scoreB;
  const bWon =
    demoMap.scoreA != null &&
    demoMap.scoreB != null &&
    demoMap.scoreB > demoMap.scoreA;
  const isParsing =
    demoMap.status === "uploaded" ||
    demoMap.status === "queued" ||
    demoMap.status === "processing";
  const isFailed = demoMap.status === "failed";
  const isReady = demoMap.status === "completed";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 border border-border/40",
        "bg-surface-elevated/40 hover:bg-surface-elevated/70 transition-colors",
      )}
    >
      {/* Map thumbnail surrogate — 2-letter pill with the map's name.
          Both the avatar and the display label use the normalised /
          pretty form so ``de_mirage`` and ``Mirage`` look the same in
          the UI. */}
      <div className="flex items-center gap-2 w-32 flex-shrink-0">
        {(() => {
          const norm = normalizeMapName(demoMap.map);
          const pretty = norm ? prettyMapName(norm) : "—";
          const avatar = norm ? norm.slice(0, 2).toUpperCase() : "??";
          return (
            <>
              <div className="w-9 h-9 rounded-md bg-surface flex items-center justify-center text-[10px] font-mono-rs uppercase tracking-wider text-primary border border-border">
                {avatar}
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-mono-rs text-muted-foreground/70 uppercase tracking-wider">
                  Mapa {index + 1}
                </div>
                <div className="text-xs font-semibold truncate">{pretty}</div>
              </div>
            </>
          );
        })()}
      </div>

      {/* Per-map score with team names — read-only context */}
      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-xs">
        <div
          className={cn(
            "truncate text-right",
            aWon ? "text-primary font-bold" : "text-muted-foreground",
          )}
          title={teamA}
        >
          {teamA}
        </div>
        <div className="font-mono-rs font-bold px-1.5">
          <span className={cn(aWon ? "text-primary" : "text-muted-foreground")}>
            {demoMap.scoreA ?? "—"}
          </span>
          <span className="text-muted-foreground/40 mx-0.5">:</span>
          <span className={cn(bWon ? "text-primary" : "text-muted-foreground")}>
            {demoMap.scoreB ?? "—"}
          </span>
        </div>
        <div
          className={cn(
            "truncate",
            bWon ? "text-primary font-bold" : "text-muted-foreground",
          )}
          title={teamB}
        >
          {teamB}
        </div>
      </div>

      {/* Per-map action — same vocabulary as the Bo1 button strip but
          slightly tighter to fit the sub-row density. */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {isReady && (
          <>
            <Link
              href={`/demo/${demoMap.demoId}/replay`}
              className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <PlayCircle size={11} />
              Ver en 2D
            </Link>
            <Link
              href={`/demo/${demoMap.demoId}`}
              className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-border text-muted-foreground hover:text-foreground hover:border-border-strong transition-colors"
              title="Estadísticas"
            >
              <BarChart3 size={11} />
            </Link>
          </>
        )}
        {isParsing && (
          <span className="text-[11px] font-mono-rs text-accent inline-flex items-center gap-1 px-2 py-1">
            <Loader2 size={11} className="animate-spin" />
            {demoMap.processingProgress}%
          </span>
        )}
        {isFailed && (
          <span
            className="text-[11px] font-mono-rs text-loss inline-flex items-center gap-1 px-2 py-1"
            title={demoMap.errorMessage ?? undefined}
          >
            <AlertCircle size={11} />
            Falló
          </span>
        )}
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

  // Bo3/Bo5 are rendered by MatchRow as per-map sub-rows now, so this
  // function only gets called for Bo1 (or rows that have exactly one
  // imported map). Render the original single-button strip.
  const maps = match.maps ?? [];
  if (maps.length > 0) {
    const primary = maps[0];
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href={`/demo/${primary.demoId}/replay`}
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
          href={`/demo/${primary.demoId}`}
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

  // STATE: download running in the background (set by the import endpoint,
  // cleared when the Demo row appears). Driven by polling — survives reloads
  // and reflects the REAL download, not just this tab's in-flight request.
  if (match.importStatus === "importing") {
    return (
      <div
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-semibold",
          "px-3 py-1.5 rounded-md border border-primary/30 text-primary bg-primary/5",
        )}
        title="Descargando la demo desde HLTV en segundo plano"
      >
        <Loader2 size={12} className="animate-spin" />
        Descargando demo…
      </div>
    );
  }

  // STATE: importable — match is over (has a score) and we haven't pulled
  // the demo yet. Two sub-cases that both render the same button:
  //   - demo_url is already known (we scraped it earlier or someone
  //     uploaded it manually).
  //   - demo_url is null but the match came from HltvSource. The import
  //     worker scrapes the match page on demand to find the demo link, so
  //     a null demo_url is still importable — we just can't deep-link to
  //     HLTV without first resolving the slug. That's why the "HLTV" side
  //     link is conditional on demoUrl below.
  const hasScore = match.scoreA != null && match.scoreB != null;
  if (hasScore) {
    const failed = match.importStatus === "failed";
    return (
      <div className="flex flex-col items-end gap-1">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => importMatch.mutate()}
            disabled={importMatch.isPending}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-semibold",
              "px-3 py-1.5 rounded-md border text-primary",
              "hover:bg-primary/10 disabled:opacity-50 transition-colors",
              failed ? "border-loss/40 text-loss hover:bg-loss/10" : "border-primary/40",
            )}
          >
            {importMatch.isPending ? (
              <>
                <Loader2 size={12} className="animate-spin" />
                Iniciando…
              </>
            ) : (
              <>
                <Download size={12} />
                {failed ? "Reintentar" : "Importar al 2D"}
              </>
            )}
          </button>
          {match.demoUrl && (
            <a
              href={match.demoUrl.replace("/download/demo/", "/matches/")}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/70 hover:text-foreground"
              title="Abrir en HLTV"
            >
              HLTV <ExternalLink size={9} />
            </a>
          )}
        </div>
        {failed && match.importError && (
          <div className="text-[10px] max-w-xs text-right rounded-md px-2 py-1 bg-loss/10 text-loss border border-loss/30">
            {match.importError}
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

  // STATE: match isn't actually over yet (no score) — neutral indicator.
  return (
    <span className="text-[10px] font-mono-rs text-muted-foreground/60 uppercase">
      sin demo
    </span>
  );
}

// ============================================================
// Bo3 series — one row per map shown when the user expands the card
// ============================================================
function SeriesMapRow({
  index,
  demoMap,
}: {
  index: number;
  demoMap: NonNullable<ProMatch["maps"]>[number];
}) {
  // Pretty status label — same vocabulary as DemoCard so the user sees
  // a consistent state across the app.
  const isParsing =
    demoMap.status === "uploaded" ||
    demoMap.status === "queued" ||
    demoMap.status === "processing";
  const isFailed = demoMap.status === "failed";
  const isReady = demoMap.status === "completed";

  return (
    <div
      className={cn(
        "w-full flex items-center justify-between gap-2 px-2 py-1 rounded-md",
        "bg-surface-elevated/40 border border-border/40 text-[11px]",
      )}
    >
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className="text-muted-foreground/70 font-mono-rs text-[10px]">
          M{index + 1}
        </span>
        <span className="text-foreground/90 font-medium truncate">
          {demoMap.map || "—"}
        </span>
        {demoMap.scoreA != null && demoMap.scoreB != null && (
          <span className="text-muted-foreground/70 font-mono-rs">
            {demoMap.scoreA}:{demoMap.scoreB}
          </span>
        )}
      </div>
      {isReady && (
        <div className="flex items-center gap-1">
          <Link
            href={`/demo/${demoMap.demoId}/replay`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/15 text-primary hover:bg-primary/25 transition-colors font-semibold"
          >
            <PlayCircle size={10} />
            Ver
          </Link>
          <Link
            href={`/demo/${demoMap.demoId}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-muted-foreground hover:text-foreground transition-colors"
            title="Estadísticas del mapa"
          >
            <BarChart3 size={10} />
          </Link>
        </div>
      )}
      {isParsing && (
        <div className="flex items-center gap-1 text-accent">
          <Loader2 size={10} className="animate-spin" />
          <span>{demoMap.processingProgress}%</span>
        </div>
      )}
      {isFailed && (
        <span
          className="text-loss flex items-center gap-1"
          title={demoMap.errorMessage ?? undefined}
        >
          <AlertCircle size={10} />
          Falló
        </span>
      )}
    </div>
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

function matchesMap(m: ProMatch, map: string): boolean {
  if (!map) return true;
  const target = normalizeMapName(map);
  if (!target) return true;
  // A match satisfies the map filter when EITHER its primary map_name
  // equals it (for non-Bo3 rows that only have one map), OR any map in
  // its series does. Normalize both sides so ``de_mirage`` matches
  // ``mirage`` matches ``Mirage``.
  if (normalizeMapName(m.map) === target) return true;
  return (m.maps ?? []).some((x) => normalizeMapName(x.map) === target);
}

function matchesTeam(m: ProMatch, team: string): boolean {
  if (!team) return true;
  return m.teamA === team || m.teamB === team;
}

function matchesEvent(m: ProMatch, ev: string): boolean {
  if (!ev) return true;
  return (m.event ?? "") === ev;
}

// Active map pool (CS2). The order here is the order the dropdown shows
// them in — most-played first, then the rest alphabetical-ish. Anything
// else that comes from the backend (``bo3``, ``tba``, ``de_train_old``,
// the operator typoing a map name into a manual upload, ...) is dropped
// from the dropdown entirely so the filter list stays clean.
const KNOWN_MAPS = [
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
const KNOWN_MAP_SET = new Set<string>(KNOWN_MAPS);

function normalizeMapName(raw: string | null | undefined): string {
  if (!raw) return "";
  // ``de_mirage`` → ``mirage`` (Valve's bsp prefix slips into demo metadata).
  // ``Mirage``    → ``mirage`` (display casing).
  // Trims whitespace defensively.
  return raw.trim().toLowerCase().replace(/^de_/, "");
}

function prettyMapName(raw: string): string {
  // The dropdown displays e.g. "Mirage" / "Dust2" — capitalised
  // canonical form. Special-case dust2 because "Dust2" is the
  // conventional rendering, not "Dust 2".
  if (raw === "dust2") return "Dust2";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function collectMaps(matches: ProMatch[]): string[] {
  // We could just return KNOWN_MAPS unconditionally — but then the
  // dropdown would offer maps that none of the user's matches use,
  // which clutters the UI when /pro only has a few matches. So filter
  // by "actually present" while still enforcing the pool whitelist.
  const present = new Set<string>();
  for (const m of matches) {
    const a = normalizeMapName(m.map);
    if (KNOWN_MAP_SET.has(a)) present.add(a);
    for (const x of m.maps ?? []) {
      const n = normalizeMapName(x.map);
      if (KNOWN_MAP_SET.has(n)) present.add(n);
    }
  }
  // Return in KNOWN_MAPS order — Mirage / Dust2 / Inferno first, not
  // alphabetical, because that matches how CS2 players think of the
  // pool and matches the order in the spec the user wrote.
  return KNOWN_MAPS.filter((m) => present.has(m));
}

function collectTeams(matches: ProMatch[]): string[] {
  const set = new Set<string>();
  for (const m of matches) {
    if (m.teamA) set.add(m.teamA);
    if (m.teamB) set.add(m.teamB);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function collectEvents(matches: ProMatch[]): string[] {
  const set = new Set<string>();
  for (const m of matches) if (m.event) set.add(m.event);
  return Array.from(set).sort((a, b) => a.localeCompare(b));
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
