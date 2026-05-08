"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "bg-background/90 backdrop-blur-xl border-b border-border/50" : ""
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 relative">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M16 2L28 8V16L16 22L4 16V8L16 2Z" stroke="hsl(185 100% 52%)" strokeWidth="1.5" fill="hsl(185 100% 52% / 0.1)" />
              <path d="M16 8L22 11.5V18.5L16 22L10 18.5V11.5L16 8Z" fill="hsl(185 100% 52%)" opacity="0.5" />
              <circle cx="16" cy="15" r="3" fill="hsl(185 100% 52%)" />
              <path d="M16 2V8M28 8L22 11.5M28 16L22 18.5M16 22V28M4 16L10 18.5M4 8L10 11.5" stroke="hsl(185 100% 52%)" strokeWidth="1" opacity="0.4" />
            </svg>
          </div>
          <span className="font-display font-bold text-xl tracking-tight">
            <span className="gradient-text">RIFT</span>
            <span className="text-foreground/80">SCOPE</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          <NavLink href="#features">Features</NavLink>
          <NavLink href="#pricing">Pricing</NavLink>
          <NavLink href="/docs">Docs</NavLink>
          <NavLink href="/blog">Blog</NavLink>
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-2"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="text-sm font-semibold px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-all duration-200 glow-primary"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Get Started
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-muted-foreground p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-surface border-b border-border px-6 py-4 flex flex-col gap-3">
          <NavLink href="#features" mobile>Features</NavLink>
          <NavLink href="#pricing" mobile>Pricing</NavLink>
          <NavLink href="/docs" mobile>Docs</NavLink>
          <div className="pt-2 flex flex-col gap-2">
            <Link href="/login" className="text-sm text-center py-2.5 border border-border rounded-lg text-foreground">Sign in</Link>
            <Link href="/register" className="text-sm font-semibold text-center py-2.5 bg-primary text-primary-foreground rounded-lg">Get Started</Link>
          </div>
        </div>
      )}
    </nav>
  );
}

function NavLink({ href, children, mobile }: { href: string; children: React.ReactNode; mobile?: boolean }) {
  return (
    <Link
      href={href}
      className={`text-sm text-muted-foreground hover:text-foreground transition-colors ${
        mobile ? "py-2" : ""
      }`}
    >
      {children}
    </Link>
  );
}
