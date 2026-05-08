"use client";

import Link from "next/link";
import { CheckCircle2, Clock, ExternalLink, Loader2, Trash2, AlertCircle, Inbox } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

import { useDeleteDemo, useDemos } from "@/lib/hooks/useDemos";
import { cn } from "@/lib/utils";
import type { DemoStatus, DemoSummary } from "@/types/demo";

const STATUS_META: Record<DemoStatus, { label: string; color: string; icon: React.ElementType }> = {
  uploaded:   { label: "Uploaded",   color: "text-muted-foreground", icon: Clock },
  queued:     { label: "Queued",     color: "text-muted-foreground", icon: Clock },
  processing: { label: "Analyzing",  color: "text-accent",           icon: Loader2 },
  completed:  { label: "Ready",      color: "text-win",              icon: CheckCircle2 },
  failed:     { label: "Failed",     color: "text-loss",             icon: AlertCircle },
};

export function DemoList() {
  const { data: demos, isLoading, error } = useDemos();
  const del = useDeleteDemo();

  if (isLoading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-xl shimmer-loading" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 space-y-2">
        <AlertCircle className="mx-auto text-loss" size={28} />
        <p className="text-sm text-muted-foreground">
          Couldn’t reach the API. Make sure the backend is running on{" "}
          <span className="text-foreground font-mono-rs">:8000</span>.
        </p>
      </div>
    );
  }

  if (!demos || demos.length === 0) {
    return (
      <div className="text-center py-12 space-y-3">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-surface-elevated flex items-center justify-center">
          <Inbox size={20} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-foreground font-semibold">No demos yet</p>
          <p className="text-sm text-muted-foreground">
            Drop a .dem file to start your first analysis.
          </p>
        </div>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {demos.map((demo) => (
        <DemoRow
          key={demo.id}
          demo={demo}
          onDelete={() => del.mutate(demo.id)}
          deleting={del.isPending}
        />
      ))}
    </ul>
  );
}

function DemoRow({
  demo,
  onDelete,
  deleting,
}: {
  demo: DemoSummary;
  onDelete: () => void;
  deleting: boolean;
}) {
  const meta = STATUS_META[demo.status];
  const Icon = meta.icon;
  const spin = demo.status === "processing";
  const uploadedAgo = formatDistanceToNow(new Date(demo.uploadedAt), { addSuffix: true });

  return (
    <li className="rounded-xl border border-border bg-surface-elevated/40 hover:bg-surface-elevated transition-colors">
      <div className="flex items-center gap-4 p-4">
        <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-surface flex items-center justify-center">
          <Icon size={16} className={cn(meta.color, spin && "animate-spin")} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm truncate">{demo.filename}</span>
            <span className={cn("rs-badge", meta.color, "bg-surface")}>{meta.label}</span>
            {demo.map && (
              <span className="text-xs text-muted-foreground font-mono-rs">{demo.map}</span>
            )}
            {demo.score && (
              <span className="text-xs font-mono-rs text-foreground/80">
                {demo.score[0]}–{demo.score[1]}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Uploaded {uploadedAgo}
            {demo.errorMessage && (
              <span className="text-loss ml-2">• {demo.errorMessage}</span>
            )}
          </div>

          {(demo.status === "processing" || demo.status === "queued" || demo.status === "uploaded") && (
            <div className="h-1 mt-2 bg-surface rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${demo.processingProgress}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {demo.status === "completed" && (
            <Link
              href={`/demo/${demo.id}/replay`}
              className="p-2 rounded-md text-primary hover:bg-primary/10 transition-colors"
              title="Open analysis"
            >
              <ExternalLink size={14} />
            </Link>
          )}
          <button
            onClick={onDelete}
            disabled={deleting}
            className="p-2 rounded-md text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors disabled:opacity-40"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>
    </li>
  );
}
