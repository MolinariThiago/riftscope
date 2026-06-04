"use client";

// /docs — the wiki. Single long page with sticky sidebar TOC.
// Copy is strictly user-facing: what each thing does for you,
// how to use it, how to get the most out of it. No admin features,
// no infrastructure talk, no code or formulas.

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  FileText,
  Library,
  PenTool,
  Play,
  Star,
  Telescope,
  Trophy,
} from "lucide-react";

import { LandingNav } from "@/components/landing/LandingNav";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Section index — sidebar TOC + body. Keep them in sync via the ``slug``.
// ---------------------------------------------------------------------------
type Section = {
  slug: string;
  tag: string;       // D0X
  title: string;
  icon: React.ElementType;
};

const SECTIONS: Section[] = [
  { slug: "getting-started", tag: "D01", title: "Getting started", icon: Play },
  { slug: "viewer",          tag: "D02", title: "The 2D viewer",    icon: Telescope },
  { slug: "pro",             tag: "D03", title: "Pro matches",      icon: Trophy },
  { slug: "leaderboards",    tag: "D04", title: "Leaderboards",     icon: BookOpen },
  { slug: "tactical",        tag: "D05", title: "Tactical board",   icon: PenTool },
  { slug: "playbook",        tag: "D06", title: "Playbook",         icon: Library },
  { slug: "faq",             tag: "D07", title: "FAQ",              icon: FileText },
];

export default function DocsPage() {
  const active = useActiveSection(SECTIONS.map((s) => s.slug));

  return (
    <div className="relative min-h-screen">
      {/* Background — same grid the landing uses for visual continuity */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-background" />
        <div className="absolute inset-0 bg-grid-pattern opacity-30" />
      </div>

      <LandingNav />

      {/* Header strip */}
      <header className="pt-32 pb-10 px-6 border-b border-border/50">
        <div className="max-w-6xl mx-auto">
          <span className="inline-flex items-center gap-2 mb-3 text-[11px] font-mono-rs uppercase tracking-wider text-primary">
            <span className="h-1 w-6 bg-primary" />
            WIKI · v1
          </span>
          <h1 className="text-4xl lg:text-5xl font-display font-bold leading-tight">
            How to use <span className="gradient-text">RIFTSCOPE.</span>
          </h1>
          <p className="text-muted-foreground text-lg mt-3 max-w-2xl">
            Short, no-nonsense guides on every module — what it does
            for you, how to use it, and how to get the most out of it.
          </p>
        </div>
      </header>

      {/* Layout: sticky sidebar + content */}
      <div className="max-w-6xl mx-auto px-6 py-12 grid gap-10 lg:grid-cols-[220px_1fr]">
        {/* ---- Sidebar TOC -------------------------------------------- */}
        <aside className="hidden lg:block">
          <nav className="sticky top-28 space-y-1">
            <p className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground/70 mb-2 pl-3">
              On this page
            </p>
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const isActive = active === s.slug;
              return (
                <a
                  key={s.slug}
                  href={`#${s.slug}`}
                  className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors",
                    isActive
                      ? "bg-primary-dim text-primary font-semibold"
                      : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated/60",
                  )}
                >
                  <Icon size={13} className="flex-shrink-0" />
                  <span className="text-[10px] font-mono-rs opacity-60">{s.tag}</span>
                  <span className="truncate">{s.title}</span>
                </a>
              );
            })}
            <div className="pt-4 pl-3">
              <Link
                href="/"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors"
              >
                ← Back to overview
              </Link>
            </div>
          </nav>
        </aside>

        {/* ---- Content -------------------------------------------------- */}
        <main className="space-y-20">
          <GettingStarted />
          <Viewer />
          <ProMatches />
          <Leaderboards />
          <TacticalBoard />
          <Playbook />
          <FAQ />
        </main>
      </div>

      {/* Tail nav so the bottom of the doc has somewhere to go */}
      <div className="border-t border-border/50 px-6 py-10 mt-10">
        <div className="max-w-6xl mx-auto flex flex-wrap items-center justify-between gap-4 text-sm">
          <Link
            href="/"
            className="text-muted-foreground hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            ← Back to overview
          </Link>
          <Link
            href="/pro"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            Jump to /pro
            <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

