"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, Loader2, Eye, EyeOff } from "lucide-react";

export default function RegisterPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
    window.location.href = "/demos";
  };

  return (
    <div className="space-y-8">
      <div>
        <Link href="/" className="font-display font-bold text-2xl tracking-tight block mb-8">
          <span className="gradient-text">RIFT</span>
          <span className="text-foreground/80">SCOPE</span>
        </Link>
        <h1 className="text-2xl font-display font-bold">Create your account</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Start analyzing demos for free. No credit card required.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">First name</label>
            <input
              type="text"
              required
              placeholder="Alex"
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Last name</label>
            <input
              type="text"
              placeholder="Smith"
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Username</label>
          <input
            type="text"
            required
            placeholder="fraghero99"
            className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Email</label>
          <input
            type="email"
            required
            placeholder="you@example.com"
            className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              minLength={8}
              placeholder="Min. 8 characters"
              className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
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

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-60 transition-all glow-primary font-display"
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
      </form>

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="text-primary hover:text-primary/80 font-medium transition-colors">
          Sign in
        </Link>
      </p>
    </div>
  );
}
