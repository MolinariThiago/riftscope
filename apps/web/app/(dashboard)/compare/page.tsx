"use client";

import { useMemo, useState } from "react";

import { api } from "@/lib/api";
import { useDemoAnalysis, useDemos } from "@/lib/hooks/useDemos";
import { useT } from "@/lib/i18n/useT";
import { cn } from "@/lib/utils";
import type { PlayerStats } from "@/types/demo";

type Mode = "match" | "player";

export default function ComparePage() {
  const t = useT();
  const [mode, setMode] = useState<Mode>("match");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">{t("compare.title")}</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{t("compare.subtitle")}</p>
      </div>

      <div className="inline-flex rounded-lg border border-border overflow-hidden bg-surface">
        <ModeButton active={mode === "match"} onClick={() => setMode("match")}>
          {t("compare.matchTab")}
        </ModeButton>
        <ModeButton active={mode === "player"} onClick={() => setMode("player")}>
          {t("compare.playerTab")}
        </ModeButton>
      </div>

      {mode === "match" ? <MatchCompare /> : <PlayerCompare />}
    </div>
  );
}

// =========================================================================
// MATCH COMPARISON — full-match metric diff
// =========================================================================

function MatchCompare() {
  const t = useT();
  const { data: demos } = useDemos();
  const completed = demos?.filter((d) => d.status === "completed") ?? [];
  const [aId, setAId] = useState<string>("");
  const [bId, setBId] = useState<string>("");

  const a = useDemoAnalysis(aId || null, !!aId);
  const b = useDemoAnalysis(bId || null, !!bId);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DemoPicker
          label={t("compare.pickDemoA")}
          value={aId}
          onChange={setAId}
          options={completed}
          other={bId}
        />
        <DemoPicker
          label={t("compare.pickDemoB")}
          value={bId}
          onChange={setBId}
          options={completed}
          other={aId}
        />
      </div>

      {!aId || !bId ? (
        <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          {t("compare.noSelection")}
        </div>
      ) : a.isLoading || b.isLoading ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="h-72 shimmer-loading rounded-xl" />
          <div className="h-72 shimmer-loading rounded-xl" />
        </div>
      ) : !a.data || !b.data ? null : (
        <div className="space-y-6">
          <MatchHeader a={a.data} b={b.data} />
          <MatchMetricGrid a={a.data} b={b.data} />
        </div>
      )}
    </div>
  );
}

