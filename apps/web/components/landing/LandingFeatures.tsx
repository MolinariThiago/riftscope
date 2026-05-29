"use client";

import {
  Map,
  BarChart3,
  Clock,
  DollarSign,
  Target,
  Shield,
  Flame,
  ScanSearch,
  Award,
  type LucideIcon,
} from "lucide-react";
import { motion } from "framer-motion";

import { fadeUp, staggerContainer, inViewport } from "./motion";

type Feature = {
  icon: LucideIcon;
  title: string;
  desc: string;
  color: string;
  bg: string;
};

const features: Feature[] = [
  {
    icon: Map,
    title: "Interactive Heatmaps",
    desc: "Kill locations, smokes, flashes and movement paths plotted directly on the map.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: Clock,
    title: "Round Timeline",
    desc: "Playback every round with per-second accuracy — kills, plants and utility at a glance.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: BarChart3,
    title: "Advanced Player Stats",
    desc: "ADR, KAST, HS%, Rating 2.0, opening duels, multi-kills and clutch performance.",
    color: "text-win",
    bg: "bg-win/10",
  },
  {
    icon: DollarSign,
    title: "Economy Analysis",
    desc: "Track team economy per round: full buy, eco, force buy and money management.",
    color: "text-tt",
    bg: "bg-tt-dim",
  },
  {
    icon: Target,
    title: "Entry Kills & Openings",
    desc: "Identify your best entry fraggers and first-blood impact on round outcomes.",
    color: "text-kill",
    bg: "bg-kill/10",
  },
  {
    icon: Shield,
    title: "Clutch Performance",
    desc: "All 1vX situations tracked: success rate, conditions and high-impact moments.",
    color: "text-ct",
    bg: "bg-ct-dim",
  },
  {
    icon: Flame,
    title: "Utility Analysis",
    desc: "Smoke effectiveness, flash assists, HE damage dealt and Molotov zone control.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: ScanSearch,
    title: "Player Search & Compare",
    desc: "Find any player across your demos and compare two players side-by-side.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: Award,
    title: "Match Rating",
    desc: "Team and individual performance ratings with context-aware impact scoring.",
    color: "text-win",
    bg: "bg-win/10",
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="py-24 px-6 border-t border-border/50">
      <div className="max-w-6xl mx-auto">
        <div className="max-w-2xl mb-12">
          <div className="text-xs font-mono-rs tracking-wider text-muted-foreground uppercase mb-3">
            Feature set
          </div>
          <h2 className="text-3xl lg:text-4xl font-display font-bold mb-3">
            Every stat that <span className="gradient-text">matters.</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            From raw kills to strategic patterns — RIFTSCOPE extracts the
            intelligence you need to improve.
          </p>
        </div>

        <motion.div
          className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4"
          variants={staggerContainer(0.06)}
          initial="hidden"
          whileInView="show"
          viewport={inViewport}
        >
          {features.map((feature, i) => (
            <motion.div
              key={i}
              variants={fadeUp}
              className="group glass-card p-5 hover:border-primary/30 hover:-translate-y-0.5 transition-all duration-200"
            >
              <div className={`w-10 h-10 rounded-lg ${feature.bg} flex items-center justify-center mb-4`}>
                <feature.icon size={18} className={feature.color} />
              </div>
              <h3 className="font-display font-bold text-base mb-2">{feature.title}</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
