"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { Menu, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

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
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-3 group">
          <div className="w-8 h-8 relative transition-transform duration-300 group-hover:scale-105">
            <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
              <path d="M16 2L28 8V16L16 22L4 16V8L16 2Z" stroke="hsl(350 70% 33%)" strokeWidth="1.5" fill="hsl(350 70% 33% / 0.1)" />
              <path d="M16 8L22 11.5V18.5L16 22L10 18.5V11.5L16 8Z" fill="hsl(350 70% 33%)" opacity="0.5" />
              <circle cx="16" cy="15" r="3" fill="hsl(350 70% 33%)" />
            </svg>
          </div>
          <span className="font-display font-bold text-xl tracking-tight">
            <span className="gradient-text">RIFT</span>
            <span className="text-foreground/80">SCOPE</span>
          </span>
        </Link>

        {/* Desktop nav */}
        <div className="hidden md:flex items-center gap-8">
          <NavLink href="#replay">Visor 2D</NavLink>
          <NavLink href="#features">Funciones</NavLink>
          <NavLink href="/docs">Docs</NavLink>
        </div>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <Link
            href="/login"
            className="text-sm text-muted-foreground hover:text-foreground transition-colors px-4 py-2"
          >
            Iniciar sesión
          </Link>
          <Link
            href="/login"
            className="text-sm font-semibold px-5 py-2.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors duration-200"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Comenzar
          </Link>
        </div>

        {/* Mobile toggle */}
        <button
          className="md:hidden text-muted-foreground p-2"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle menu"
        >
          {mobileOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            className="md:hidden overflow-hidden bg-surface border-b border-border"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="px-6 py-4 flex flex-col gap-3">
              <NavLink href="#replay" mobile onClick={() => setMobileOpen(false)}>Visor 2D</NavLink>
              <NavLink href="#features" mobile onClick={() => setMobileOpen(false)}>Funciones</NavLink>
              <NavLink href="/docs" mobile onClick={() => setMobileOpen(false)}>Docs</NavLink>
              <div className="pt-2 flex flex-col gap-2">
                <Link href="/login" className="text-sm text-center py-2.5 border border-border rounded-lg text-foreground">Iniciar sesión</Link>
                <Link href="/login" className="text-sm font-semibold text-center py-2.5 bg-primary text-primary-foreground rounded-lg">Comenzar</Link>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function NavLink({
  href,
  children,
  mobile,
  onClick,
}: {
  href: string;
  children: React.ReactNode;
  mobile?: boolean;
  onClick?: () => void;
}) {
  return (
    <Link
      href={href}
      onClick={onClick}
      className={`text-sm text-muted-foreground hover:text-foreground transition-colors ${
        mobile ? "py-2" : "link-underline"
      }`}
    >
      {children}
    </Link>
  );
}
