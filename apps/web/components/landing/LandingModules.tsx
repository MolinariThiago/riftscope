"use client";

// Tactical landing modules — R02 / R04 / R05 / R06 / R09.
// Each section is a numbered "rXX" tag (cs2.cam-inspired) with a
// noun-phrase title and 3-6 module cards or list items underneath.
// Copy explains WHAT each thing is for and HOW to use it — no code,
// no implementation talk.

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  ClipboardList,
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
      className="glass-card rounded-xl p-5 hover:border-primary/30 transition-colors"
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
// Recent additions, listed with a tiny chip badge per entry.
// ===========================================================================
export function LandingWhatsNew() {
  const items = [
    {
      badge: "NEW",
      title: "Leaderboards (beta)",
      desc: "HLTV-Rating-2.0-style ranking across every analyzed demo. Filter by map, date range, minimum rounds.",
    },
    {
      badge: "NEW",
      title: "Tier-priority auto-import",
      desc: "Major matches (S+) land before tier-1 regionals (S/A), so the most important demos are always queued first.",
    },
    {
      badge: "NEW",
      title: "Daily download budget",
      desc: "Caps how many GB of demos the auto-importer pulls per day. Stops the proxy quota from burning out mid-month.",
    },
    {
      badge: "UPDATE",
      title: "Bo3 series, every map",
      desc: "Bo3 / Bo5 matches now show every map of the series in /pro, each with its own Ver-en-2D button.",
    },
    {
      badge: "UPDATE",
      title: "Real ADR / KAST / utility",
      desc: "Parser now pulls per-tick damage and assist events directly — no more formula estimates.",
    },
  ];
  return (
    <SectionShell
      tag="R02 — WHAT'S NEW"
      title={
        <>
          Recent <span className="gradient-text">additions.</span>
        </>
      }
      lede="The most recent modules and improvements shipped to RIFTSCOPE."
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
// Pro feed, auto-importer, tier filter, Bo3 series.
// ===========================================================================
export function LandingProMatches() {
  return (
    <SectionShell
      tag="R04 — PRO MATCHES"
      title={
        <>
          Every pro match, <span className="gradient-text">ready to watch.</span>
        </>
      }
      lede="An auto-curated feed of pro CS2 matches discovered from HLTV. Filtered by tier and downloaded automatically — open any imported map and watch it in 2D."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          icon={Trophy}
          tone="primary"
          title="Auto-discovered feed"
          desc="The pro feed updates every 30 minutes from HLTV's results page. New matches appear with the score, event and tier already filled in."
        />
        <ModuleCard
          icon={Star}
          tone="accent"
          title="Tier filtering"
          desc="Default importer pulls S+ Majors, S tier-1 finals and A regionals first. C-tier scrims are excluded so the proxy budget goes to matches that matter."
        />
        <ModuleCard
          icon={Layers}
          tone="win"
          title="Bo3 / Bo5 series"
          desc="Series cards expand to show every map played, each with its own status chip and Ver-en-2D button. No need to chase individual demos."
        />
        <ModuleCard
          icon={Filter}
          tone="primary"
          title="Filters that work"
          desc="Filter the feed by map (active CS2 pool), team or tournament. Card chips stay in sync so you can drill down without losing context."
        />
        <ModuleCard
          icon={Timer}
          tone="ct"
          title="Daily budget"
          desc="Set a GB-per-day cap and the scheduler stops pulling when it hits the line. Resets at 00:00 UTC — your proxy quota survives the month."
        />
        <ModuleCard
          icon={Zap}
          tone="tt"
          title="One-click recovery"
          desc="If a demo gets stuck or the bytes go missing, hit Reset atascadas / Reintentar fallidas in the admin header. The scheduler picks them up first on the next tick."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R05 — LEADERBOARDS
// HLTV 2.0 rating across the corpus.
// ===========================================================================
export function LandingLeaderboards() {
  return (
    <SectionShell
      tag="R05 — LEADERBOARDS"
      title={
        <>
          Top players, <span className="gradient-text">HLTV 2.0 rated.</span>
        </>
      }
      lede="A single ranking across every analyzed demo, computed with the public HLTV Rating 2.0 formula. Filter by map, date range and round count — same metric you see on csstats and bo3.gg."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <ModuleCard
          icon={BarChart3}
          tone="primary"
          title="Rating 2.0 formula"
          desc="0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact + 0.0032·ADR + 0.1587. Reproducible and tied to real per-tick data."
        />
        <ModuleCard
          icon={Map}
          tone="accent"
          title="Map filter"
          desc="Pill bar with the active CS2 pool (Mirage, Dust2, Inferno, Ancient, Nuke, Overpass, Train, Vertigo, Anubis, Cache). All map for the global table."
        />
        <ModuleCard
          icon={Timer}
          tone="ct"
          title="Date range + min rounds"
          desc="Time windows of 30d, 90d, 12m or all-time. Minimum-rounds slider stops small-sample players from inflating the top."
        />
        <ModuleCard
          icon={Sparkles}
          tone="win"
          title="Real columns"
          desc="Rank, player, rating, ADR, K/D, KPR, DPR, KAST, UDR (utility / round), FAR (flash assists / round), rounds. Sort, search, pin."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R06 — TACTICAL BOARD + PLAYBOOK
// Strategic planner.
// ===========================================================================
export function LandingTactical() {
  return (
    <SectionShell
      tag="R06 — TACTICAL BOARD"
      title={
        <>
          Draw, save, <span className="gradient-text">share.</span>
        </>
      }
      lede="A top-down board with the real CS2 maps. Plot smokes, flashes, rotations and pick orders, then save the result to a Playbook for your team."
    >
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <ModuleCard
          icon={PenTool}
          tone="primary"
          title="2D map planner"
          desc="Pick a map, drop players on each side, draw arrows for rotations and grenade arcs. Snap-to-grid and per-side colors so the diagram reads at a glance."
        />
        <ModuleCard
          icon={Library}
          tone="accent"
          title="Playbook folders"
          desc="Group tactics by team, role or map veto outcome. Each saved tactic carries its diagram, notes and tags — searchable from the dashboard."
        />
        <ModuleCard
          icon={Target}
          tone="tt"
          title="Map-specific layers"
          desc="Common smoke / flash spots come pre-loaded per map so you don't redraw the same lineups every session. Add your own and reuse across plays."
        />
        <ModuleCard
          icon={ListChecks}
          tone="win"
          title="Steps + sequencing"
          desc="A tactic is a sequence of frames — t=0 (initial setup), t=1 (smokes thrown), t=2 (entry). Step through them in the viewer or share the full sequence."
        />
        <ModuleCard
          icon={Crosshair}
          tone="ct"
          title="Anti-strat suite"
          desc="Veto analysis, opponent prep and pre-match reports built on top of the playbook. Admin-only while in beta — switching to public soon."
        />
        <ModuleCard
          icon={ClipboardList}
          tone="primary"
          title="Round tactics linking"
          desc="When you find a round you want to remember, drop it into a tactic so the playbook always points back to the actual replay."
        />
      </div>
    </SectionShell>
  );
}

// ===========================================================================
// R09 — FAQ
// Real questions with short, honest answers.
// ===========================================================================
const FAQ: { q: string; a: string }[] = [
  {
    q: "What demos work?",
    a: "Any .dem from CS2 — matchmaking, FACEIT, ESEA, pro tournaments. We also accept .rar / .zip archives that bundle a Bo3 or Bo5 series; each .dem inside gets extracted and parsed separately.",
  },
  {
    q: "How long does parsing take?",
    a: "Roughly 2-10 minutes per demo depending on length and how much utility was used. A typical Bo3 series finishes in 15-25 minutes total. Progress is visible in /demos and in the pro card chip.",
  },
  {
    q: "Is it free?",
    a: "RIFTSCOPE is in beta and currently free to use. Pro demos are auto-imported and parsed at our cost. Pricing tiers will land when the corpus is bigger and the AI insights ship.",
  },
  {
    q: "Where do the pro matches come from?",
    a: "HLTV's results page is scraped every 30 minutes through a residential proxy pool. Matches are tagged by the importance stars HLTV displays (5★ = Major, 4★ = tier-1 finals, etc.) and downloaded in tier order.",
  },
  {
    q: "What is HLTV Rating 2.0?",
    a: "The public, reproducible rating formula HLTV introduced in 2018 and still ships under the hood of Rating 3.0. Linear combination of KAST, KPR, DPR, ADR and Impact. We compute it server-side from real per-tick events, not formula estimates.",
  },
  {
    q: "Are my private demos public?",
    a: "No. Demos uploaded by a logged-in account are scoped to that account — only you (and admins) can see them. Pro matches are public because they're already public on HLTV.",
  },
  {
    q: "Can I share a specific round / clip?",
    a: "Per-round sharable links are coming. The 2D viewer already has the state needed; we're packaging it as a permalink with social-card previews.",
  },
];

export function LandingFAQ() {
  return (
    <SectionShell
      tag="R09 — FAQ"
      title={
        <>
          Common <span className="gradient-text">questions.</span>
        </>
      }
      lede="Honest, short answers. If something's missing, find us on Discord or open an issue on GitHub."
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
