"use client";

// Tactical landing modules — R02 / R04 / R05 / R06 / R09.
// Copy is strictly user-facing: what each module does for you,
// how to use it, why it's useful. No mentions of admin buttons,
// no infrastructure, no formulas.

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Crosshair,
  Filter,
  Layers,
  Library,
  ListChecks,
  Map,
  PenTool,
  Sparkles,
  Star,
  Target,
  Timer,
  Trophy,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";

import { fadeUp, staggerContainer, inViewport } from "./motion";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Shared shell — every R-section starts with a label + title + lede.
// ---------------------------------------------------------------------------
function SectionShell({
  tag,
  title,
  lede,
  children,
}: {
  tag: string;
  title: React.ReactNode;
  lede: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-24 px-6 border-t border-border/50">
      <motion.div
        className="max-w-6xl mx-auto"
        variants={staggerContainer(0.08)}
        initial="hidden"
        whileInView="show"
        viewport={inViewport}
      >
        <motion.div variants={fadeUp} className="max-w-2xl mb-12">
          <span className="inline-flex items-center gap-2 mb-3 text-[11px] font-mono-rs uppercase tracking-wider text-primary">
            <span className="h-1 w-6 bg-primary" />
            {tag}
          </span>
          <h2 className="text-3xl lg:text-4xl font-display font-bold mb-3">
            {title}
          </h2>
          <p className="text-muted-foreground text-lg leading-relaxed">{lede}</p>
        </motion.div>
        {children}
      </motion.div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Module card — used in R04/R05/R06 grids.
// ---------------------------------------------------------------------------
function ModuleCard({
  icon: Icon,
  title,
  desc,
  tone = "primary",
}: {
  icon: LucideIcon;
  title: string;
  desc: string;
  tone?: "primary" | "accent" | "win" | "ct" | "tt";
}) {
  const toneClass: Record<string, string> = {
    primary: "text-primary bg-primary-dim",
    accent: "text-accent bg-accent/10",
    win: "text-win bg-win/10",
    ct: "text-ct bg-ct-dim",
    tt: "text-tt bg-tt-dim",
  };
  return (
    <motion.div
      variants={fadeUp}
      className="glass-card card-glow rounded-xl p-5"
    >
      <div className={cn("inline-flex p-2 rounded-lg mb-3", toneClass[tone])}>
        <Icon size={16} />
      </div>
      <h3 className="font-display font-semibold text-base mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
    </motion.div>
  );
}

// ===========================================================================
// R02 — WHAT'S NEW
// Recent additions, framed by USER BENEFIT, not implementation.
// ===========================================================================
export function LandingWhatsNew() {
  const items = [
    {
      badge: "NEW",
      title: "Leaderboards (beta)",
      desc: "See the top pros ranked across every match on the site. Filter by map, time window and minimum rounds to find the form players on Inferno this month — not just all-time legends.",
    },
    {
      badge: "NEW",
      title: "Bo3 / Bo5 series, every map",
      desc: "Pro series cards expand to show every map played. No more scrolling past the second game of a final — every map of the series has its own Ver-en-2D button right there.",
    },
    {
      badge: "UPDATE",
      title: "Sharper player stats",
      desc: "Damage, KAST, assists and utility are now measured directly from the demo, not estimated. Numbers you see on a card match what HLTV would report for the same match.",
    },
    {
      badge: "NEW",
      title: "Filter by map, team or event",
      desc: "The pro feed now has dropdown filters so you can narrow to \"every G2 match on Mirage this month\" or \"every Major final\" without scrolling.",
    },
  ];
  return (
    <SectionShell
      tag="R02 · WHAT'S NEW"
      title={
        <>
          Recent <span className="gradient-text">additions.</span>
        </>
      }
      lede="The freshest modules and improvements — straight to what changed for you."
    >
      <div className="space-y-3">
        {items.map((it) => (
          <motion.div
            key={it.title}
            variants={fadeUp}
            className="glass-card rounded-lg p-4 flex items-start gap-4"
          >
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono-rs uppercase tracking-wider flex-shrink-0 mt-0.5",
                it.badge === "NEW"
                  ? "bg-primary/15 text-primary border border-primary/30"
                  : "bg-surface-elevated text-muted-foreground border border-border",
              )}
            >
              {it.badge}
            </span>
            <div>
              <h3 className="font-display font-semibold text-base mb-1">
                {it.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {it.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R04 — PRO MATCHES
// ===========================================================================
export function LandingProMatches() {
  return (
    <SectionShell
      tag="R04 · PRO MATCHES"
      title={
        <>
          Every pro match, <span className="gradient-text">ready to watch.</span>
        </>
      }
      lede="A curated feed of pro CS2 matches you can open in 2D in one click. No demo hunting, no torrents — open the page, pick a match, watch."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          icon={Trophy}
          tone="primary"
          title="Always fresh"
          desc="The feed stays up to date with recent pro matches as they finish — finals, regular season, qualifiers."
        />
        <ModuleCard
          icon={Star}
          tone="accent"
          title="Majors first"
          desc="Sorted by importance. Majors and tier-1 finals always land before regional cups so the matches you care about are on top."
        />
        <ModuleCard
          icon={Layers}
          tone="win"
          title="Bo3 / Bo5 expanded"
          desc="Series cards show every map of the series with its own status chip and Ver-en-2D button. No need to chase individual games."
        />
        <ModuleCard
          icon={Filter}
          tone="primary"
          title="Filters that matter"
          desc="Narrow the feed by map (the active CS2 pool), team or tournament. Stack filters to find exactly the matchup you want."
        />
        <ModuleCard
          icon={Timer}
          tone="ct"
          title="See it as it lands"
          desc="A match imported and parsed shows up with a Lista-para-2D chip. Hit it and you're inside the replay viewer instantly."
        />
        <ModuleCard
          icon={Zap}
          tone="tt"
          title="Built for browsing"
          desc="Counters at the top tell you at a glance how many matches are watchable right now, how many are queued, and how many total are in the library."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R05 — LEADERBOARDS
// ===========================================================================
export function LandingLeaderboards() {
  return (
    <SectionShell
      tag="R05 · LEADERBOARDS"
      title={
        <>
          Top players, <span className="gradient-text">ranked honestly.</span>
        </>
      }
      lede="One ranking across every pro match on the site. The same metric the community recognises — rating, ADR, K/D, KAST — computed from real in-game data."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ModuleCard
          icon={BarChart3}
          tone="primary"
          title="The metric you know"
          desc="Industry-standard HLTV-style rating. Reproducible, comparable to what you see on every other CS2 stats site."
        />
        <ModuleCard
          icon={Map}
          tone="accent"
          title="Per-map ranking"
          desc="Pill bar with every active CS2 pool map. Find the best Mirage player, the best Anubis Awper, the cleanest Inferno entry."
        />
        <ModuleCard
          icon={Timer}
          tone="ct"
          title="Form vs all-time"
          desc="30d / 90d / 12m / All-time windows. Toggle between current form and historic legends without leaving the page."
        />
        <ModuleCard
          icon={Sparkles}
          tone="win"
          title="Honest sample size"
          desc="Minimum-rounds slider keeps small-sample one-game wonders out of the top. A player has to actually play to rank."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R06 — TACTICAL BOARD + PLAYBOOK
// ===========================================================================
export function LandingTactical() {
  return (
    <SectionShell
      tag="R06 · TACTICAL BOARD"
      title={
        <>
          Draw it, <span className="gradient-text">save it, run it.</span>
        </>
      }
      lede="A top-down board with the real CS2 maps. Plot smokes and flashes, draw rotations, set up an execute — then save it to your playbook so your team can run it next scrim."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          icon={PenTool}
          tone="primary"
          title="Real maps, top-down"
          desc="Pick a map, drop the five players for each side. Snap-to-grid and per-side colors so the diagram reads at a glance."
        />
        <ModuleCard
          icon={Target}
          tone="tt"
          title="Real utility radius"
          desc="Smoke, flash and molotov markers render with the actual area they cover on that map. Trust what you draw."
        />
        <ModuleCard
          icon={ListChecks}
          tone="win"
          title="Step by step"
          desc="A tactic is a sequence: setup → smokes → entry. Add frames to capture each moment without redrawing the previous one."
        />
        <ModuleCard
          icon={Library}
          tone="accent"
          title="Saved to your playbook"
          desc="Drop a finished tactic into a folder, add tags (map, side, anti-eco, A execute). Search across them later by name or tag."
        />
        <ModuleCard
          icon={Crosshair}
          tone="ct"
          title="Pulled from real rounds"
          desc="Find a round in the viewer worth remembering? Snapshot it directly into a tactic — positions and utility are pre-filled from that exact moment."
        />
        <ModuleCard
          icon={Trophy}
          tone="primary"
          title="Built for teams"
          desc="A shared playbook for your team means everyone references the same diagrams in practice. No more 'the spot you did last week, you know'."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R09 — FAQ
// ===========================================================================
const FAQ: { q: string; a: string }[] = [
  {
    q: "What demos can I upload?",
    a: "Any standard CS2 demo (.dem file) — matchmaking, FACEIT, ESEA, or a pro demo you grabbed yourself. Series archives that bundle multiple maps work too: every map inside becomes its own analysed game.",
  },
  {
    q: "How long until my demo is ready?",
    a: "Usually 2 to 10 minutes per game, depending on its length. A typical Bo3 series finishes in about 15 to 25 minutes. You'll see live progress in your demo list while it processes.",
  },
  {
    q: "Is it free?",
    a: "Yes, RIFTSCOPE is free during beta. Pro matches are analysed and watchable at no cost. Paid tiers will arrive later when the library is fully built out.",
  },
  {
    q: "Where do the pro matches come from?",
    a: "From real tournament demos — Majors, regional finals, league play, online cups. New matches are added automatically as events finish so the library stays current with the scene.",
  },
  {
    q: "What does the rating actually mean?",
    a: "It's the community-standard CS2 player rating you already know from sites like HLTV. Higher is better; around 1.00 is average and anything over 1.10 is strong. Calculated from real in-game performance, not estimates.",
  },
  {
    q: "Are my private demos visible to other people?",
    a: "No. A demo you upload is yours alone — only your account can see it. Pro matches are public because they're already public events.",
  },
  {
    q: "Can I share a specific round or clutch with a friend?",
    a: "Per-round share links are on the way. The viewer already knows how to jump to a specific round; we're packaging that as a copy-paste URL with social-card previews so a Discord drop shows the moment, not just a link.",
  },
];

export function LandingFAQ() {
  return (
    <SectionShell
      tag="R09 · FAQ"
      title={
        <>
          Common <span className="gradient-text">questions.</span>
        </>
      }
      lede="Quick, plain answers. If something's missing, find us on Discord."
    >
      <div className="space-y-2">
        {FAQ.map((item, i) => (
          <FAQItem key={item.q} q={item.q} a={item.a} defaultOpen={i === 0} />
        ))}
      </div>
      <motion.p
        variants={fadeUp}
        className="mt-10 text-sm text-muted-foreground"
      >
        Looking for the full how-to?{" "}
        <Link href="/docs" className="text-primary hover:underline inline-flex items-center gap-1">
          Read the docs
          <ArrowRight size={12} />
        </Link>
      </motion.p>
    </SectionShell>
  );
}

function FAQItem({
  q,
  a,
  defaultOpen,
}: {
  q: string;
  a: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState<boolean>(!!defaultOpen);
  return (
    <motion.div variants={fadeUp} className="glass-card rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 px-4 py-3.5 text-left hover:bg-surface-elevated/40 transition-colors"
      >
        <span className="font-semibold text-sm">{q}</span>
        <ChevronDown
          size={14}
          className={cn(
            "text-muted-foreground flex-shrink-0 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && (
        <div className="px-4 pb-4 text-sm text-muted-foreground leading-relaxed border-t border-border/40 pt-3">
          {a}
        </div>
      )}
    </motion.div>
  );
}
