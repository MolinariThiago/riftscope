"use client";

import { Map, Clock, Crosshair, FileCheck, Play, SkipBack, SkipForward, type LucideIcon } from "lucide-react";
import { motion } from "framer-motion";

import { fadeUp, staggerContainer, inViewport } from "./motion";

const CT = "hsl(213 100% 65%)";
const TT = "hsl(33 100% 64%)";

const bullets: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Map, title: "2D tactical map", desc: "Every player, rendered on an accurate top-down radar of the map." },
  { icon: Clock, title: "Per-second timeline", desc: "Scrub any round and watch kills, utility and rotations play out." },
  { icon: Crosshair, title: "Kills, nades & bomb", desc: "Smokes, flashes, molotovs, plants and defuses — all on the map." },
  { icon: FileCheck, title: "Any .dem file", desc: "Drop a matchmaking, FACEIT or pro demo. No plugins required." },
];

export function LandingReplayShowcase() {
  return (
    <section id="replay" className="py-24 px-6 border-t border-border/50">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
        {/* Copy */}
        <motion.div
          variants={staggerContainer(0.1)}
          initial="hidden"
          whileInView="show"
          viewport={inViewport}
        >
          <motion.span
            variants={fadeUp}
            className="inline-flex items-center gap-2 mb-4 text-[11px] font-mono-rs uppercase tracking-wider text-primary"
          >
            <span className="h-1 w-6 bg-primary" />
            R03 · CORE ANALYSIS
          </motion.span>
          <motion.h2 variants={fadeUp} className="text-3xl lg:text-4xl font-display font-bold mb-4">
            Replay every round, <span className="gradient-text">in 2D.</span>
          </motion.h2>
          <motion.p variants={fadeUp} className="text-muted-foreground text-lg mb-8 max-w-md">
            RIFTSCOPE turns your raw demo into an interactive tactical replay —
            so you can see exactly how each round was won or lost.
          </motion.p>

          <motion.div variants={staggerContainer(0.08)} className="space-y-5">
            {bullets.map((b) => (
              <motion.div key={b.title} variants={fadeUp} className="flex gap-4">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary-dim/40">
                  <b.icon size={18} className="text-primary" />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-base">{b.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>
        </motion.div>

        {/* Replay panel */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={inViewport}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <ReplayPanel />
        </motion.div>
      </div>
    </section>
  );
}

function ReplayPanel() {
  return (
    <div className="glass-card rounded-2xl overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/60">
        <div>
          <div className="text-[10px] text-muted-foreground font-mono-rs leading-none">2D REPLAY</div>
          <div className="font-display font-bold text-sm leading-tight mt-0.5">de_mirage · Round 18</div>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono-rs">
          <span className="text-ct font-bold">9</span>
          <span className="text-muted-foreground">–</span>
          <span className="text-tt font-bold">8</span>
        </div>
      </div>

      {/* Map */}
      <div className="relative h-[300px] bg-[hsl(220_18%_6%)]">
        <div className="absolute inset-0 map-grid opacity-70" />

        <svg viewBox="0 0 400 300" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
          <g stroke="hsl(185 100% 52% / 0.16)" strokeWidth="1.4" fill="hsl(185 100% 52% / 0.04)">
            <rect x="40" y="36" width="120" height="84" rx="8" />
            <rect x="248" y="46" width="110" height="74" rx="8" />
            <rect x="158" y="138" width="86" height="110" rx="8" />
            <rect x="44" y="150" width="86" height="58" rx="8" />
          </g>
          <text x="100" y="84" fill="hsl(185 100% 52% / 0.35)" fontSize="20" fontFamily="monospace" textAnchor="middle">A</text>
          <text x="303" y="90" fill="hsl(185 100% 52% / 0.35)" fontSize="20" fontFamily="monospace" textAnchor="middle">B</text>
          {/* dashed connectors */}
          <path d="M100 120 L100 150 M205 120 L205 138 M205 248 L205 268" stroke="hsl(185 100% 52% / 0.16)" strokeWidth="1.1" strokeDasharray="4 4" fill="none" />
        </svg>

        {/* Smoke (static) */}
        <div
          className="absolute left-[44%] top-[40%] h-14 w-14 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: "radial-gradient(circle, hsl(210 10% 80% / 0.35), transparent 70%)" }}
        />
        {/* Bomb */}
        <div className="absolute left-[25%] top-[26%] -translate-x-1/2 -translate-y-1/2 text-loss text-xs font-bold font-mono-rs">C4</div>

        {/* Static player dots */}
        {dots.map((d, i) => (
          <Dot key={i} {...d} />
        ))}

        {/* Kill marker */}
        <div className="absolute left-[60%] top-[58%] -translate-x-1/2 -translate-y-1/2 text-muted-foreground/60">
          <Crosshair size={14} />
        </div>
      </div>

      {/* Playback bar (static) */}
      <div className="px-4 py-3 border-t border-border/60 space-y-2">
        <div className="flex items-center gap-3">
          <SkipBack size={14} className="text-muted-foreground" />
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Play size={12} fill="currentColor" />
          </div>
          <SkipForward size={14} className="text-muted-foreground" />
          <div className="flex-1 h-1.5 rounded-full bg-surface-elevated overflow-hidden">
            <div className="h-full rounded-full bg-primary" style={{ width: "42%" }} />
          </div>
          <span className="text-[11px] font-mono-rs text-muted-foreground tabular-nums">0:48 / 1:55</span>
        </div>
      </div>
    </div>
  );
}

function Dot({ team, top, left, rot }: { team: "ct" | "tt"; top: string; left: string; rot: number }) {
  const color = team === "ct" ? CT : TT;
  return (
    <div className="absolute" style={{ top, left }}>
      <div className="relative -translate-x-1/2 -translate-y-1/2">
        <div
          className="absolute left-1/2 top-1/2 h-8 w-10"
          style={{
            transform: `translate(-50%, -50%) rotate(${rot}deg)`,
            clipPath: "polygon(50% 100%, 16% 0, 84% 0)",
            background: `linear-gradient(to top, ${color}, transparent)`,
            opacity: 0.22,
          }}
        />
        <div
          className="relative h-2.5 w-2.5 rounded-full"
          style={{ background: color, border: "1.5px solid hsl(220 18% 6%)" }}
        />
      </div>
    </div>
  );
}

const dots: { team: "ct" | "tt"; top: string; left: string; rot: number }[] = [
  { team: "ct", top: "30%", left: "24%", rot: 135 },
  { team: "ct", top: "70%", left: "50%", rot: 0 },
  { team: "ct", top: "52%", left: "20%", rot: 80 },
  { team: "tt", top: "32%", left: "76%", rot: 210 },
  { team: "tt", top: "50%", left: "62%", rot: 250 },
];
