"use client";

// Cinematic hero — tactical radar + glow + live trust counters.
//
// Structure:
//   ┌────────────────────────────────────────────────┐
//   │  ┌── ambient bg ──────────────────────────────┐│
//   │  │  drifting orbs · scanline · grid          ││
//   │  └────────────────────────────────────────────┘│
//   │                                                 │
//   │            R00 · START HERE                     │
//   │       See every angle.                          │
//   │       Win every round.                          │
//   │       [ Sign in with Steam ]  [ Watch demo ]   │
//   │                                                 │
//   │    DEMOS · MATCHES · PLAYERS · ROUNDS          │
//   │                                                 │
//   │              ╭─── animated radar ───╮          │
//   │              │ player dots + sweep  │          │
//   │              ╰──────────────────────╯          │
//   └────────────────────────────────────────────────┘

import Link from "next/link";
import { ArrowRight, Play, Shield } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { fadeUp, staggerContainer } from "./motion";
import { TacticalRadar } from "./TacticalRadar";

export function LandingHero() {
  const user = useAuthStore((s) => s.user);

  // Trust counters — anonymous endpoint, cheap. Fail silently into
  // placeholder text so the hero still renders if the API hiccups.
  const { data: stats } = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => api.stats.publicStats(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return (
    <section className="relative pt-32 pb-16 px-6 overflow-hidden">
      {/* ====== Ambient background layer ====== */}
      <AmbientBackground />

      <div className="relative max-w-6xl mx-auto">
        {/* ====== Headline block ====== */}
        <motion.div
          className="max-w-3xl mx-auto text-center space-y-7"
          variants={staggerContainer(0.08)}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={fadeUp} className="flex justify-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary/5 text-[11px] font-semibold text-primary font-mono-rs tracking-wider">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/70" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              R00 · START HERE
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-5xl sm:text-6xl lg:text-7xl font-display font-bold leading-[1.04] tracking-tight"
          >
            See every angle.
            <br />
            <span className="gradient-text drop-shadow-[0_0_30px_hsl(var(--primary)/0.35)]">
              Win every round.
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto"
          >
            Watch any pro CS2 match on a 2D tactical map. Every kill, every
            grenade, every rotation — replayable in one click, with the
            stats and rankings that make every round legible.
          </motion.p>

          <motion.div
            variants={fadeUp}
            className="flex flex-wrap justify-center gap-3 pt-2"
          >
            <Link
              href={user ? "/pro" : "/login"}
              className="group relative inline-flex items-center gap-2.5 px-6 py-3 rounded-lg font-semibold text-sm text-primary-foreground transition-all"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {/* Glow halo */}
              <span className="absolute inset-0 rounded-lg bg-primary shadow-[0_0_40px_-5px_hsl(var(--primary)/0.7)] group-hover:shadow-[0_0_55px_-5px_hsl(var(--primary)/0.9)] transition-shadow" />
              <span className="relative inline-flex items-center gap-2.5">
                <Shield size={16} />
                {user ? "Open dashboard" : "Sign in with Steam"}
                <ArrowRight
                  size={14}
                  className="group-hover:translate-x-1 transition-transform"
                />
              </span>
            </Link>
            <Link
              href="#replay"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-lg text-sm text-foreground border border-border bg-surface/40 backdrop-blur-sm hover:border-primary/40 hover:bg-surface transition-colors"
            >
              <Play size={14} className="text-primary" fill="currentColor" />
              See it in action
            </Link>
          </motion.div>

          {/* ====== Trust counter strip ====== */}
          <motion.div
            variants={fadeUp}
            className="pt-6 grid grid-cols-2 sm:grid-cols-4 gap-px max-w-2xl mx-auto rounded-xl overflow-hidden border border-border/60 bg-border/40"
          >
            <Stat
              label="Pro matches"
              value={stats?.proMatches}
              fallback="100+"
            />
            <Stat
              label="Demos analysed"
              value={stats?.demosAnalysed}
              fallback="200+"
            />
            <Stat
              label="Players ranked"
              value={stats?.playersRanked}
              fallback="2 000+"
            />
            <Stat
              label="Rounds analysed"
              value={stats?.roundsAnalysed}
              fallback="50 000+"
            />
          </motion.div>
        </motion.div>

        {/* ====== Animated radar showcase ====== */}
        <motion.div
          className="mt-20 relative"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.4 }}
        >
          <div className="relative max-w-3xl mx-auto">
            {/* Soft glow under the radar */}
            <div className="absolute inset-x-10 -bottom-10 h-32 bg-primary/20 blur-3xl rounded-full" />

            <div className="relative rounded-2xl border border-border bg-surface/70 backdrop-blur-md overflow-hidden">
              {/* Top mini-bar — looks like the viewer chrome */}
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-loss/70" />
                    <span className="h-2 w-2 rounded-full bg-amber-500/70" />
                    <span className="h-2 w-2 rounded-full bg-primary/70" />
                  </div>
                  <span>RIFTSCOPE · 2D VIEWER · LIVE</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline">DE_MIRAGE</span>
                  <span className="hidden sm:inline">ROUND 14</span>
                  <span className="text-primary">REC</span>
                </div>
              </div>

              <TacticalRadar />
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}

// ===========================================================================
// Stat — one cell of the trust counter strip
// ===========================================================================
function Stat({
  label,
  value,
  fallback,
}: {
  label: string;
  value: number | undefined;
  fallback: string;
}) {
  const display =
    value !== undefined ? formatCount(value) : <span className="opacity-60">{fallback}</span>;
  return (
    <div className="bg-surface/80 backdrop-blur-sm px-4 py-3 text-center">
      <div className="text-2xl font-display font-bold text-foreground animate-count-in tabular-nums">
        {display}
      </div>
      <div className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground mt-0.5">
        {label}
      </div>
    </div>
  );
}

// Compact number formatter: 1 245 → "1.2 k", 53 200 → "53 k", 1 200 000 → "1.2 M"
function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)} k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return n.toString();
}

// ===========================================================================
// AmbientBackground — drifting orbs, scanlines, dotted grid.
// Pure decoration, no semantics, sits behind everything in the hero.
// ===========================================================================
function AmbientBackground() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Dense tactical grid */}
      <div className="absolute inset-0 opacity-50">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--primary) / 0.04) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.04) 1px, transparent 1px)",
            backgroundSize: "32px 32px",
          }}
        />
      </div>

      {/* Two large drifting glow orbs */}
      <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-primary/15 blur-[120px] animate-orb-drift" />
      <div
        className="absolute -bottom-40 -right-32 w-[520px] h-[520px] rounded-full bg-accent/15 blur-[140px] animate-orb-drift"
        style={{ animationDelay: "-7s" }}
      />

      {/* Scanline texture overlay — VERY subtle */}
      <div className="absolute inset-0 bg-scanlines opacity-30" />

      {/* Radial vignette at the edges so the focus stays mid */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 40%, hsl(var(--background) / 0.85) 100%)",
        }}
      />
    </div>
  );
}
