"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import {
  ArrowLeft,
  BarChart2,
  Clock,
  DollarSign,
  Loader2,
  AlertCircle,
  PlayCircle,
  Users,
} from "lucide-react";

import { useDemo, useDemoStatus } from "@/lib/hooks/useDemos";
import { cn, formatDuration } from "@/lib/utils";

const tabs = [
  { href: "replay",   label: "2D Replay", icon: PlayCircle },
  { href: "overview", label: "Overview",  icon: BarChart2 },
  { href: "rounds",   label: "Rounds",    icon: Clock },
  { href: "players",  label: "Players",   icon: Users },
  { href: "economy",  label: "Economy",   icon: DollarSign },
];

export default function DemoDetailLayout({ children }: { children: React.ReactNode }) {
  const params = useParams<{ id: string }>();
  const pathname = usePathname();
  const id = params?.id;

  const { data: demo, isLoading } = useDemo(id ?? null);
  const { data: status } = useDemoStatus(id ?? null);

  const liveStatus = status?.status ?? demo?.status;
  const isProcessing =
    liveStatus === "queued" || liveStatus === "processing" || liveStatus === "uploaded";
  const failed = liveStatus === "failed";

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-4">
        <Link
          href="/demos"
          className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground text-sm transition-colors w-fit"
        >
          <ArrowLeft size={14} />
          Back to demos
        </Link>

        <div className="sm:ml-4 min-w-0 flex-1">
          {isLoading ? (
            <div className="h-7 w-60 shimmer-loading rounded-md" />
          ) : demo ? (
            <>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className="text-xl font-display font-bold">
                  {demo.map ?? "Pending analysis"}
                </h1>
                {demo.score && (
                  <span
                    className={cn(
                      "rs-badge",
                      demo.score[0] > demo.score[1] ? "bg-win/15 text-win" : "bg-loss/15 text-loss",
                    )}
                  >
                    {demo.score[0] > demo.score[1] ? "WIN" : "LOSS"} {demo.score[0]}–{demo.score[1]}
                  </span>
                )}
                {demo.processedAt && (
                  <span className="text-xs text-muted-foreground font-mono-rs">
                    {new Date(demo.processedAt).toLocaleDateString()}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                {demo.filename}
                {demo.roundCount && ` • ${demo.roundCount} rounds`}
                {demo.durationSeconds && ` • ${formatDuration(demo.durationSeconds)}`}
              </p>
            </>
          ) : (
            <div className="text-sm text-muted-foreground">Demo not found</div>
          )}
        </div>
      </div>

      {isProcessing && (
        <div className="glass-card border border-primary/20 rounded-xl p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Loader2 size={18} className="animate-spin text-primary" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold">
              Analyzing demo… {status?.progress ?? demo?.processingProgress ?? 0}%
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              The 2D replay will be ready as soon as analysis completes.
            </p>
            <div className="h-1.5 bg-surface-elevated rounded-full overflow-hidden mt-3">
              <div
                className="h-full bg-primary rounded-full transition-all duration-500"
                style={{ width: `${status?.progress ?? demo?.processingProgress ?? 0}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {failed && (
        <div className="glass-card border border-loss/30 rounded-xl p-5 flex items-center gap-4">
          <AlertCircle className="text-loss flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-loss">Analysis failed</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status?.errorMessage ?? demo?.errorMessage ?? "Unknown error"}
            </p>
          </div>
        </div>
      )}

      <div className="flex gap-1 p-1 bg-surface rounded-xl w-fit border border-border overflow-x-auto">
        {tabs.map((tab) => {
          const active = pathname?.endsWith(tab.href) ?? false;
          const Icon = tab.icon;
          return (
            <Link
              key={tab.href}
              href={`/demo/${id}/${tab.href}`}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap",
                active
                  ? "bg-surface-elevated text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon size={14} />
              {tab.label}
            </Link>
          );
        })}
      </div>

      <div>{children}</div>
    </div>
  );
}
