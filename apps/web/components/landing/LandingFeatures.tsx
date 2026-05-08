"use client";

import {
  Map,
  BarChart3,
  Clock,
  DollarSign,
  Target,
  Users,
  Shield,
  Flame,
  ScanSearch,
  Award,
} from "lucide-react";

const features = [
  {
    icon: Map,
    title: "Interactive Heatmaps",
    desc: "Visualize kill locations, smokes, flashes, and movement paths directly on the map.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: Clock,
    title: "Round Timeline",
    desc: "Playback every round with per-second accuracy. See kills, bomb plants, and utility at a glance.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: BarChart3,
    title: "Advanced Player Stats",
    desc: "ADR, KAST, HS%, Rating 2.0, opening duels, multi-kills, and clutch performance per player.",
    color: "text-win",
    bg: "bg-win/10",
  },
  {
    icon: DollarSign,
    title: "Economy Analysis",
    desc: "Track team economy per round: full buy, eco, force buy, and money management efficiency.",
    color: "text-tt",
    bg: "bg-tt-dim",
  },
  {
    icon: Target,
    title: "Entry Kills & Openings",
    desc: "Identify your best entry fraggers and track first-blood impact on round outcomes.",
    color: "text-kill",
    bg: "bg-kill/10",
  },
  {
    icon: Shield,
    title: "Clutch Performance",
    desc: "All 1vX situations tracked: success rate, conditions, and high-impact clutch moments.",
    color: "text-ct",
    bg: "bg-ct-dim",
  },
  {
    icon: Flame,
    title: "Utility Analysis",
    desc: "Smoke effectiveness, flash assists, HE damage dealt, and Molotov zone control.",
    color: "text-primary",
    bg: "bg-primary-dim",
  },
  {
    icon: ScanSearch,
    title: "Player Search & Compare",
    desc: "Find any player across all your demos. Compare two players side-by-side across multiple matches.",
    color: "text-accent",
    bg: "bg-accent/10",
  },
  {
    icon: Award,
    title: "Match Rating",
    desc: "Overall team and individual performance ratings with context-aware impact scoring.",
    color: "text-win",
    bg: "bg-win/10",
  },
];

export function LandingFeatures() {
  return (
    <section id="features" className="py-24 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Section header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-border text-xs font-semibold text-muted-foreground font-mono-rs tracking-wider mb-4">
            FEATURE SET
          </div>
          <h2 className="text-4xl lg:text-5xl font-display font-bold mb-4">
            Every stat that{" "}
            <span className="gradient-text">matters.</span>
          </h2>
          <p className="text-muted-foreground text-lg">
            From raw kills to strategic patterns — RIFTSCOPE extracts the
            intelligence you need to improve.
          </p>
        </div>

        {/* Features grid */}
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {features.map((feature, i) => (
            <FeatureCard key={i} {...feature} index={i} />
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  desc,
  color,
  bg,
  index,
}: {
  icon: React.ElementType;
  title: string;
  desc: string;
  color: string;
  bg: string;
  index: number;
}) {
  return (
    <div className="group glass-card p-5 hover:border-primary/30 transition-all duration-300 hover:-translate-y-0.5">
      <div className={`w-10 h-10 rounded-lg ${bg} flex items-center justify-center mb-4`}>
        <Icon size={18} className={color} />
      </div>
      <h3 className="font-display font-bold text-base mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}
