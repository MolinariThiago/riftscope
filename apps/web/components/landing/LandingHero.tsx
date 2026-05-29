"use client";

import Link from "next/link";
import { ArrowRight, Upload, Play } from "lucide-react";
import { motion } from "framer-motion";

import { fadeUp, staggerContainer } from "./motion";
import { MatchCard, type Match } from "./MatchCard";

export function LandingHero() {
  return (
    <section className="relative pt-36 pb-20 px-6">
      <div className="max-w-6xl mx-auto">
        {/* Headline block */}
        <motion.div
          className="max-w-3xl mx-auto text-center space-y-6"
          variants={staggerContainer(0.1)}
          initial="hidden"
          animate="show"
        >
          <motion.div variants={fadeUp} className="flex justify-center">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border bg-surface text-xs font-semibold text-muted-foreground font-mono-rs tracking-wider">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              CS2 DEMO ANALYTICS
            </span>
          </motion.div>

          <motion.h1
            variants={fadeUp}
            className="text-4xl sm:text-5xl lg:text-6xl font-display font-bold leading-[1.08]"
          >
            See every angle.
            <br />
            <span className="gradient-text">Win every round.</span>
          </motion.h1>

          <motion.p variants={fadeUp} className="text-lg text-muted-foreground leading-relaxed max-w-xl mx-auto">
            Upload any CS2 demo and replay every round on a 2D tactical map —
            player movement, kills, utility and bomb plants, plus deep stats on
            ratings, economy and clutches.
          </motion.p>

          <motion.div variants={fadeUp} className="flex flex-wrap justify-center gap-3 pt-2">
            <Link
              href="/register"
              className="group inline-flex items-center gap-2.5 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors"
              style={{ fontFamily: "var(--font-display)" }}
            >
              <Upload size={16} />
              Upload your demo
              <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
            </Link>
            <Link
              href="#replay"
              className="inline-flex items-center gap-2 px-6 py-3 border border-border rounded-lg text-sm text-foreground hover:border-primary/50 hover:bg-surface transition-colors"
            >
              <Play size={14} className="text-primary" fill="currentColor" />
              See it in action
            </Link>
          </motion.div>
        </motion.div>

        {/* Match cards */}
        <div className="mt-16">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs font-mono-rs tracking-wider text-muted-foreground uppercase">
              Recent pro matches
            </h2>
            <Link href="/register" className="text-xs text-primary hover:text-primary/80 transition-colors">
              Browse all →
            </Link>
          </div>

          <motion.div
            className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
            variants={staggerContainer(0.1, 0.2)}
            initial="hidden"
            animate="show"
          >
            {sampleMatches.map((m, i) => (
              <motion.div key={i} variants={fadeUp}>
                <MatchCard match={m} />
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const sampleMatches: Match[] = [
  {
    map: "de_mirage",
    event: "ESL Pro League",
    teamA: "Natus Vincere",
    teamB: "FaZe Clan",
    scoreA: 16,
    scoreB: 12,
    topFragger: { name: "s1mple", rating: "1.41", adr: "89" },
  },
  {
    map: "de_inferno",
    event: "BLAST Premier",
    teamA: "Team Spirit",
    teamB: "Team Vitality",
    scoreA: 16,
    scoreB: 13,
    topFragger: { name: "donk", rating: "1.48", adr: "95" },
  },
  {
    map: "de_ancient",
    event: "IEM Katowice",
    teamA: "G2 Esports",
    teamB: "MOUZ",
    scoreA: 16,
    scoreB: 9,
    topFragger: { name: "NiKo", rating: "1.33", adr: "84" },
  },
];
