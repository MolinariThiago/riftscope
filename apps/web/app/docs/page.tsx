"use client";

// /docs — the wiki. A single long page with a sticky sidebar TOC,
// tactical R-series section labels and real how-to copy (no
// implementation talk). Reuses LandingNav so the visitor can jump
// back to the landing without losing context.
//
// Sections are short and action-oriented:
//   D01 Getting started
//   D02 The 2D viewer
//   D03 Pro matches
//   D04 Leaderboards
//   D05 Tactical board
//   D06 Playbook
//   D07 FAQ
//
// Anchors are stable (#getting-started, #viewer, etc.) so external
// links can deep-link safely.

import Link from "next/link";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  Crosshair,
  FileText,
  Layers,
  Library,
  Map,
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
  tag: string;       // R-style chip — D0X
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

      {/* Header strip — explicit "this is the docs" anchor */}
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
            Short, honest pages on every module — what each one is for,
            what the chips and filters mean, and how to actually get
            value out of it.
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

// Bullet list with a chevron — handy for "what each chip means" / "what each
// button does" inventories.
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

// Inline "callout" — small note with a colored side stripe.
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
      intro="Three minutes from landing on the site to watching a pro match in 2D."
    >
      <Steps
        items={[
          {
            label: "1. Sign in with Steam",
            desc: "Hit Sign in on the top right. RIFTSCOPE uses Steam OpenID — no password, no extra account to manage. We see your public Steam profile (avatar, nickname, country) and nothing else.",
          },
          {
            label: "2. Browse the pro feed",
            desc: "From the dashboard, click Partidas pro. Cards show every recent pro match auto-imported from HLTV. The chip next to the score tells you the state: Lista para 2D, Importable, or Descargando.",
          },
          {
            label: "3. Open the replay",
            desc: "Click Ver en 2D on any Lista-para-2D card. The 2D viewer launches with the first round loaded. Use the round selector at the bottom to jump to any round.",
          },
          {
            label: "4. (Optional) Upload your own demo",
            desc: "Use the Subir partida button in the sidebar to drop a .dem file. Parsing takes 2-10 min depending on demo length. You'll see the progress in /demos, and the match will be private to your account.",
          },
        ]}
      />
      <Callout title="Need an invite?">
        While in beta, sign-in is open to anyone with a Steam account.
        No invite code, no waitlist.
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
      intro="The replay viewer is where every other module ends up. It renders the demo on a top-down radar of the map, with every kill, grenade and rotation plotted."
    >
      <h3 className="text-base font-display font-semibold pt-2">Controls</h3>
      <Steps
        items={[
          {
            label: "Round selector (bottom)",
            desc: "Jump to any round. Numbered chips show the round result colored by which side won (blue CT / orange T). The thin separator marks the halftime swap.",
          },
          {
            label: "Timeline scrubber",
            desc: "Drag the playhead to any second of the round. Kills, plants and grenade detonations are pinned along the timeline so you can navigate by event.",
          },
          {
            label: "Play / pause / step",
            desc: "Spacebar plays / pauses. Arrow keys step one tick forward / back. Hold Shift to step a full second at a time.",
          },
          {
            label: "Player markers",
            desc: "Each circle is a live player; the line off the circle is their facing angle. Hover for nick + clan; click to lock the camera-follow to that player.",
          },
          {
            label: "Utility overlays",
            desc: "Smokes appear as light circles for their active duration. Flashes show as a brief radial flash. Molotovs/incendiaries render the burn patches with their real radius.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Right panel</h3>
      <Steps
        items={[
          {
            label: "Scoreboard",
            desc: "Real-time score per side plus kill / death / assist counts for every player in the round. Updates as the timeline scrubs.",
          },
          {
            label: "Round notes",
            desc: "What happened summary — opening kill, plant, defuses, clutches — auto-generated from the kill chain.",
          },
          {
            label: "Heatmap toggle",
            desc: "Switches the map background to a kill / death heatmap aggregated across all rounds of the demo. Useful for spotting recurring duel locations.",
          },
        ]}
      />

      <Callout tone="muted" title="Performance note">
        The viewer renders with PixiJS on canvas — it stays smooth even
        on big Bo3 demos. If you see frame drops, the most common cause
        is the browser tab being throttled in the background; bring the
        tab to focus and it recovers.
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
      intro="An auto-curated feed of pro CS2 matches. Cards expand into per-map sub-rows for Bo3 / Bo5 series so every game is one click from the viewer."
    >
      <h3 className="text-base font-display font-semibold pt-2">How it works</h3>
      <Steps
        items={[
          {
            label: "Discovery",
            desc: "Every 30 minutes the scheduler scrapes HLTV's results page through a residential proxy pool. New matches show up with team names, score, event and tier already filled in.",
          },
          {
            label: "Tier filtering",
            desc: "Only matches inside PRO_AUTO_TIERS (default: S+, S, A, B) get auto-imported. S+ are Majors (5 HLTV stars), S are tier-1 finals (4★), A are tier-1 regionals (3★), B are smaller LANs (2★). C-tier is excluded to protect proxy bandwidth.",
          },
          {
            label: "Priority order",
            desc: "Inside each tick, the scheduler picks S+ first, then S, A, B. Within each tier, newer matches win. Re-imports requested by the operator (purge + reimport) always jump to the front regardless of tier.",
          },
          {
            label: "Bo3 / Bo5 series",
            desc: "HLTV ships a series as one .rar containing 2-3 .dem files. RIFTSCOPE extracts all of them, links them to the same ProMatch, and renders them as a single expandable card.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Card chips</h3>
      <Steps
        items={[
          {
            label: "Lista para 2D",
            desc: "The demo finished parsing and is ready to watch in the viewer.",
          },
          {
            label: "Importable",
            desc: "We found the demo on HLTV but haven't downloaded + parsed it yet. Admins can hit the Importar button to bring it down on demand.",
          },
          {
            label: "Descargando…",
            desc: "Auto-import is currently pulling the .rar from HLTV. The chip polls every 5 s until the parse finishes.",
          },
          {
            label: "Falló",
            desc: "Something went wrong. Hover for the reason. Admins can retry from the header with Reintentar fallidas.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Admin controls (header)</h3>
      <Steps
        items={[
          {
            label: "Subir partida",
            desc: "Manual upload of a .dem you already have — useful for matches the scheduler didn't catch.",
          },
          {
            label: "Reset atascadas",
            desc: "Marks demos stuck in processing for >30 min as failed. Recovers from worker OOM kills that left the UI spinning.",
          },
          {
            label: "Reintentar fallidas",
            desc: "Re-queues every failed pro demo for parsing. Only retries demos whose bytes are still in S3; missing-byte demos show a separate amber chip with a purgar + reimportar button.",
          },
          {
            label: "Sync",
            desc: "Manual HLTV scrape (the scheduler does it every 30 min, this is for when you want fresh data right now).",
          },
        ]}
      />

      <Callout title="Budget chip">
        The Budget · X.X / 10 GB chip shows how much you've pulled from
        HLTV today (UTC). When it turns red, the auto-importer is parked
        until 00:00 UTC. Manual imports still work.
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
      intro="A single ranking of every player across every analyzed demo, computed with the public HLTV Rating 2.0 formula. Filter by map, time window and round count."
    >
      <h3 className="text-base font-display font-semibold pt-2">The rating</h3>
      <Callout tone="muted">
        Rating = 0.0073·KAST + 0.3591·KPR − 0.5329·DPR + 0.2372·Impact +
        0.0032·ADR + 0.1587. Impact = 2.13·KPR + 0.42·APR − 0.41. Every
        component is computed server-side from real per-tick events, not
        formula estimates. The values aggregate correctly across demos
        because raw counters (kills, deaths, total damage, KAST rounds)
        are summed before dividing — averaging rates would weight a
        16-round half the same as a 38-round overtime, which is wrong.
      </Callout>

      <h3 className="text-base font-display font-semibold pt-4">Filters</h3>
      <Steps
        items={[
          {
            label: "Map pill",
            desc: "All shows the global table. Per-map filters scope to one of the active CS2 pool maps (Mirage, Dust2, Inferno, Ancient, Nuke, Overpass, Train, Vertigo, Anubis, Cache).",
          },
          {
            label: "Date range",
            desc: "30d / 90d / 12m / All. Restricts to demos played in that window. Useful for seeing current form vs all-time.",
          },
          {
            label: "Minimum rounds slider",
            desc: "Player must have at least N rounds in the filtered window to qualify. Default 48 — high enough to exclude small-sample players who happened to drop one good map.",
          },
          {
            label: "Top N",
            desc: "Caps how many rows to render. 30 by default; bump to 100 to see deeper into the ranking.",
          },
          {
            label: "Search",
            desc: "Client-side filter by nickname or clan. Narrows the already-fetched top N — no extra request.",
          },
        ]}
      />

      <h3 className="text-base font-display font-semibold pt-4">Columns</h3>
      <Steps
        items={[
          { label: "Rating", desc: "HLTV 2.0 number. Green ≥ 1.10, primary ≥ 0.90, muted below." },
          { label: "ADR", desc: "Average damage per round. Pro avg sits around 75-95." },
          { label: "K/D", desc: "Total kills / total deaths. Cheap fragging metric, not adjusted." },
          { label: "KPR / DPR", desc: "Kills per round / deaths per round. The components Rating uses directly." },
          { label: "KAST%", desc: "Percent of rounds in which the player got a Kill, Assist, Survived, or was Traded." },
          { label: "UDR", desc: "Utility damage per round — grenades only." },
          { label: "FAR", desc: "Flash assists per round." },
          { label: "Rounds", desc: "Total rounds played in the filtered window." },
        ]}
      />
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
      intro="A top-down planner with the real CS2 maps. Drop players, draw arrows, plot smoke / flash lineups. Save the result to your playbook."
    >
      <h3 className="text-base font-display font-semibold pt-2">Workflow</h3>
      <Steps
        items={[
          {
            label: "Pick a map",
            desc: "Start by selecting one of the active pool maps. The board loads the radar at the right scale.",
          },
          {
            label: "Place players",
            desc: "Drag the player tokens from the side palette onto the map. Tokens are colored per side — blue CT, orange T. Position five each.",
          },
          {
            label: "Draw movement",
            desc: "Click + drag to draw a rotation arrow. Arrows snap to grid for clean readability. Edit, delete, recolor any time.",
          },
          {
            label: "Plot utility",
            desc: "Use the smoke / flash / molotov tools to drop a utility marker. Each marker shows the real radius the utility covers on that map.",
          },
          {
            label: "Step through frames",
            desc: "A tactic can be a sequence of frames (t=0 setup, t=1 smokes thrown, t=2 entry). Add a new frame to capture the next moment without losing the previous one.",
          },
          {
            label: "Save to playbook",
            desc: "Hit Guardar to drop the tactic into a folder. Add tags (map, side, situation) so it's findable later.",
          },
        ]}
      />
      <Callout title="From demo to tactic">
        If you find a round in the viewer you want to remember, you can
        snapshot it directly into the tactical board — positions and
        utility get pre-filled from that exact tick so you don't redraw.
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
      intro="Where saved tactics live. Folders, tags and a flat search so a team can build up an organized library instead of a screenshot dump."
    >
      <Steps
        items={[
          {
            label: "Folders",
            desc: "Group by team, role, opponent, or veto outcome. A folder is just a label — a tactic can live in only one folder at a time, but tags can cross-link.",
          },
          {
            label: "Tags",
            desc: "Free-form keywords (mirage, A-site, anti-eco, ferrari peek). The search bar matches across nickname, tag and folder so you can pull every Mirage A-execute in one query.",
          },
          {
            label: "Kinds",
            desc: "Each saved entry is either a Tactic (drawn on the board) or a Round Tactic (linked back to a specific round of a specific demo). Round tactics keep a deep-link to the viewer.",
          },
          {
            label: "Sharing",
            desc: "A tactic's URL is shareable inside your team scope. Public sharing is on the roadmap — the framework is there, the export modal isn't shipped yet.",
          },
        ]}
      />
    </Sec>
  );
}

// ===========================================================================
// D07 — FAQ
// ===========================================================================
function FAQ() {
  const items = [
    {
      q: "Why HLTV 2.0 and not 3.0?",
      a: "3.0 is great but its sub-ratings are eco-adjusted using a Round-Swing probability model calibrated on map / side / economy. We don't have that calibration corpus and HLTV doesn't publish the coefficients, so 3.0 isn't reproducible from public formulas. 2.0 is what csstats, bo3 and FerahgoTheGreat's reverse-engineering all rely on — it's the honest, computable standard.",
    },
    {
      q: "How does the tier filter on /pro really work?",
      a: "HLTV puts 0-5 importance stars next to every match on /results. We scrape that and map: 5★ → S+ (Majors), 4★ → S (tier-1 finals), 3★ → A (tier-1 regionals), 2★ → B (online cups, smaller LANs), 0-1★ → C (scrims, FPL-C). The PRO_AUTO_TIERS env var decides which buckets get auto-imported — default is S+/S/A/B.",
    },
    {
      q: "Why does the auto-importer skip some matches?",
      a: "Three reasons it might skip a tick: (1) daily download budget reached its GB cap for the UTC day, (2) the import backlog is already over 50 matches waiting to be parsed, (3) a manual import was already in flight for that match. The first two skip the whole sync; the third just defers that one row.",
    },
    {
      q: "Can I run RIFTSCOPE on my own machine?",
      a: "The code is on GitHub. The backend is FastAPI + Postgres + Celery-optional and the frontend is Next.js 14. Local dev runs against SQLite + filesystem storage with no scheduler. Production runs on Railway (backend) + Vercel (frontend) + R2 (storage) + Webshare residential proxies. Setup notes are in the repo.",
    },
    {
      q: "What happens to my private demo data?",
      a: "Demos uploaded by an account are scoped to that account via Demo.user_id. Only you (and platform admins) can read them. Pro demos imported from HLTV are public (they're already public on HLTV). No third-party analytics on the dashboard, no demo content is sold or shared.",
    },
    {
      q: "Where's the desktop app / recording suite?",
      a: "Not in scope. RIFTSCOPE is web-first: upload an existing .dem and analyze it. The recording / rendering tools cs2.cam offers are a different product surface — we'd rather do replay + leaderboards really well than spread thin.",
    },
    {
      q: "Per-round share links?",
      a: "Coming. The viewer state already knows enough to encode a permalink (?demo=X&round=N&tick=T). What's missing is the social-card image generator for the link preview. Tracking it as a near-term feature.",
    },
  ];
  return (
    <Sec
      slug="faq"
      tag="D07"
      title="FAQ"
      intro="Real questions, honest answers. If yours isn't here, ping us on Discord and we'll add it."
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
// highlight without forcing the user to manually wire scrollspy.
// ---------------------------------------------------------------------------
function useActiveSection(slugs: string[]): string {
  const [active, setActive] = useState(slugs[0] ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry closest to the top of the viewport that's
        // actually intersecting. Avoids the "all sections active at
        // once when scrolled to bottom" bug.
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
