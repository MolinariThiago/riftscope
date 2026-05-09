"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Award, ExternalLink, Film, Link2, Trophy, User } from "lucide-react";

import { useDemos } from "@/lib/hooks/useDemos";
import { useT } from "@/lib/i18n/useT";
import { useSettings } from "@/lib/stores/settings";
import { cn, formatDuration } from "@/lib/utils";

type Tab = "overview" | "demos" | "achievements" | "integrations";

export default function ProfilePage() {
  const t = useT();
  const settings = useSettings();
  const { data: demos = [] } = useDemos();
  const [tab, setTab] = useState<Tab>("overview");

  const completed = useMemo(
    () => demos.filter((d) => d.status === "completed"),
    [demos],
  );

  const aggregates = useMemo(() => {
    let totalDemos = completed.length;
    let totalRounds = 0;
    let totalDuration = 0;
    const mapCounts: Record<string, number> = {};
    for (const d of completed) {
      totalRounds += d.roundCount ?? 0;
      totalDuration += d.durationSeconds ?? 0;
      if (d.map) mapCounts[d.map] = (mapCounts[d.map] ?? 0) + 1;
    }
    const favoriteMap =
      Object.entries(mapCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    return { totalDemos, totalRounds, totalDuration, favoriteMap, mapCounts };
  }, [completed]);

  const TABS: { key: Tab; label: string; icon: typeof User }[] = [
    { key: "overview",     label: t("profile.overview"),    icon: User },
    { key: "demos",        label: t("profile.demos"),       icon: Film },
    { key: "achievements", label: t("profile.achievements"), icon: Trophy },
    { key: "integrations", label: t("profile.integrations"), icon: Link2 },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-card rounded-xl p-6 flex flex-col sm:flex-row sm:items-center gap-5">
        <div className="w-20 h-20 rounded-full bg-primary-dim flex items-center justify-center flex-shrink-0">
          <User size={32} className="text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-display font-bold">Anonymous Player</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("profile.noProfileHint")}
          </p>
          <div className="flex flex-wrap gap-2 mt-3">
            <Badge label={settings.steamLinked ? "Steam ✓" : "Steam —"} />
            <Badge label={settings.faceitLinked ? "Faceit ✓" : "Faceit —"} />
            <Badge label={settings.hltvProfileUrl ? "HLTV ✓" : "HLTV —"} />
          </div>
        </div>
        <Link
          href="/settings"
          className="px-3 py-2 rounded-lg text-xs border border-border hover:border-primary hover:text-primary transition-colors"
        >
          {t("nav.settings")}
        </Link>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-surface rounded-xl w-fit border border-border overflow-x-auto">
        {TABS.map((tspec) => {
          const Icon = tspec.icon;
          const active = tspec.key === tab;
          return (
            <button
              key={tspec.key}
              onClick={() => setTab(tspec.key)}
              className={cn(
                "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap",
                active
                  ? "bg-surface-elevated text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon size={14} />
              {tspec.label}
            </button>
          );
        })}
      </div>

      {/* Body */}
      {tab === "overview" && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={t("profile.totalDemos")} value={aggregates.totalDemos} />
          <Stat label="Rounds" value={aggregates.totalRounds} />
          <Stat label="Total time" value={formatDuration(aggregates.totalDuration)} />
          <Stat
            label={t("profile.favoriteMap")}
            value={aggregates.favoriteMap ?? "—"}
            mono={false}
          />
        </div>
      )}

      {tab === "demos" && (
        <div className="glass-card rounded-xl overflow-hidden">
          {completed.length === 0 ? (
            <EmptyState label={t("common.empty")} />
          ) : (
            <table className="w-full rs-table">
              <thead>
                <tr>
                  <th className="text-left">Demo</th>
                  <th className="text-left">Map</th>
                  <th className="text-right">Score</th>
                  <th className="text-right">Rounds</th>
                  <th className="text-right">Date</th>
                </tr>
              </thead>
              <tbody>
                {completed.slice(0, 20).map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link
                        href={`/demo/${d.id}/replay`}
                        className="text-foreground hover:text-primary transition-colors flex items-center gap-1.5"
                      >
                        {d.filename}
                        <ExternalLink size={11} className="opacity-50" />
                      </Link>
                    </td>
                    <td className="text-sm text-muted-foreground">{d.map ?? "—"}</td>
                    <td className="text-right font-mono-rs text-sm">
                      {d.score ? d.score.join("–") : "—"}
                    </td>
                    <td className="text-right font-mono-rs text-sm text-muted-foreground">
                      {d.roundCount ?? "—"}
                    </td>
                    <td className="text-right text-xs text-muted-foreground">
                      {d.processedAt
                        ? new Date(d.processedAt).toLocaleDateString()
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === "achievements" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <AchievementCard
            unlocked={aggregates.totalDemos >= 1}
            label="First demo"
            description="Upload your first demo"
            current={Math.min(aggregates.totalDemos, 1)}
            target={1}
          />
          <AchievementCard
            unlocked={aggregates.totalDemos >= 10}
            label="Demo collector"
            description="Analyze 10 demos"
            current={Math.min(aggregates.totalDemos, 10)}
            target={10}
          />
          <AchievementCard
            unlocked={aggregates.totalDemos >= 100}
            label="Centurion"
            description="Analyze 100 demos"
            current={Math.min(aggregates.totalDemos, 100)}
            target={100}
          />
          <AchievementCard
            unlocked={Object.keys(aggregates.mapCounts).length >= 5}
            label="Globe trotter"
            description="Demos on 5 different maps"
            current={Math.min(Object.keys(aggregates.mapCounts).length, 5)}
            target={5}
          />
          <AchievementCard
            unlocked={aggregates.totalRounds >= 500}
            label="Round veteran"
            description="500 rounds analyzed"
            current={Math.min(aggregates.totalRounds, 500)}
            target={500}
          />
          <AchievementCard
            unlocked={false}
            label="Coach mode"
            description="Save your first review session (Phase 4)"
            current={0}
            target={1}
          />
        </div>
      )}

      {tab === "integrations" && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <IntegrationCard
            name="Steam"
            connected={settings.steamLinked}
            description={t("settings.steamHelp")}
          />
          <IntegrationCard
            name="Faceit"
            connected={settings.faceitLinked}
            description={t("settings.faceitHelp")}
          />
          <IntegrationCard
            name="HLTV"
            connected={!!settings.hltvProfileUrl}
            description={settings.hltvProfileUrl ?? t("settings.hltvHelp")}
            href={settings.hltvProfileUrl ?? undefined}
          />
        </div>
      )}
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="rs-badge bg-surface-elevated text-muted-foreground border border-border/50">
      {label}
    </span>
  );
}

function Stat({
  label,
  value,
  mono = true,
}: {
  label: string;
  value: number | string;
  mono?: boolean;
}) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="text-[11px] font-mono-rs uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-2xl font-bold",
          mono ? "font-mono-rs" : "font-display",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="p-12 text-center text-sm text-muted-foreground">
      <Film size={24} className="mx-auto opacity-40 mb-2" />
      {label}
    </div>
  );
}

function AchievementCard({
  unlocked,
  label,
  description,
  current,
  target,
}: {
  unlocked: boolean;
  label: string;
  description: string;
  current: number;
  target: number;
}) {
  const pct = Math.min(100, (current / target) * 100);
  return (
    <div
      className={cn(
        "glass-card rounded-xl p-4 transition-all",
        unlocked ? "border-primary/40" : "opacity-70",
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0",
            unlocked ? "bg-primary text-primary-foreground" : "bg-surface-elevated text-muted-foreground",
          )}
        >
          <Award size={18} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold">{label}</div>
          <div className="text-[11px] text-muted-foreground mt-0.5">{description}</div>
          <div className="mt-2 h-1.5 bg-surface-elevated rounded-full overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", unlocked ? "bg-primary" : "bg-muted-foreground/40")}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="text-[10px] font-mono-rs text-muted-foreground mt-1">
            {current} / {target}
          </div>
        </div>
      </div>
    </div>
  );
}

function IntegrationCard({
  name,
  connected,
  description,
  href,
}: {
  name: string;
  connected: boolean;
  description: string;
  href?: string;
}) {
  return (
    <div className="glass-card rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">{name}</span>
        <span
          className={cn(
            "rs-badge",
            connected ? "bg-win/20 text-win" : "bg-muted/40 text-muted-foreground",
          )}
        >
          {connected ? "linked" : "—"}
        </span>
      </div>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="text-[11px] text-primary hover:underline break-all flex items-center gap-1"
        >
          {description}
          <ExternalLink size={10} />
        </a>
      ) : (
        <p className="text-[11px] text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
