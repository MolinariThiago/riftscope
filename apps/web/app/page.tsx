import Link from "next/link";
import { Github, Twitter, MessageCircle } from "lucide-react";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingHero } from "@/components/landing/LandingHero";
import { LandingReplayShowcase } from "@/components/landing/LandingReplayShowcase";
import { LandingFeatures } from "@/components/landing/LandingFeatures";
import { LandingCTA } from "@/components/landing/LandingCTA";
import {
  LandingFAQ,
  LandingLeaderboards,
  LandingProMatches,
  LandingTactical,
  LandingWhatsNew,
} from "@/components/landing/LandingModules";

// Landing page — "Análisis táctico, redefinido."
// Burgundy premium identity, Spanish copy, coach/analyst targeted.
export default function HomePage() {
  return (
    <div className="relative min-h-screen">
      {/* Subtle static background */}
      <div className="fixed inset-0 -z-10">
        <div className="absolute inset-0 bg-background" />
        <div className="absolute inset-0 bg-grid-pattern opacity-20" />
      </div>

      <LandingNav />
      <LandingHero />
      <LandingWhatsNew />
      <LandingReplayShowcase />
      <LandingFeatures />
      <LandingProMatches />
      <LandingLeaderboards />
      <LandingTactical />
      <LandingFAQ />
      <LandingCTA />
      <LandingFooter />
    </div>
  );
}

function LandingFooter() {
  return (
    <footer className="border-t border-border/30">
      <div className="max-w-6xl mx-auto px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <HexLogo />
              <span className="font-display font-bold text-lg tracking-tight">
                <span className="gradient-text">RIFT</span>
                <span className="text-foreground/80">SCOPE</span>
              </span>
            </div>
            <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
              Análisis táctico, redefinido. La plataforma de inteligencia
              todo-en-uno para coaches y analistas de CS2.
            </p>
            <div className="flex items-center gap-3 pt-1">
              <SocialLink href="https://discord.gg" label="Discord"><MessageCircle size={16} /></SocialLink>
              <SocialLink href="https://github.com" label="GitHub"><Github size={16} /></SocialLink>
              <SocialLink href="https://x.com" label="X"><Twitter size={16} /></SocialLink>
            </div>
          </div>

          <FooterCol title="Producto" links={[
            { label: "Funciones", href: "#features" },
            { label: "Visor 2D", href: "#replay" },
            { label: "Leaderboards", href: "/leaderboards" },
          ]} />
          <FooterCol title="Recursos" links={[
            { label: "Documentación", href: "/docs" },
            { label: "Changelog", href: "#" },
          ]} />
          <FooterCol title="Legal" links={[
            { label: "Privacidad", href: "/privacy" },
            { label: "Términos", href: "/terms" },
            { label: "Contacto", href: "#" },
          ]} />
        </div>

        <div className="mt-12 pt-6 border-t border-border/30 flex flex-col sm:flex-row items-center justify-between gap-4">
          <span className="text-muted-foreground text-sm">
            &copy; 2026 RIFTSCOPE. Todos los derechos reservados.
          </span>
          <span className="text-xs text-muted-foreground font-mono-rs">
            No afiliado con Valve Corporation.
          </span>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="font-display font-semibold text-sm mb-4">{title}</h4>
      <ul className="space-y-2.5">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-primary hover:border-primary/40 transition-colors"
    >
      {children}
    </Link>
  );
}

function HexLogo() {
  return (
    <div className="w-8 h-8">
      <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
        <path d="M16 2L28 8V16L16 22L4 16V8L16 2Z" stroke="hsl(350 70% 33%)" strokeWidth="1.5" fill="hsl(350 70% 33% / 0.1)" />
        <path d="M16 8L22 11.5V18.5L16 22L10 18.5V11.5L16 8Z" fill="hsl(350 70% 33%)" opacity="0.5" />
        <circle cx="16" cy="15" r="3" fill="hsl(350 70% 33%)" />
      </svg>
    </div>
  );
}
