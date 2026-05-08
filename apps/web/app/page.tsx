import Link from "next/link";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingStats } from "@/components/landing/LandingStats";
import { LandingCTA } from "@/components/landing/LandingCTA";
import { LandingNav } from "@/components/landing/LandingNav";

export default function HomePage() {
  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* Background effects */}
      <div className="fixed inset-0 bg-background" />
      <div className="fixed inset-0 bg-grid-pattern opacity-40" />
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[900px] h-[600px] bg-glow-primary pointer-events-none" />

      {/* Scan line effect */}
      <div
        className="fixed left-0 right-0 h-px opacity-10 pointer-events-none z-50"
        style={{
          background: "linear-gradient(90deg, transparent, hsl(185 100% 52%), transparent)",
          animation: "scanLine 8s linear infinite",
          top: 0,
        }}
      />

      <div className="relative z-10">
        <LandingNav />
        <LandingHero />
        <LandingStats />
        <LandingFeatures />
        <LandingCTA />

        {/* Footer */}
        <footer className="border-t border-border/50 py-8 mt-16">
          <div className="max-w-7xl mx-auto px-6 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <RiftscopeLogo size="sm" />
              <span className="text-muted-foreground text-sm">
                © 2025 RIFTSCOPE. All rights reserved.
              </span>
            </div>
            <div className="flex gap-6 text-sm text-muted-foreground">
              <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy</Link>
              <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
              <Link href="https://discord.gg" className="hover:text-foreground transition-colors">Discord</Link>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}

function RiftscopeLogo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <div className={`font-display font-bold tracking-tight ${size === "sm" ? "text-lg" : "text-xl"}`}>
      <span className="gradient-text">RIFT</span>
      <span className="text-foreground/80">SCOPE</span>
    </div>
  );
}
