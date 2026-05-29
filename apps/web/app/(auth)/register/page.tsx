"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";
import { motion } from "framer-motion";

import { api } from "@/lib/api";
import { fadeUp, staggerContainer } from "@/components/landing/motion";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const fallbackName = [firstName, lastName].filter(Boolean).join(" ").trim();
      await api.auth.register({
        email,
        password,
        username: username.trim() || fallbackName || undefined,
      });
      window.location.href = "/demos";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create your account");
      setLoading(false);
    }
  };

  return (
    <motion.div className="space-y-7" variants={staggerContainer(0.07)} initial="hidden" animate="show">
      <motion.div variants={fadeUp}>
        <Link href="/" className="font-display font-bold text-2xl tracking-tight inline-block mb-8">
          <span className="gradient-text">RIFT</span>
          <span className="text-foreground/80">SCOPE</span>
        </Link>
        <h1 className="text-2xl font-display font-bold">Create your account</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Start analyzing demos for free. No credit card required.
        </p>
      </motion.div>

      {/* Steam — fastest path (creates an account on first login) */}
      <motion.button
        variants={fadeUp}
        type="button"
        onClick={() => {
          window.location.href = api.auth.steam.loginUrl();
        }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className="w-full flex items-center justify-center gap-2.5 py-3 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 transition-colors glow-primary font-display"
      >
        <span className="text-base">🎮</span>
        Sign up with Steam
      </motion.button>

      <motion.div variants={fadeUp} className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or with email</span>
        <div className="flex-1 h-px bg-border" />
      </motion.div>

      <motion.form variants={fadeUp} onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">First name</label>
            <input
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Alex"
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] transition-all"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Last name</label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Smith"
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] transition-all"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Username</label>
          <input
            type="text"
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="fraghero99"
            className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 focus:shadow-[0_0_0_3px_hsl(var(--primary)/0.12)] transition-all"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Email</label>
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
          <label className="text-sm font-medium">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min. 8 characters"
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
            <><Loader2 size={14} className="animate-spin" /> Creating account...</>
          ) : (
            <>Create free account <ArrowRight size={14} /></>
          )}
        </button>

        <p className="text-xs text-muted-foreground text-center">
          By signing up you agree to our{" "}
          <Link href="/terms" className="text-primary hover:underline">Terms</Link> and{" "}
          <Link href="/privacy" className="text-primary hover:underline">Privacy Policy</Link>.
        </p>
      </motion.form>

      <motion.p variants={fadeUp} className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
          Sign in
        </Link>
      </motion.p>
    </motion.div>
  );
}
