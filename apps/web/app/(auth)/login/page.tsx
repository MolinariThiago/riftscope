"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff, ArrowRight, Loader2, MessageCircle } from "lucide-react";
import { motion } from "framer-motion";

import { api } from "@/lib/api";
import { fadeUp, staggerContainer } from "@/components/landing/motion";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.auth.login({ email, password });
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = next || "/demos";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't sign in");
      setLoading(false);
    }
  };

  return (
    <motion.div className="space-y-7" variants={staggerContainer(0.08)} initial="hidden" animate="show">
      {/* Header */}
      <motion.div variants={fadeUp}>
        <Link href="/" className="font-display font-bold text-2xl tracking-tight inline-block mb-8">
          <span className="gradient-text">RIFT</span>
          <span className="text-foreground/80">SCOPE</span>
        </Link>
        <h1 className="text-2xl font-display font-bold">Welcome back</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sign in to access your demo analysis
        </p>
      </motion.div>

      {/* Steam — primary (only real auth path) */}
      <motion.button
        variants={fadeUp}
        type="button"
        onClick={() => {
          // Full-page redirect to the backend's Steam OpenID start
          // route. The backend 302s the browser to Steam's login
          // page; Steam then redirects back to
          // ``/auth/steam/callback`` (Next.js) which calls
          // ``/auth/steam/callback`` on the API to finish.
          window.location.href = api.auth.steam.loginUrl();
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full flex items-center justify-center gap-2.5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors glow-primary font-display"
      >
        <span className="text-base">🎮</span>
        Continue with Steam
      </motion.button>

      <motion.button
        variants={fadeUp}
        type="button"
        className="w-full flex items-center justify-center gap-2.5 py-2.5 border border-border rounded-lg text-sm text-foreground hover:bg-surface-elevated transition-colors"
      >
        <MessageCircle size={15} className="text-accent" />
        Continue with Discord
      </motion.button>

      {/* Divider */}
      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or sign in with email</span>
        <div className="flex-1 h-px bg-border" />
      </motion.div>

      {/* Form */}
      <motion.form variants={fadeUp} onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] transition-all"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
            Forgot password?
          </Link>
        </div>

        {error && (
          <div className="rounded-lg bg-loss/10 border border-loss/30 text-loss text-xs px-3 py-2">
            {error}
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-surface-elevated border border-border text-foreground rounded-lg font-semibold text-sm hover:border-primary/40 disabled:opacity-60 transition-all font-display"
        >
          {loading ? (
            <><Loader2 size={14} className="animate-spin" /> Signing in...</>
          ) : (
            <>Sign in <ArrowRight size={14} /></>
          )}
        </button>
      </motion.form>

      {/* Register link */}
      <motion.p variants={fadeUp} className="text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link href="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
          Sign up free
        </Link>
      </motion.p>
    </motion.div>
  );
}
