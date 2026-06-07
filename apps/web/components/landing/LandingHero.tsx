"use client";

// Premium hero — burgundy identity, coach-targeted copy.
// "Análisis táctico, redefinido." as the brand tagline.

import Link from "next/link";
import { ArrowRight, Shield, Eye } from "lucide-react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { fadeUp, staggerContainer } from "./motion";
import { TacticalRadar } from "./TacticalRadar";

export function LandingHero() {
  const user = useAuthStore((s) => s.user);

  const { data: stats } = useQuery({
    queryKey: ["public-stats"],
    queryFn: () => api.stats.publicStats(),
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return (
    <section className="relative pt-36 pb-20 px-6 overflow-hidden">
      <AmbientBackground />

      <div className="relative max-w-6xl mx-auto">
        <motion.div
          className="max-w-3xl mx-auto text-center space-y-8"
          variants={staggerContainer(0.1)}
          initial="hidden"
          animate="show"
        >
          {/* Tagline badge */}
          <motion.div variants={fadeUp} className="flex justify-center">
            <span className="inline-flex items-center gap-2.5 px-4 py-2 rounded-full border border-primary/20 bg-primary/5 text-[11px] font-semibold text-primary font-mono-rs tracking-widest uppercase">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary/60" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-primary" />
              </span>
              Plataforma de inteligencia para CS2
            </span>
          </motion.div>

          {/* Main headline */}
          <motion.h1
            variants={fadeUp}
            className="text-5xl sm:text-6xl lg:text-7xl font-display font-bold leading-[1.04] tracking-tight"
          >
            Análisis táctico,
            <br />
            <span className="gradient-text drop-shadow-[0_0_40px_hsl(var(--primary)/0.25)]">
              redefinido.
            </span>
          </motion.h1>

          <motion.p
            variants={fadeUp}
            className="text-lg sm:text-xl text-muted-foreground leading-relaxed max-w-2xl mx-auto"
          >
            La plataforma todo-en-uno para coaches y analistas de CS2.
            Estudiá rivales, armá tácticas y rankeá jugadores &mdash;
            todo desde un solo lugar.
          </motion.p>

          {/* CTA buttons */}
          <motion.div
            variants={fadeUp}
            className="flex flex-wrap justify-center gap-4 pt-2"
          >
            <Link
              href={user ? "/pro" : "/login"}
              className="group relative inline-flex items-center gap-2.5 px-7 py-3.5 rounded-lg font-semibold text-sm text-primary-foreground transition-all"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <span className="absolute inset-0 rounded-lg bg-primary shadow-[0_0_50px_-8px_hsl(var(--primary)/0.6)] group-hover:shadow-[0_0_60px_-5px_hsl(var(--primary)/0.8)] transition-shadow" />
              <span className="relative inline-flex items-center gap-2.5">
                <Shield size={16} />
                {user ? "Ir al dashboard" : "Ingresar con Steam"}
                <ArrowRight
                  size={14}
                  className="group-hover:translate-x-1 transition-transform"
                />
              </span>
            </Link>
            <Link
              href="#replay"
              className="inline-flex items-center gap-2.5 px-7 py-3.5 rounded-lg text-sm font-medium text-foreground border border-border bg-surface/40 backdrop-blur-sm hover:border-primary/30 hover:bg-surface transition-all"
            >
              <Eye size={15} className="text-primary" />
              Ver en acción
            </Link>
          </motion.div>

          {/* Trust counter strip */}
          <motion.div
            variants={fadeUp}
            className="pt-8 grid grid-cols-2 sm:grid-cols-4 gap-px max-w-2xl mx-auto rounded-xl overflow-hidden border border-border/40 bg-border/20"
          >
            <Stat label="Partidos pro" value={stats?.proMatches} fallback="100+" />
            <Stat label="Demos analizadas" value={stats?.demosAnalysed} fallback="200+" />
            <Stat label="Jugadores rankeados" value={stats?.playersRanked} fallback="2 000+" />
            <Stat label="Rondas analizadas" value={stats?.roundsAnalysed} fallback="50 000+" />
          </motion.div>
        </motion.div>

        {/* Animated radar showcase */}
        <motion.div
          className="mt-24 relative"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.5 }}
        >
          <div className="relative max-w-3xl mx-auto">
            <div className="absolute inset-x-10 -bottom-12 h-36 bg-primary/15 blur-[60px] rounded-full" />

            <div className="relative rounded-2xl border border-border bg-surface/60 backdrop-blur-md overflow-hidden shadow-2xl shadow-primary/5">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground">
                <div className="flex items-center gap-3">
                  <div className="flex gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary/70" />
                    <span className="h-2 w-2 rounded-full bg-accent/70" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40" />
                  </div>
                  <span>RIFTSCOPE · VISOR 2D · EN VIVO</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="hidden sm:inline">DE_MIRAGE</span>
                  <span className="hidden sm:inline">RONDA 14</span>
                  <span className="text-primary font-semibold">REC</span>
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
// Stat cell
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
    <div className="bg-surface/60 backdrop-blur-sm px-4 py-3.5 text-center">
      <div className="text-2xl font-display font-bold text-foreground animate-count-in tabular-nums">
        {display}
      </div>
      <div className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground mt-1">
        {label}
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} M`;
  if (n >= 10_000) return `${Math.round(n / 1_000)} k`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)} k`;
  return n.toString();
}

// ===========================================================================
// Ambient background — premium burgundy glow
// ===========================================================================
function AmbientBackground() {
  return (
    <div className="absolute inset-0 -z-10 overflow-hidden pointer-events-none">
      {/* Subtle grid */}
      <div className="absolute inset-0 opacity-30">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(hsl(var(--primary) / 0.03) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--primary) / 0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Burgundy glow orbs */}
      <div className="absolute -top-40 left-1/4 w-[600px] h-[600px] rounded-full bg-primary/8 blur-[150px] animate-orb-drift" />
      <div
        className="absolute -bottom-40 right-1/4 w-[500px] h-[500px] rounded-full bg-accent/6 blur-[140px] animate-orb-drift"
        style={{ animationDelay: "-7s" }}
      />

      {/* Radial vignette */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at center, transparent 35%, hsl(var(--background) / 0.9) 100%)",
        }}
      />
    </div>
  );
}
