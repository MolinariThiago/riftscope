"use client";

import Link from "next/link";
import { ArrowRight, Upload, Zap } from "lucide-react";
import { useEffect, useRef } from "react";

export function LandingHero() {
  return (
    <section className="relative pt-32 pb-20 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* Left: Copy */}
          <div className="space-y-8">
            {/* Badge */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary/30 bg-primary-dim/30 text-xs font-semibold text-primary font-mono-rs tracking-wider animate-fade-in">
              <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
              CS2 DEMO ANALYTICS PLATFORM
            </div>

            {/* Headline */}
            <div className="animate-slide-up" style={{ animationDelay: "0.1s", opacity: 0 }}>
              <h1 className="text-5xl lg:text-6xl xl:text-7xl font-display font-bold leading-[1.05]">
                <span className="text-foreground">See every</span>
                <br />
                <span className="gradient-text glow-text-primary">angle.</span>
                <br />
                <span className="text-foreground">Win every</span>
                <br />
                <span className="gradient-text">round.</span>
              </h1>
            </div>

            {/* Subheadline */}
            <p
              className="text-lg text-muted-foreground leading-relaxed max-w-lg animate-slide-up"
              style={{ animationDelay: "0.2s", opacity: 0 }}
            >
              Upload your CS2 demos and replay every round on a 2D tactical map.
              Watch player movements, kills, smokes and bomb plants unfold in real
              time — plus deep stats: ratings, economy, clutches and more.
            </p>

            {/* CTAs */}
            <div
              className="flex flex-wrap gap-4 animate-slide-up"
              style={{ animationDelay: "0.3s", opacity: 0 }}
            >
              <Link
                href="/register"
                className="group inline-flex items-center gap-2.5 px-6 py-3.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-all duration-200 glow-primary"
                style={{ fontFamily: "var(--font-display)" }}
              >
                <Upload size={16} />
                Upload your demo
                <ArrowRight size={14} className="group-hover:translate-x-1 transition-transform" />
              </Link>
              <Link
                href="/demo/preview"
                className="inline-flex items-center gap-2 px-6 py-3.5 border border-border rounded-lg text-sm text-foreground hover:border-primary/50 hover:bg-surface transition-all duration-200"
              >
                <Zap size={14} className="text-primary" />
                View live demo
              </Link>
            </div>

            {/* Social proof */}
            <div
              className="flex items-center gap-6 pt-2 animate-slide-up"
              style={{ animationDelay: "0.4s", opacity: 0 }}
            >
              <div className="flex -space-x-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full bg-surface-elevated border border-border flex items-center justify-center text-xs font-mono-rs text-muted-foreground"
                  >
                    {String.fromCharCode(64 + i)}
                  </div>
                ))}
              </div>
              <p className="text-sm text-muted-foreground">
                <span className="text-foreground font-semibold">2,400+</span> demos analyzed this week
              </p>
            </div>
          </div>

          {/* Right: UI Preview */}
          <div
            className="relative animate-fade-in"
            style={{ animationDelay: "0.5s", opacity: 0 }}
          >
            <HeroUIPreview />
          </div>
        </div>
      </div>
    </section>
  );
}

