"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  Cloud,
  Inbox,
  Layers,
  Loader2,
  PlayCircle,
  Sparkles,
  Telescope,
  Trophy,
  Upload,
} from "lucide-react";

import { DemoCard } from "@/components/demo/DemoCard";
import { useDeleteDemo, useDemos } from "@/lib/hooks/useDemos";
import { cn } from "@/lib/utils";
import type { DemoSummary } from "@/types/demo";

type Tab = "private" | "public" | "playlists";
type SortBy = "uploaded" | "map" | "score";

export default function DemosPage() {
  const { data: demos, isLoading, error } = useDemos();
  const del = useDeleteDemo();

  const [tab, setTab] = useState<Tab>("private");
  const [mapFilter, setMapFilter] = useState<string>("");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [teamFilter, setTeamFilter] = useState<string>("");
  const [sortBy, setSortBy] = useState<SortBy>("uploaded");

  const filtered = useMemo(() => {
    let list = demos ?? [];
    if (mapFilter) list = list.filter((d) => d.map === mapFilter);
    if (tab === "public") list = []; // not yet implemented
    if (tab === "playlists") list = []; // not yet implemented
    list = [...list].sort((a, b) => {
      if (sortBy === "map") return (a.map ?? "").localeCompare(b.map ?? "");
      if (sortBy === "score") return (b.score?.[0] ?? 0) - (a.score?.[0] ?? 0);
      return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
    });
    return list;
  }, [demos, mapFilter, sortBy, tab]);

  // Group by date (YYYY-MM-DD)
  const grouped = useMemo(() => {
    const groups = new Map<string, DemoSummary[]>();
    for (const d of filtered) {
      const dateKey = formatDateKey(new Date(d.uploadedAt));
      if (!groups.has(dateKey)) groups.set(dateKey, []);
      groups.get(dateKey)!.push(d);
    }
    return Array.from(groups.entries());
  }, [filtered]);

  const allMaps = useMemo(
    () => Array.from(new Set((demos ?? []).map((d) => d.map).filter((m): m is string => !!m))).sort(),
    [demos],
  );

  return (
    <div className="space-y-5 max-w-[1400px] mx-auto">
      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-border/50">
        <TabButton active={tab === "private"} onClick={() => setTab("private")} icon={Cloud}>
          Private Demos
        </TabButton>
        <TabButton active={tab === "public"} onClick={() => setTab("public")} icon={Trophy}>
          Public Demos
        </TabButton>
        <TabButton active={tab === "playlists"} onClick={() => setTab("playlists")} icon={Layers}>
          Playlists
        </TabButton>
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <FilterSelect
          value={mapFilter}
          onChange={setMapFilter}
          placeholder="All Maps"
          options={[{ value: "", label: "All Maps" }, ...allMaps.map((m) => ({ value: m, label: capitalizeMap(m) }))]}
        />
        <FilterSelect
          value={teamFilter}
          onChange={setTeamFilter}
          placeholder="All Teams"
          options={[{ value: "", label: "All Teams" }]}
        />
        <FilterSelect
          value={tagFilter}
          onChange={setTagFilter}
          placeholder="All Tags"
          options={[{ value: "", label: "All Tags" }]}
        />

        <div className="ml-auto flex items-center gap-3">
          <FilterSelect
            value={sortBy}
            onChange={(v) => setSortBy(v as SortBy)}
            placeholder="Sort"
            options={[
              { value: "uploaded", label: "Sort by uploaded at" },
              { value: "map", label: "Sort by map" },
              { value: "score", label: "Sort by score" },
            ]}
          />
          <Link
            href="/demos/upload"
            className="p-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors shadow-lg"
            title="Upload demo"
          >
            <Upload size={16} />
          </Link>
        </div>
      </div>

      {/* First-time welcome — shown only on Private tab when nothing is uploaded yet */}
      {!isLoading && !error && tab === "private" && (demos?.length ?? 0) === 0 && (
        <FirstTimeWelcome />
      )}

      {/* Body */}
      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="h-20 shimmer-loading rounded-xl" />
          ))}
        </div>
      ) : error ? (
        <ErrorState />
      ) : filtered.length === 0 && (demos?.length ?? 0) > 0 ? (
        <EmptyState tab={tab} />
      ) : filtered.length === 0 && tab !== "private" ? (
        <EmptyState tab={tab} />
      ) : (
        <div className="space-y-6">
          {grouped.map(([day, list]) => (
            <section key={day}>
              <h2 className="flex items-center gap-2 mb-3 text-sm font-semibold text-foreground">
                <span className="text-primary">/</span>
                {prettifyDate(day)}
              </h2>
              <div className="space-y-2">
                {list.map((d) => (
                  <DemoCard
                    key={d.id}
                    demo={d}
                    onDelete={() => del.mutate(d.id)}
                    deleting={del.isPending}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

// =========================================================================

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "relative inline-flex items-center gap-2 py-3 text-sm transition-colors",
        active ? "text-foreground font-semibold" : "text-muted-foreground hover:text-foreground",
      )}
    >
      <Icon size={14} className={active ? "text-primary" : "opacity-70"} />
      {children}
      {active && (
        <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full" />
      )}
    </button>
  );
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-surface-elevated border border-border rounded-lg pl-3 pr-9 py-2 text-sm text-foreground focus:outline-none focus:border-primary/50 transition-colors min-w-[160px]"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label || placeholder}
          </option>
        ))}
      </select>
      <ChevronDown
        size={13}
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground"
      />
    </div>
  );
}

