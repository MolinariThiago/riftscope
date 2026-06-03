"use client";

/**
 * Admin queue for the floating feedback widget.
 *
 * Renders inside /admin under the user table. Three things in one panel:
 *
 *   1. Filter chips by status (open / reviewing / resolved / dismissed +
 *      "all"), each showing the live count so an admin sees the queue
 *      depth at a glance.
 *   2. A scrollable list of reports — newest first. Click to expand and
 *      see the auto-captured metadata (page url, demo, user-agent).
 *   3. Per-row triage actions: change status, leave an internal note.
 *
 * The reporter info is shown inline (avatar + nick + steamId) so we can
 * dedupe a flood from the same user without opening every entry.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bug,
  CheckCircle2,
  ChevronDown,
  Clock,
  ExternalLink,
  FileWarning,
  Globe,
  HelpCircle,
  Inbox,
  Lightbulb,
  Loader2,
  MessageSquareText,
  RefreshCw,
  Sparkles,
  Trash2,
  XCircle,
} from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type {
  FeedbackAdminListResponse,
  FeedbackAdminRecord,
  FeedbackCategory,
  FeedbackStatus,
} from "@/types/feedback";

const STATUS_TABS: Array<{
  key: FeedbackStatus | "all";
  label: string;
  color: string;
}> = [
  { key: "all", label: "Todas", color: "text-muted-foreground" },
  { key: "open", label: "Abiertas", color: "text-primary" },
  { key: "reviewing", label: "En revisión", color: "text-accent" },
  { key: "resolved", label: "Resueltas", color: "text-win" },
  { key: "dismissed", label: "Descartadas", color: "text-muted-foreground" },
];

const CATEGORY_META: Record<
  FeedbackCategory,
  { label: string; icon: React.ElementType; color: string }
> = {
  bug: { label: "Bug", icon: Bug, color: "text-loss" },
  demo_issue: { label: "Problema demo", icon: FileWarning, color: "text-accent" },
  idea: { label: "Idea", icon: Lightbulb, color: "text-primary" },
  suggestion: { label: "Sugerencia", icon: Sparkles, color: "text-win" },
  question: { label: "Pregunta", icon: HelpCircle, color: "text-muted-foreground" },
};

const STATUS_META: Record<
  FeedbackStatus,
  { label: string; color: string; bg: string }
> = {
  open:      { label: "Abierta",      color: "text-primary",          bg: "bg-primary/15" },
  reviewing: { label: "En revisión",  color: "text-accent",           bg: "bg-accent/15" },
  resolved:  { label: "Resuelta",     color: "text-win",              bg: "bg-win/15" },
  dismissed: { label: "Descartada",   color: "text-muted-foreground", bg: "bg-surface-elevated" },
};

export function AdminFeedbackPanel() {
  const [data, setData] = useState<FeedbackAdminListResponse | null>(null);
  const [filter, setFilter] = useState<FeedbackStatus | "all">("open");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const res = await api.admin.feedback.list(
        filter === "all" ? undefined : filter,
        200,
      );
      setData(res);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo cargar el feedback.");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    refresh();
  }, [refresh]);

  const handleUpdate = useCallback(
    async (id: number, patch: { status?: FeedbackStatus; adminNotes?: string }) => {
      try {
        const updated = await api.admin.feedback.update(id, patch);
        // Patch the row in place so the user doesn't lose their scroll
        // position. Counts are refreshed via a full reload underneath so
        // the chips stay accurate.
        setData((prev) =>
          prev
            ? {
                ...prev,
                items: prev.items.map((it) => (it.id === id ? updated : it)),
              }
            : prev,
        );
        // Fire-and-forget reload of counts (they may have changed).
        refresh();
      } catch (err: any) {
        alert(err?.message ?? "No se pudo actualizar.");
      }
    },
    [refresh],
  );

  const totalAll = useMemo(() => {
    if (!data) return 0;
    return Object.values(data.counts).reduce((s, n) => s + n, 0);
  }, [data]);

  return (
    <div className="glass-card rounded-2xl p-6 border-border/30">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <MessageSquareText size={18} className="text-primary" />
          <h2 className="text-lg font-display font-bold">Feedback de usuarios</h2>
        </div>
        <button
          onClick={() => refresh()}
          disabled={loading}
          className="text-muted-foreground hover:text-foreground p-1.5 rounded-md hover:bg-surface-elevated transition-colors disabled:opacity-50"
          title="Refrescar"
        >
          <RefreshCw
            size={14}
            className={cn(loading && "animate-spin")}
          />
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-1.5 mb-4">
        {STATUS_TABS.map((t) => {
          const active = filter === t.key;
          const count =
            t.key === "all" ? totalAll : data?.counts[t.key] ?? 0;
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all",
                active
                  ? "bg-surface-elevated text-foreground shadow-sm border border-border"
                  : "bg-surface border border-border/40 text-muted-foreground hover:text-foreground",
              )}
            >
              <span>{t.label}</span>
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

      {/* Body */}
      {loading && !data ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="animate-spin text-primary" size={22} />
        </div>
      ) : error ? (
        <div className="text-sm text-loss bg-loss/10 border border-loss/30 rounded-lg px-3 py-2">
          {error}
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
          <Inbox size={28} className="mb-2 opacity-60" />
          <p className="text-sm">No hay reportes con este filtro.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data.items.map((row) => (
            <FeedbackRow
              key={row.id}
              row={row}
              expanded={expandedId === row.id}
              onToggle={() =>
                setExpandedId((cur) => (cur === row.id ? null : row.id))
              }
              onUpdate={handleUpdate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FeedbackRow({
  row,
  expanded,
  onToggle,
  onUpdate,
}: {
  row: FeedbackAdminRecord;
  expanded: boolean;
  onToggle: () => void;
  onUpdate: (
    id: number,
    patch: { status?: FeedbackStatus; adminNotes?: string },
  ) => void;
}) {
  const cat = CATEGORY_META[row.category];
  const CatIcon = cat.icon;
  const statusMeta = STATUS_META[row.status];

  // Local edit buffer for notes — only push to backend on blur/Enter.
  const [noteDraft, setNoteDraft] = useState(row.adminNotes ?? "");
  useEffect(() => {
    setNoteDraft(row.adminNotes ?? "");
  }, [row.adminNotes]);

  return (
    <div
      className={cn(
        "border border-border/40 rounded-xl transition-colors",
        expanded ? "bg-surface-elevated/50" : "bg-surface/40 hover:bg-surface-elevated/30",
      )}
    >
      {/* Summary row */}
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-start gap-3 p-3 text-left"
      >
        <div
          className={cn(
            "w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-surface border border-border/50",
            cat.color,
          )}
        >
          <CatIcon size={13} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
              {cat.label}
            </span>
            <span
              className={cn(
                "rs-badge text-[9px]",
                statusMeta.bg,
                statusMeta.color,
              )}
            >
              {statusMeta.label}
            </span>
            {row.demoId && (
              <span className="text-[10px] text-muted-foreground/80 font-mono-rs">
                demo #{row.demoId}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/70 ml-auto font-mono-rs whitespace-nowrap">
              <Clock size={9} className="inline mr-0.5" />
              {formatRelative(row.createdAt)}
            </span>
          </div>
          <p className="text-sm font-medium truncate">
            {row.subject || row.body.slice(0, 100)}
          </p>
          <div className="flex items-center gap-2 mt-0.5">
            {row.reporter && (
              <span className="text-[11px] text-muted-foreground truncate">
                {row.reporter.nick || row.reporter.steamId || "anon"}
              </span>
            )}
          </div>
        </div>
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground flex-shrink-0 mt-1 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-border/40 pt-3">
          {/* Body */}
          {row.subject && (
            <p className="text-xs text-muted-foreground italic">
              "{row.subject}"
            </p>
          )}
          <p className="text-sm whitespace-pre-wrap leading-relaxed">
            {row.body}
          </p>

          {/* Metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
            {row.pageUrl && (
              <MetaCell icon={Globe} label="URL">
                <code className="text-[10px] bg-surface px-1.5 py-0.5 rounded">
                  {row.pageUrl}
                </code>
              </MetaCell>
            )}
            {row.demoId && (
              <MetaCell icon={ExternalLink} label="Demo">
                <a
                  href={`/demo/${row.demoId}/replay`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline"
                >
                  Ver demo #{row.demoId}
                </a>
              </MetaCell>
            )}
            {row.reporter?.steamId && (
              <MetaCell icon={ExternalLink} label="Steam">
                <a
                  href={`https://steamcommunity.com/profiles/${row.reporter.steamId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-primary hover:underline font-mono-rs text-[10px]"
                >
                  {row.reporter.steamId}
                </a>
              </MetaCell>
            )}
            {row.userAgent && (
              <MetaCell icon={Globe} label="User-Agent" full>
                <span className="text-[10px] text-muted-foreground/80 font-mono-rs break-all">
                  {row.userAgent}
                </span>
              </MetaCell>
            )}
          </div>

          {/* Internal note */}
          <div>
            <label className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground block mb-1">
              Nota interna (solo admins)
            </label>
            <textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              onBlur={() => {
                if ((noteDraft || "") !== (row.adminNotes ?? "")) {
                  onUpdate(row.id, { adminNotes: noteDraft });
                }
              }}
              rows={2}
              placeholder="Triage notes para vos / otros admins"
              className="w-full bg-surface-elevated border border-border/50 rounded-lg px-2.5 py-1.5 text-xs placeholder:text-muted-foreground/60 focus:outline-none focus:border-primary/50 transition-colors resize-none"
            />
          </div>

          {/* Status actions */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <StatusAction
              label="En revisión"
              icon={Clock}
              active={row.status === "reviewing"}
              onClick={() => onUpdate(row.id, { status: "reviewing" })}
              color="text-accent"
            />
            <StatusAction
              label="Resolver"
              icon={CheckCircle2}
              active={row.status === "resolved"}
              onClick={() => onUpdate(row.id, { status: "resolved" })}
              color="text-win"
            />
            <StatusAction
              label="Descartar"
              icon={XCircle}
              active={row.status === "dismissed"}
              onClick={() => onUpdate(row.id, { status: "dismissed" })}
              color="text-muted-foreground"
            />
            {row.status !== "open" && (
              <StatusAction
                label="Reabrir"
                icon={Trash2}
                active={false}
                onClick={() => onUpdate(row.id, { status: "open" })}
                color="text-primary"
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function MetaCell({
  icon: Icon,
  label,
  children,
  full,
}: {
  icon: React.ElementType;
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <div className={cn("flex items-start gap-1.5", full && "sm:col-span-2")}>
      <Icon size={11} className="text-muted-foreground/70 flex-shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <span className="text-[9px] uppercase tracking-wider text-muted-foreground/70 font-mono-rs block mb-0.5">
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}

function StatusAction({
  label,
  icon: Icon,
  active,
  onClick,
  color,
}: {
  label: string;
  icon: React.ElementType;
  active: boolean;
  onClick: () => void;
  color: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={active}
      className={cn(
        "flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium transition-colors border",
        active
          ? "bg-surface-elevated border-border text-muted-foreground/70 cursor-not-allowed"
          : `${color} border-border/40 hover:bg-surface-elevated hover:border-border`,
      )}
    >
      <Icon size={11} />
      {label}
    </button>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!t || Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  if (diff < 60_000) return "ahora";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  return new Date(iso).toLocaleDateString();
}