// ===========================================================================
// Reusable section shell
// ===========================================================================
function Sec({
  slug,
  tag,
  title,
  intro,
  children,
}: {
  slug: string;
  tag: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section id={slug} className="scroll-mt-28">
      <span className="inline-flex items-center gap-2 mb-3 text-[11px] font-mono-rs uppercase tracking-wider text-primary">
        <span className="h-1 w-6 bg-primary" />
        {tag} — {title.toUpperCase()}
      </span>
      <h2 className="text-3xl font-display font-bold mb-3">{title}</h2>
      <p className="text-muted-foreground text-base leading-relaxed mb-6 max-w-2xl">
        {intro}
      </p>
      <div className="space-y-5">{children}</div>
    </section>
  );
}

// Bullet list with a chevron — used for control inventories and step flows.
function Steps({ items }: { items: { label: string; desc: string }[] }) {
  return (
    <ul className="space-y-3">
      {items.map((it) => (
        <li key={it.label} className="glass-card rounded-lg p-4">
          <div className="flex items-start gap-3">
            <ChevronRight size={14} className="text-primary mt-1 flex-shrink-0" />
            <div>
              <p className="font-semibold text-sm mb-1">{it.label}</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {it.desc}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

function Callout({
  tone = "primary",
  title,
  children,
}: {
  tone?: "primary" | "warn" | "muted";
  title?: string;
  children: React.ReactNode;
}) {
  const stripe: Record<string, string> = {
    primary: "border-l-primary bg-primary/5",
    warn: "border-l-amber-500 bg-amber-500/5",
    muted: "border-l-border bg-surface/40",
  };
  return (
    <div className={cn("border-l-2 rounded-r-md px-4 py-3", stripe[tone])}>
      {title && (
        <p className="text-[11px] font-mono-rs uppercase tracking-wider mb-1 opacity-80">
          {title}
        </p>
      )}
      <p className="text-sm text-muted-foreground leading-relaxed">{children}</p>
    </div>
  );
}

// ===========================================================================
// D01 — Getting started
// ===========================================================================
function GettingStarted() {
  return (
    <Sec
      slug="getting-started"
      tag="D01"
      title="Getting started"
      intro="From landing on the site to watching a pro match in 2D — about three minutes."
    >
      <Steps
        items={[
          {
            label: "1. Sign in with Steam",
            desc: "Click Sign in on the top right. We use Steam — no password to create, no extra account to manage. The only thing we see is your public Steam profile.",
          },
          {
            label: "2. Browse the pro feed",
            desc: "From the dashboard, head to Partidas pro. Cards show every recent pro match. The chip next to the score tells you the state: Lista para 2D means it's ready to watch.",
          },
          {
            label: "3. Open the replay",
            desc: "Click Ver en 2D on any ready card. The replay viewer launches with the first round loaded. Use the round bar at the bottom to jump to any round.",
          },
          {
            label: "4. (Optional) Upload your own demo",
            desc: "Use Subir partida in the sidebar to drop a .dem of your own — a matchmaking game, a FACEIT, a scrim. Processing takes a few minutes; once it's done, the demo is private to your account.",
          },
        ]}
      />
      <Callout title="Tip — get the most out of it">
        Star a few players from the leaderboard early on. Their pro
        demos float to the top of your dashboard so you always have a
        match worth watching one click away.
      </Callout>
    </Sec>
  );
}

// ===========================================================================
// D02 — Viewer
// ===========================================================================
function Viewer() {
  return (
    <Sec
      slug="viewer"
      tag="D02"
      title="The 2D viewer"
      intro="Where every other module ends up. The viewer renders a demo on a top-down map of the round — every player, every kill, every grenade visible at once."
    >
      <h3 className="text-base font-display font-semibold pt-2">Navigating a round</h3>
      <Steps
        items={[
          {
            label: "Round bar (bottom)",
            desc: "Numbered chips for every round. The color tells you who won — blue for CT, orange for T. The thin divider in the middle is the halftime swap.",
          },
          {
            label: "Timeline",
            desc: "Drag the playhead to any second. Kills, plants and grenade detonations are pinned along the bar so you can navigate by event instead of guessing the timestamp.",
          },
          {
            label: "Play / pause / step",
            desc: "Spacebar to play and pause. Arrow keys step a single moment forward or back. Hold Shift to step a full second at a time.",
          },
          {
            label: "Player markers",
            desc: "Each circle is a player. The line off the circle is where they're aiming. Hover for nickname; click to lock the camera on that player and follow them around the map.",
          },
          {
            label: "Utility on the map",
            desc: "Smokes appear as soft circles for as long as they last. Flashes show a brief radial pop. Molotov and incendiary patches render with their real burn area.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Side panel</h3>
      <Steps
        items={[
          {
            label: "Live scoreboard",
            desc: "Score per side plus kills, deaths and assists for every player in the current round. Updates as you scrub the timeline.",
          },
          {
            label: "Round notes",
            desc: "A plain-English summary of what happened — opening kill, plant, defuses, clutches. Quick way to read the round before watching it.",
          },
          {
            label: "Heatmap toggle",
            desc: "Switches the map background to a kill / death heatmap aggregated across the whole game. Best way to spot common duel spots and angles.",
          },
        ]}
      />

      <Callout tone="muted" title="Get the most out of it">
        Watching a pro round? Click on one player to follow them, then
        hit play. You'll see their rotations and decisions independent
        of where the action is — the kind of thing a casual stream
        cut never lets you watch.
      </Callout>
    </Sec>
  );
}

// ===========================================================================
// D03 — Pro matches
// ===========================================================================
function ProMatches() {
  return (
    <Sec
      slug="pro"
      tag="D03"
      title="Pro matches"
      intro="A curated feed of pro CS2 matches you can open in 2D in one click."
    >
      <h3 className="text-base font-display font-semibold pt-2">What you'll see</h3>
      <Steps
        items={[
          {
            label: "Counters strip",
            desc: "Three numbers at the top: Listas para 2D (ready to watch right now), Importables (queued for the system to bring in) and Total (everything in the library).",
          },
          {
            label: "Match cards",
            desc: "Each card shows the two teams, the final score and the event name. Single-map matches have one Ver-en-2D button; Bo3 / Bo5 series expand to show every map of the series.",
          },
          {
            label: "Card chips",
            desc: "Lista para 2D means the demo is parsed and ready. Importable means the match is known and queued. Descargando means it's coming in right now.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Finding matches fast</h3>
      <Steps
        items={[
          {
            label: "Filter by map",
            desc: "Dropdown with every active CS2 pool map. Pick one to see only matches played on it. Combine with the team filter to find \"every G2 match on Mirage\".",
          },
          {
            label: "Filter by team",
            desc: "Dropdown listing every team in the feed. Useful for following a specific roster — every NAVI series, every FaZe final.",
          },
          {
            label: "Filter by tournament",
            desc: "Narrow to a single event — IEM Cologne, BLAST Premier, ESL Pro League. Stack with the map filter to drill into the actual matchup you want.",
          },
        ]}
      />

      <Callout title="Get the most out of it">
        Looking for a Major final on a specific map? Stack the tournament
        filter with the map filter. The remaining cards are the exact
        games you wanted — open one and jump straight into the viewer.
      </Callout>
    </Sec>
  );
}

// ===========================================================================
// D04 — Leaderboards
// ===========================================================================
function Leaderboards() {
  return (
    <Sec
      slug="leaderboards"
      tag="D04"
      title="Leaderboards"
      intro="The single ranking of every player across every analysed pro match. Same rating concept the community already uses — figure out who's in form and who's just famous."
    >
      <h3 className="text-base font-display font-semibold pt-2">What the columns mean</h3>
      <Steps
        items={[
          {
            label: "Rating",
            desc: "The headline number. Higher is better. Around 1.00 is average; over 1.10 is strong; over 1.20 is dominant. Color-coded so the top of the page is easy to read at a glance.",
          },
          {
            label: "ADR (average damage per round)",
            desc: "How much damage the player deals each round on average. A reliable signal of impact — even when kills are tight, ADR shows who's softening the fight.",
          },
          {
            label: "K/D",
            desc: "Total kills divided by total deaths. The most basic measure of fragging — useful but doesn't account for round impact.",
          },
          {
            label: "KAST%",
            desc: "Percent of rounds where the player contributed: a kill, an assist, survived, or got traded. Cuts through the noise of \"good stats but bad rounds\" — high KAST means consistent presence.",
          },
          {
            label: "UDR (utility damage per round)",
            desc: "Damage dealt with grenades alone. Big for support roles who throw a lot of HE and molotovs — the unsung hero metric.",
          },
          {
            label: "FAR (flash assists per round)",
            desc: "How often the player blinds an enemy for a teammate's kill. Lurkers and entry-supports show up here.",
          },
          {
            label: "Rounds",
            desc: "Total rounds the player has logged in the current filter window. The denominator for every per-round metric — small numbers here mean small sample size.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Filters</h3>
      <Steps
        items={[
          {
            label: "Map pill bar",
            desc: "All for the global table, or click any pool map to see the leaderboard scoped to that one. Best way to find map specialists — the Inferno king isn't always the Nuke king.",
          },
          {
            label: "Date range",
            desc: "30d / 90d / 12m / All. Toggle between current form and historic legends without losing your seat. A player on a hot streak shows up immediately in the 30d window.",
          },
          {
            label: "Minimum rounds slider",
            desc: "Set a floor on how many rounds a player has to log to qualify. Keeps small-sample one-game wonders out of the top of the table.",
          },
          {
            label: "Top N",
            desc: "How many rows to show. 30 is enough for casual browsing; bump it to 100 to see deeper into the field.",
          },
          {
            label: "Search box",
            desc: "Filter the visible rows by nickname or clan as you type. Instant lookup if you want to find a specific player without scrolling.",
          },
        ]}
      />

      <Callout title="Get the most out of it">
        Compare across windows. Open the leaderboard in 90d to see
        current form, then flip to All-time to see who's still on top
        long-term. The gap between the two tells you who's surging
        and who's coasting on reputation.
      </Callout>
    </Sec>
  );
}

// ===========================================================================
// D05 — Tactical board
// ===========================================================================
function TacticalBoard() {
  return (
    <Sec
      slug="tactical"
      tag="D05"
      title="Tactical board"
      intro="A top-down planner with the real CS2 maps. Plot a smoke, draw a rotation, set up an execute — then save it so your team can run it."
    >
      <h3 className="text-base font-display font-semibold pt-2">Drawing a tactic</h3>
      <Steps
        items={[
          {
            label: "Pick a map",
            desc: "Start by selecting one of the active pool maps. The board loads the radar at the right scale and lines up the callouts.",
          },
          {
            label: "Place players",
            desc: "Drag the player tokens from the side palette onto the map. Tokens are color-coded — blue CT, orange T. Position five each.",
          },
          {
            label: "Draw movement",
            desc: "Click and drag to draw a rotation arrow. Arrows snap to grid so the diagram stays readable. Edit, recolor or delete any time.",
          },
          {
            label: "Plot utility",
            desc: "Use the smoke / flash / molotov tools to drop a utility marker. The marker shows the real coverage the grenade gives on that map — what you draw is what you'll get in-game.",
          },
          {
            label: "Step through frames",
            desc: "A tactic can be a sequence: setup → smokes thrown → entry → trade. Add a new frame to capture each step without losing the previous one.",
          },
          {
            label: "Save to your playbook",
            desc: "Hit Guardar to drop the tactic into a folder. Add tags (map, side, situation) so it's findable later when you want to run it again.",
          },
        ]}
      />
      <Callout title="Snapshot from a real round">
        Found a round in the viewer worth remembering? You can snapshot
        it directly into the tactical board — player positions and
        utility from that exact moment get loaded in so you can build
        from a real play instead of starting from a blank board.
      </Callout>
    </Sec>
  );
}

// ===========================================================================
// D06 — Playbook
// ===========================================================================
function Playbook() {
  return (
    <Sec
      slug="playbook"
      tag="D06"
      title="Playbook"
      intro="Where your saved tactics live. Folders, tags and a flat search so a team builds up an organised library instead of a Discord channel full of screenshots."
    >
      <Steps
        items={[
          {
            label: "Folders",
            desc: "Group tactics by team, role, map veto outcome, or whatever scheme fits your prep. A tactic lives in one folder at a time, but tags can cross-link.",
          },
          {
            label: "Tags",
            desc: "Free-form keywords like \"mirage\", \"A-site\", \"anti-eco\", \"ferrari peek\". The search bar matches across tags so you can pull every Mirage A-execute in one query.",
          },
          {
            label: "Two kinds of entries",
            desc: "A Tactic is something you drew from scratch on the board. A Round Tactic is linked to a specific round of a specific demo — clicking it jumps you back into the viewer at that moment.",
          },
          {
            label: "Share with your team",
            desc: "A tactic's URL is shareable inside your team scope so everyone references the same diagram. Public sharing is on the roadmap.",
          },
        ]}
      />
      <Callout title="Get the most out of it">
        Keep your folder names simple — &quot;vs FaZe&quot;,
        &quot;Mirage T side&quot;, &quot;anti-eco rounds&quot; beats
        elaborate trees. The search bar is fast enough that flat
        structure works better than deep nesting.
      </Callout>
    </Sec>
  );
}

// ===========================================================================
// D07 — FAQ
// ===========================================================================
function FAQ() {
  const items = [
    {
      q: "What demos can I upload?",
      a: "Any standard CS2 demo (.dem) — matchmaking, FACEIT, ESEA, or a pro demo you have. Series archives that bundle multiple games work too: each game inside becomes its own analysed match.",
    },
    {
      q: "How long does it take?",
      a: "Usually 2 to 10 minutes per game depending on its length. A Bo3 series typically finishes in 15 to 25 minutes. You'll see live progress in your demo list while it processes.",
    },
    {
      q: "What does the rating mean?",
      a: "It's the same community-standard rating you already see on other CS2 stats sites — reproducible, comparable, computed from real in-game performance. Around 1.00 is average; over 1.10 is strong.",
    },
    {
      q: "Are my private demos visible to other people?",
      a: "No. A demo you upload is yours alone. Only your account can see it. Pro matches are public because they're already public events.",
    },
    {
      q: "Can I share a single round or clutch?",
      a: "Per-round share links are on the way. Once they ship, you'll be able to copy a URL that opens the viewer at the exact round and second — perfect for dropping a clutch into Discord.",
    },
    {
      q: "Is there a mobile version?",
      a: "The site works on a phone but the 2D viewer is built for a real screen — there's a lot to read at once and a large canvas helps. Browsing the feed and the leaderboard works fine on mobile; for serious analysis, use a laptop.",
    },
    {
      q: "Why don't I see my favourite player?",
      a: "If the player hasn't been in a recently analysed pro match they won't appear in the leaderboard. Try widening the date range to All — historic players may show up there. The library grows continuously, so new faces appear as events land.",
    },
  ];
  return (
    <Sec
      slug="faq"
      tag="D07"
      title="FAQ"
      intro="Quick answers to the things people ask most. If yours isn't here, ping us on Discord."
    >
      <ul className="space-y-3">
        {items.map((it) => (
          <li key={it.q} className="glass-card rounded-lg p-4">
            <p className="font-semibold text-sm mb-2 flex items-start gap-2">
              <Star size={12} className="text-primary mt-1 flex-shrink-0" />
              {it.q}
            </p>
            <p className="text-sm text-muted-foreground leading-relaxed pl-6">
              {it.a}
            </p>
          </li>
        ))}
      </ul>
    </Sec>
  );
}

// ---------------------------------------------------------------------------
// Hook: which section is currently in the viewport? Drives the sidebar
// highlight without forcing manual scrollspy wiring.
// ---------------------------------------------------------------------------
function useActiveSection(slugs: string[]): string {
  const [active, setActive] = useState(slugs[0] ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]?.target.id) {
          setActive(visible[0].target.id);
        }
      },
      {
        rootMargin: "-30% 0px -50% 0px",
        threshold: 0,
      },
    );

    slugs.forEach((slug) => {
      const el = document.getElementById(slug);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [slugs]);

  return active;
}