function FirstTimeWelcome() {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary-dim/30 via-surface to-accent/5 p-8 shadow-xl">
      {/* Decorative glow */}
      <div className="absolute -top-10 -right-10 w-60 h-60 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-10 -left-10 w-60 h-60 rounded-full bg-accent/8 blur-3xl pointer-events-none" />

      <div className="relative flex flex-col md:flex-row items-start md:items-center gap-6">
        <div className="flex-shrink-0 w-16 h-16 rounded-2xl bg-primary/20 border border-primary/40 flex items-center justify-center shadow-lg shadow-primary/20">
          <Telescope size={28} className="text-primary" />
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 text-[11px] font-mono-rs uppercase tracking-widest text-primary">
            <Sparkles size={11} />
            Bienvenido / Welcome
          </div>
          <h2 className="text-2xl font-display font-bold leading-tight">
            Subí tu primer demo para empezar el análisis 2D
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl leading-relaxed">
            Soltá un archivo <span className="font-mono-rs text-foreground">.dem</span> de CS2
            (Faceit, MM, profesional). Lo procesamos con{" "}
            <span className="font-mono-rs text-foreground">demoparser2</span> y vas a poder
            scrubbear todos los rounds en el visor 2D con loadouts, kills y utilidades reales.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row md:flex-col gap-2 flex-shrink-0">
          <Link
            href="/demos/upload"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-all shadow-lg shadow-primary/30"
          >
            <Upload size={14} />
            Subir demo
          </Link>
          <Link
            href="/pro"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg border border-border bg-surface text-foreground font-semibold text-sm hover:border-primary/40 hover:text-primary transition-all"
          >
            <PlayCircle size={14} />
            Ver pro matches
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="glass-card rounded-xl p-12 text-center space-y-2">
      <AlertCircle className="mx-auto text-loss" size={28} />
      <p className="text-sm text-muted-foreground">
        Couldn't reach the API. Make sure the backend is running on{" "}
        <span className="text-foreground font-mono-rs">:8000</span>.
      </p>
    </div>
  );
}

function EmptyState({ tab }: { tab: Tab }) {
  return (
    <div className="glass-card rounded-xl p-16 text-center space-y-3">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-surface-elevated flex items-center justify-center">
        <Inbox size={20} className="text-muted-foreground" />
      </div>
      <div>
        <p className="text-foreground font-semibold">
          {tab === "private" ? "No demos yet" : tab === "public" ? "Public demos coming soon" : "Playlists coming soon"}
        </p>
        <p className="text-sm text-muted-foreground">
          {tab === "private"
            ? "Drop a .dem file to start your first analysis."
            : "Browse and play demos shared by the community."}
        </p>
      </div>
      {tab === "private" && (
        <Link
          href="/demos/upload"
          className="inline-flex items-center gap-2 px-4 py-2 mt-3 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-all"
        >
          <Upload size={14} />
          Upload demo
        </Link>
      )}
    </div>
  );
}

function formatDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function prettifyDate(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function capitalizeMap(name: string): string {
  return name.replace(/^de_/, "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