// Simplified UI mockup preview
function HeroUIPreview() {
  return (
    <div className="relative">
      {/* Outer glow */}
      <div className="absolute inset-0 bg-primary/5 rounded-2xl blur-3xl" />

      {/* Main card */}
      <div className="relative glass-card border-glow rounded-2xl overflow-hidden p-5 space-y-4">
        {/* Card header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs text-muted-foreground font-mono-rs mb-1">MATCH OVERVIEW</div>
            <div className="font-display font-bold text-lg">de_mirage • ESL Pro League</div>
          </div>
          <div className="flex items-center gap-2">
            <span className="rs-badge bg-win/15 text-win">WIN</span>
            <span className="text-sm font-mono-rs text-foreground font-bold">16–12</span>
          </div>
        </div>

        {/* Score bar */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-muted-foreground">
            <span className="text-ct font-semibold">CT Side</span>
            <span className="text-tt font-semibold">T Side</span>
          </div>
          <div className="h-2 rounded-full bg-surface-elevated overflow-hidden flex">
            <div className="h-full bg-ct rounded-l-full" style={{ width: "57%" }} />
            <div className="h-full bg-tt rounded-r-full" style={{ width: "43%" }} />
          </div>
          <div className="flex justify-between text-xs font-mono-rs">
            <span className="text-ct">9–7</span>
            <span className="text-tt">7–9</span>
          </div>
        </div>

        {/* Players mini table */}
        <div className="space-y-1.5">
          {mockPlayers.map((p, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-surface-elevated/50 hover:bg-surface-elevated transition-colors">
              <div className="w-1 h-8 rounded-full" style={{ background: i < 3 ? "hsl(185 100% 52%)" : "hsl(var(--border))" }} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground font-mono-rs">{p.team}</div>
              </div>
              <div className="flex gap-4 text-xs font-mono-rs">
                <span className="text-foreground font-bold">{p.rating}</span>
                <span className="text-kill">{p.kills}</span>
                <span className="text-death">{p.deaths}</span>
                <span className="text-muted-foreground">{p.adr}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Bottom stats row */}
        <div className="grid grid-cols-4 gap-2 pt-1">
          {[
            { label: "HS%", value: "62%" },
            { label: "KAST", value: "74%" },
            { label: "ADR", value: "89.4" },
            { label: "Rating", value: "1.21" },
          ].map((stat) => (
            <div key={stat.label} className="text-center p-2 rounded-lg bg-surface-elevated">
              <div className="text-xs text-muted-foreground font-mono-rs">{stat.label}</div>
              <div className="text-sm font-bold font-mono-rs text-primary mt-0.5">{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Floating mini card: Round timeline */}
      <div className="absolute -bottom-4 -left-6 glass-card rounded-xl p-3 w-52 shadow-xl">
        <div className="text-xs text-muted-foreground font-mono-rs mb-2">ROUND TIMELINE</div>
        <div className="flex gap-0.5">
          {roundData.map((r, i) => (
            <div
              key={i}
              className={`flex-1 h-6 rounded-sm transition-all ${
                r.winner === "ct" ? "bg-ct/80" : "bg-tt/80"
              }`}
              title={`Round ${i + 1}`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1.5 text-xs font-mono-rs text-muted-foreground">
          <span>R1</span>
          <span>R{roundData.length}</span>
        </div>
      </div>

      {/* Floating mini card: Economy */}
      <div className="absolute -top-4 -right-4 glass-card rounded-xl p-3 shadow-xl">
        <div className="text-xs text-muted-foreground font-mono-rs mb-1.5">NEXT ROUND ECO</div>
        <div className="flex items-center gap-3">
          <div>
            <div className="text-xs text-muted-foreground">CT Bank</div>
            <div className="text-sm font-bold font-mono-rs text-ct">$18,200</div>
          </div>
          <div className="w-px h-8 bg-border" />
          <div>
            <div className="text-xs text-muted-foreground">T Bank</div>
            <div className="text-sm font-bold font-mono-rs text-tt">$12,450</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const mockPlayers = [
  { name: "s1mple", team: "NaVi • CT", rating: "1.41", kills: "28", deaths: "14", adr: "112" },
  { name: "NiKo", team: "G2 • CT", rating: "1.28", kills: "24", deaths: "16", adr: "98" },
  { name: "ZywOo", team: "Vitality • CT", rating: "1.19", kills: "21", deaths: "17", adr: "89" },
  { name: "electronic", team: "NaVi • T", rating: "1.05", kills: "18", deaths: "19", adr: "76" },
  { name: "frozen", team: "NaVi • T", rating: "0.96", kills: "16", deaths: "20", adr: "71" },
];

const roundData = [
  { winner: "tt" }, { winner: "ct" }, { winner: "ct" }, { winner: "tt" }, { winner: "ct" },
  { winner: "ct" }, { winner: "tt" }, { winner: "ct" }, { winner: "ct" }, { winner: "tt" },
  { winner: "ct" }, { winner: "ct" }, { winner: "tt" }, { winner: "ct" }, { winner: "tt" },
  { winner: "ct" }, { winner: "ct" }, { winner: "tt" }, { winner: "tt" }, { winner: "ct" },
  { winner: "ct" }, { winner: "tt" }, { winner: "ct" }, { winner: "ct" }, { winner: "ct" },
  { winner: "tt" }, { winner: "ct" }, { winner: "ct" },
];