function MatchHeader({
  a,
  b,
}: {
  a: NonNullable<ReturnType<typeof useDemoAnalysis>["data"]>;
  b: NonNullable<ReturnType<typeof useDemoAnalysis>["data"]>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {[a, b].map((d, i) => (
        <div key={i} className="glass-card rounded-xl p-4">
          <div className="text-[11px] font-mono-rs uppercase tracking-wider text-muted-foreground">
            {i === 0 ? "Match A" : "Match B"}
          </div>
          <div className="mt-1 text-sm font-semibold truncate">{d.demo.filename}</div>
          <div className="mt-2 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
            <span>{d.demo.map ?? "—"}</span>
            <span>·</span>
            <span className="font-mono-rs">
              {d.demo.score?.[0] ?? "?"} – {d.demo.score?.[1] ?? "?"}
            </span>
            <span>·</span>
            <span>{d.demo.roundCount ?? "?"} rounds</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function MatchMetricGrid({
  a,
  b,
}: {
  a: NonNullable<ReturnType<typeof useDemoAnalysis>["data"]>;
  b: NonNullable<ReturnType<typeof useDemoAnalysis>["data"]>;
}) {
  // Aggregate per-team stats from each match
  const aggrA = aggregateAnalysis(a);
  const aggrB = aggregateAnalysis(b);

  const rows: { label: string; a: number; b: number; higher: "good" | "bad" }[] = [
    { label: "Total kills",      a: aggrA.kills,        b: aggrB.kills,        higher: "good" },
    { label: "Total deaths",     a: aggrA.deaths,       b: aggrB.deaths,       higher: "bad" },
    { label: "Total assists",    a: aggrA.assists,      b: aggrB.assists,      higher: "good" },
    { label: "Avg ADR",          a: aggrA.adr,          b: aggrB.adr,          higher: "good" },
    { label: "Avg KAST",         a: aggrA.kast,         b: aggrB.kast,         higher: "good" },
    { label: "Avg HS%",          a: aggrA.hs,           b: aggrB.hs,           higher: "good" },
    { label: "Avg Rating",       a: aggrA.rating,       b: aggrB.rating,       higher: "good" },
    { label: "Opening kills",    a: aggrA.openingKills, b: aggrB.openingKills, higher: "good" },
    { label: "Clutches won",     a: aggrA.clutchesWon,  b: aggrB.clutchesWon,  higher: "good" },
    { label: "Bombs planted",    a: aggrA.bombsPlanted, b: aggrB.bombsPlanted, higher: "good" },
  ];

  return (
    <div className="glass-card rounded-xl divide-y divide-border-subtle">
      {rows.map((r) => (
        <DiffRow key={r.label} {...r} />
      ))}
    </div>
  );
}

function aggregateAnalysis(
  ana: NonNullable<ReturnType<typeof useDemoAnalysis>["data"]>,
) {
  const players = ana.players;
  const sum = (fn: (p: PlayerStats) => number) =>
    players.reduce((acc, p) => acc + fn(p), 0);
  const avg = (fn: (p: PlayerStats) => number) =>
    players.length > 0 ? sum(fn) / players.length : 0;

  return {
    kills: sum((p) => p.kills),
    deaths: sum((p) => p.deaths),
    assists: sum((p) => p.assists),
    adr: avg((p) => p.adr),
    kast: avg((p) => p.kast),
    hs: avg((p) => p.hsPercent),
    rating: avg((p) => p.rating),
    openingKills: sum((p) => p.openingKills),
    clutchesWon: ana.clutches.filter((c) => c.won).length,
    bombsPlanted: ana.rounds.filter((r) => r.bombPlanted).length,
  };
}

function DiffRow({
  label,
  a,
  b,
  higher,
}: {
  label: string;
  a: number;
  b: number;
  higher: "good" | "bad";
}) {
  const t = useT();
  const max = Math.max(Math.abs(a), Math.abs(b), 1);
  const pctA = (a / max) * 100;
  const pctB = (b / max) * 100;
  const diff = a - b;
  const better: "a" | "b" | "tie" =
    Math.abs(diff) < 1e-3
      ? "tie"
      : higher === "good"
        ? diff > 0
          ? "a"
          : "b"
        : diff > 0
          ? "b"
          : "a";

  const fmt = (n: number) =>
    Number.isInteger(n) ? String(n) : n.toFixed(2);

  return (
    <div className="px-4 py-3 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
      <div className="flex flex-col items-end gap-1">
        <span
          className={cn(
            "font-mono-rs text-sm",
            better === "a" ? "text-foreground font-semibold" : "text-muted-foreground",
          )}
        >
          {fmt(a)}
        </span>
        <div className="w-full max-w-[180px] h-1.5 bg-surface-elevated rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full ml-auto",
              better === "a" ? "bg-primary" : "bg-muted",
            )}
            style={{ width: `${pctA}%` }}
          />
        </div>
      </div>

      <div className="text-[11px] font-mono-rs uppercase tracking-wider text-muted-foreground text-center min-w-[120px]">
        {label}
        <div
          className={cn(
            "text-[10px] mt-0.5 font-bold",
            better === "tie"
              ? "text-muted-foreground"
              : "text-primary",
          )}
        >
          {t("compare.diff")}: {diff > 0 ? "+" : ""}
          {fmt(diff)}
        </div>
      </div>

      <div className="flex flex-col items-start gap-1">
        <span
          className={cn(
            "font-mono-rs text-sm",
            better === "b" ? "text-foreground font-semibold" : "text-muted-foreground",
          )}
        >
          {fmt(b)}
        </span>
        <div className="w-full max-w-[180px] h-1.5 bg-surface-elevated rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full",
              better === "b" ? "bg-primary" : "bg-muted",
            )}
            style={{ width: `${pctB}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// PLAYER COMPARISON — radar chart of 4 axes + per-stat diff
// =========================================================================

function PlayerCompare() {
  const t = useT();
  const { data: demos } = useDemos();
  const completed = demos?.filter((d) => d.status === "completed") ?? [];

  const [demoA, setDemoA] = useState<string>("");
  const [demoB, setDemoB] = useState<string>("");
  const [pA, setPA] = useState<string>("");
  const [pB, setPB] = useState<string>("");

  const a = useDemoAnalysis(demoA || null, !!demoA);
  const b = useDemoAnalysis(demoB || null, !!demoB);

  const playerA = a.data?.players.find((p) => p.steamId === pA);
  const playerB = b.data?.players.find((p) => p.steamId === pB);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="space-y-2">
          <DemoPicker
            label={t("compare.pickDemoA")}
            value={demoA}
            onChange={(v) => {
              setDemoA(v);
              setPA("");
            }}
            options={completed}
            other={demoB}
          />
          <PlayerPicker
            label={t("compare.pickPlayerA")}
            value={pA}
            onChange={setPA}
            options={a.data?.players ?? []}
          />
        </div>
        <div className="space-y-2">
          <DemoPicker
            label={t("compare.pickDemoB")}
            value={demoB}
            onChange={(v) => {
              setDemoB(v);
              setPB("");
            }}
            options={completed}
            other={demoA}
          />
          <PlayerPicker
            label={t("compare.pickPlayerB")}
            value={pB}
            onChange={setPB}
            options={b.data?.players ?? []}
          />
        </div>
      </div>

      {!playerA || !playerB ? (
        <div className="glass-card rounded-xl p-10 text-center text-sm text-muted-foreground">
          {t("compare.noSelection")}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[420px_1fr] gap-4">
          <div className="glass-card rounded-xl p-4 flex flex-col items-center">
            <PlayerRadar a={playerA} b={playerB} />
            <div className="grid grid-cols-2 gap-3 w-full mt-3">
              <PlayerHead p={playerA} side="a" />
              <PlayerHead p={playerB} side="b" />
            </div>
          </div>
          <div className="glass-card rounded-xl divide-y divide-border-subtle">
            {playerStatRows(playerA, playerB).map((r) => (
              <DiffRow key={r.label} {...r} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PlayerHead({ p, side }: { p: PlayerStats; side: "a" | "b" }) {
  return (
    <div className={cn("text-center", side === "a" ? "text-primary" : "text-accent")}>
      <div className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
        {side === "a" ? "Player A" : "Player B"}
      </div>
      <div className="mt-1 text-sm font-semibold truncate">{p.name}</div>
      <div className="text-[11px] text-muted-foreground">
        {p.team.toUpperCase()} · rating {p.rating.toFixed(2)}
      </div>
    </div>
  );
}

function playerStatRows(a: PlayerStats, b: PlayerStats) {
  return [
    { label: "Kills",         a: a.kills,         b: b.kills,         higher: "good" as const },
    { label: "Deaths",        a: a.deaths,        b: b.deaths,        higher: "bad" as const  },
    { label: "Assists",       a: a.assists,       b: b.assists,       higher: "good" as const },
    { label: "ADR",           a: a.adr,           b: b.adr,           higher: "good" as const },
    { label: "KAST %",        a: a.kast,          b: b.kast,          higher: "good" as const },
    { label: "HS %",          a: a.hsPercent,     b: b.hsPercent,     higher: "good" as const },
    { label: "Rating",        a: a.rating,        b: b.rating,        higher: "good" as const },
    { label: "Opening kills", a: a.openingKills,  b: b.openingKills,  higher: "good" as const },
    { label: "Clutch wins",   a: a.clutchWins,    b: b.clutchWins,    higher: "good" as const },
    { label: "Util damage",   a: a.utilityDamage, b: b.utilityDamage, higher: "good" as const },
    { label: "Flash assists", a: a.flashAssists,  b: b.flashAssists,  higher: "good" as const },
  ];
}

// Radar chart on 4 axes: Aim, Utility, Positioning, Clutch
function PlayerRadar({ a, b }: { a: PlayerStats; b: PlayerStats }) {
  const t = useT();
  const axes: { key: string; label: string; valueA: number; valueB: number; max: number }[] = [
    {
      key: "aim",
      label: t("compare.aim"),
      // Composite: rating + HS% / 100 + ADR / 150
      valueA: a.rating + a.hsPercent / 100 + a.adr / 150,
      valueB: b.rating + b.hsPercent / 100 + b.adr / 150,
      max: 4.5,
    },
    {
      key: "util",
      label: t("compare.util"),
      valueA: a.utilityDamage / 50 + a.flashAssists,
      valueB: b.utilityDamage / 50 + b.flashAssists,
      max: 16,
    },
    {
      key: "pos",
      label: t("compare.pos"),
      valueA: a.kast / 10 + Math.max(0, 30 - a.deaths),
      valueB: b.kast / 10 + Math.max(0, 30 - b.deaths),
      max: 30,
    },
    {
      key: "clutch",
      label: t("compare.clutch"),
      valueA: a.clutchWins * 3 + a.openingKills,
      valueB: b.clutchWins * 3 + b.openingKills,
      max: 30,
    },
  ];

  const SIZE = 340;
  const cx = SIZE / 2;
  const cy = SIZE / 2;
  const radius = SIZE / 2 - 50;

  const polyPoints = (vals: number[]) =>
    vals
      .map((v, i) => {
        const angle = (Math.PI * 2 * i) / vals.length - Math.PI / 2;
        const r = (Math.min(v, axes[i].max) / axes[i].max) * radius;
        return `${cx + Math.cos(angle) * r},${cy + Math.sin(angle) * r}`;
      })
      .join(" ");

  return (
    <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} className="max-w-full">
      {/* Concentric polygons (grid) */}
      {[0.25, 0.5, 0.75, 1].map((scale) => (
        <polygon
          key={scale}
          points={axes
            .map((_, i) => {
              const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
              return `${cx + Math.cos(angle) * radius * scale},${cy + Math.sin(angle) * radius * scale}`;
            })
            .join(" ")}
          fill="none"
          stroke="hsl(var(--border))"
          strokeOpacity={0.3}
          strokeWidth={1}
        />
      ))}

      {/* Axes */}
      {axes.map((ax, i) => {
        const angle = (Math.PI * 2 * i) / axes.length - Math.PI / 2;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        return (
          <g key={ax.key}>
            <line x1={cx} y1={cy} x2={x} y2={y} stroke="hsl(var(--border))" strokeOpacity={0.3} />
            <text
              x={cx + Math.cos(angle) * (radius + 22)}
              y={cy + Math.sin(angle) * (radius + 22)}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize="11"
              fill="hsl(var(--muted-foreground))"
              fontFamily="var(--font-mono-rs, monospace)"
            >
              {ax.label}
            </text>
          </g>
        );
      })}

      {/* Player A polygon */}
      <polygon
        points={polyPoints(axes.map((ax) => ax.valueA))}
        fill="hsl(var(--primary) / 0.18)"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
      />
      {/* Player B polygon */}
      <polygon
        points={polyPoints(axes.map((ax) => ax.valueB))}
        fill="hsl(var(--accent) / 0.18)"
        stroke="hsl(var(--accent))"
        strokeWidth="2"
      />
    </svg>
  );
}

// =========================================================================
// Pickers + utils
// =========================================================================

function ModeButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm transition-colors",
        active
          ? "bg-primary-dim text-primary font-semibold"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

function DemoPicker({
  label,
  value,
  onChange,
  options,
  other,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; filename: string; map: string | null; score: [number, number] | null }[];
  other: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50"
      >
        <option value="">— select —</option>
        {options.map((d) => (
          <option key={d.id} value={d.id} disabled={d.id === other}>
            {d.filename} {d.map ? `• ${d.map}` : ""} {d.score ? `${d.score[0]}–${d.score[1]}` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

function PlayerPicker({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: PlayerStats[];
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-surface-elevated border border-border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-primary/50"
        disabled={options.length === 0}
      >
        <option value="">{options.length === 0 ? "— pick a demo first —" : "— select —"}</option>
        {options.map((p) => (
          <option key={p.steamId} value={p.steamId}>
            {p.name} ({p.team.toUpperCase()}) · {p.kills}-{p.deaths}-{p.assists} · {p.rating.toFixed(2)}
          </option>
        ))}
      </select>
    </div>
  );
}
