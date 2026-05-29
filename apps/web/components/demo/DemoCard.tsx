"use client";

import Link from "next/link";
import { BarChart3, Loader2, Play, Plus, Tag, Trash2 } from "lucide-react";

import { cn } from "@/lib/utils";
import type { DemoSummary } from "@/types/demo";

interface DemoCardProps {
  demo: DemoSummary;
  onDelete?: () => void;
  deleting?: boolean;
}

/**
 * CS2.CAM-style demo row — radar background of the map, big score numerals
 * tinted by who won, action chips on the right (2D viewer, Stats, delete).
 */
export function DemoCard({ demo, onDelete, deleting }: DemoCardProps) {
  const completed = demo.status === "completed";
  const processing = demo.status === "processing" || demo.status === "queued" || demo.status === "uploaded";
  const day = new Date(demo.uploadedAt);
  const dayLabel = day.toLocaleString(undefined, { day: "2-digit", month: "short" }).toUpperCase();
  const score = demo.score;
  const aWins = score && score[0] > score[1];
  const bWins = score && score[1] > score[0];
  const radarUrl = demo.map ? `/maps/${demo.map}.png` : null;

  return (
    <div className="group relative rounded-xl border border-border/40 overflow-hidden bg-surface-elevated/40 hover:bg-surface-elevated/70 hover:border-border transition-all">
      {/* Subtle radar backdrop scoped to the score column */}
      {radarUrl && (
        <div
          className="absolute left-0 top-0 bottom-0 w-[420px] pointer-events-none opacity-20 mix-blend-luminosity"
          style={{
            backgroundImage: `linear-gradient(90deg, transparent 0%, hsl(var(--surface)) 90%), url(${radarUrl})`,
            backgroundSize: "auto 220%",
            backgroundPosition: "center",
            backgroundRepeat: "no-repeat",
          }}
        />
      )}

      <div className="relative flex items-center gap-4 px-4 py-3">
        {/* Date + map identity column */}
        <div className="flex items-center gap-4 min-w-[330px]">
          <div className="text-[10px] font-mono-rs text-muted-foreground tracking-widest leading-tight">
            <div>{dayLabel.split(" ")[0]}</div>
            <div className="text-muted-foreground/70">{dayLabel.split(" ")[1]}</div>
          </div>

          <div className="flex-1 min-w-0">
            {/* Score row 1 */}
            <div className="flex items-center gap-3 leading-none">
              {score ? (
                <span
                  className={cn(
                    "font-display font-black text-2xl tabular-nums tracking-tight w-8 text-right",
                    aWins ? "text-win" : "text-loss",
                  )}
                >
                  {score[0]}
                </span>
              ) : (
                <span className="font-display font-black text-2xl text-muted-foreground/40 w-8 text-right">—</span>
              )}
              <span className="text-sm font-bold uppercase tracking-wide truncate">
                {capitalizeMap(demo.map)}
              </span>
            </div>
            {/* Score row 2 */}
            <div className="flex items-center gap-3 leading-none mt-1.5">
              {score ? (
                <span
                  className={cn(
                    "font-display font-black text-2xl tabular-nums tracking-tight w-8 text-right",
                    bWins ? "text-win" : "text-loss",
                  )}
                >
                  {score[1]}
                </span>
              ) : (
                <span className="font-display font-black text-2xl text-muted-foreground/40 w-8 text-right">—</span>
              )}
              <span className="text-sm font-semibold text-muted-foreground truncate">
                {teamLabel(demo)}
              </span>
            </div>
          </div>
        </div>

        {/* Tag column */}
        <div className="flex-1 flex items-center">
          <button
            disabled
            title="Tagging coming soon"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-dashed border-border text-muted-foreground/70 text-xs hover:border-border/70 transition-colors cursor-not-allowed"
          >
            <Plus size={12} />
            <Tag size={11} className="opacity-70" />
            Add tag
          </button>
        </div>

        {/* Status / progress for non-completed demos */}
        {processing && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 size={12} className="animate-spin text-primary" />
            <span className="font-mono-rs">{demo.processingProgress}%</span>
          </div>
        )}
        {demo.status === "failed" && (
          <span className="rs-badge bg-loss/15 text-loss">Failed</span>
        )}

        {/* Action buttons */}
        <div className="flex items-center gap-2 flex-shrink-0">
          {completed ? (
            <>
              <Link
                href={`/demo/${demo.id}/replay`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md bg-primary/10 text-primary hover:bg-primary/20 transition-colors text-xs font-semibold"
              >
                <Play size={12} fill="currentColor" />
                2D
              </Link>
              <Link
                href={`/demo/${demo.id}/overview`}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-md border border-border bg-surface hover:border-border/80 transition-colors text-xs font-semibold"
              >
                <BarChart3 size={12} />
                Stats
              </Link>
            </>
          ) : (
            <span className="text-xs text-muted-foreground italic px-3">
              {demo.status === "uploaded" ? "Queued…" : demo.status === "queued" ? "Waiting…" : demo.status === "processing" ? "Processing…" : "—"}
            </span>
          )}
          <button
            onClick={onDelete}
            disabled={deleting}
            title="Delete demo"
            className="p-2 rounded-md text-muted-foreground/70 hover:text-loss hover:bg-loss/10 transition-colors disabled:opacity-40"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Progress bar for in-flight processing — pinned to bottom of the row */}
      {processing && (
        <div className="absolute left-0 right-0 bottom-0 h-0.5 bg-surface">
          <div
            className="h-full bg-primary transition-all duration-500"
            style={{ width: `${demo.processingProgress}%` }}
          />
        </div>
      )}
    </div>
  );
}

function capitalizeMap(name: string | null): string {
  if (!name) return "Unknown map";
  return name.replace(/^de_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function teamLabel(demo: DemoSummary): string {
  // Phase 0 — prefer the real team/clan names extracted from the demo.
  // Falls back to the filename stem for older demos parsed before clan
  // extraction (teamA/teamB still null until they're re-parsed).
  if (demo.teamA && demo.teamB) {
    const m = `${demo.teamA} vs ${demo.teamB}`;
    return m.length > 30 ? m.slice(0, 28) + "…" : m;
  }
  const base = (demo.filename || "team").replace(/\.dem(\.gz)?$/i, "");
  if (base.length > 24) return base.slice(0, 22) + "…";
  return base;
}
