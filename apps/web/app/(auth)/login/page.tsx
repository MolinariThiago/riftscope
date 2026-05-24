"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, EyeOff, ArrowRight, Loader2 } from "lucide-react";

import { api } from "@/lib/api";

export default function LoginPage() {
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // Will connect to NextAuth in Phase 2
    await new Promise((r) => setTimeout(r, 1200));
    setLoading(false);
    window.location.href = "/demos";
  };

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <Link href="/" className="font-display font-bold text-2xl tracking-tight block mb-8">
          <span className="gradient-text">RIFT</span>
          <span className="text-foreground/80">SCOPE</span>
        </Link>
        <h1 className="text-2xl font-display font-bold">Welcome back</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Sign in to access your demo analysis
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Email</label>
          <input
            type="email"
            required
            placeholder="you@example.com"
            className="w-full bg-surface border border-border rounded-lg px-4 py-2.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium text-foreground">Password</label>
          <div className="relative">
            <input
              type={showPassword ? "text" : "password"}
              required
              placeholder="••••••••"
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

        <div className="flex justify-end">
          <Link href="/forgot-password" className="text-xs text-primary hover:text-primary/80 transition-colors">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-lg font-semibold text-sm hover:bg-primary/90 disabled:opacity-60 transition-all glow-primary font-display"
        >
          {loading ? (
            <><Loader2 size={14} className="animate-spin" /> Signing in...</>
          ) : (
            <>Sign in <ArrowRight size={14} /></>
          )}
        </button>
      </form>

      {/* Divider */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border" />
        <span className="text-xs text-muted-foreground">or continue with</span>
        <div className="flex-1 h-px bg-border" />
      </div>

      {/* OAuth */}
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => {
            // Full-page redirect to the backend's Steam OpenID start
            // route. The backend 302s the browser to Steam's login
            // page; Steam then redirects back to
            // ``/auth/steam/callback`` (Next.js) which calls
            // ``/auth/steam/callback`` on the API to finish.
            window.location.href = api.auth.steam.loginUrl();
          }}
          className="flex items-center justify-center gap-2 py-2.5 border border-border rounded-lg text-sm text-foreground hover:bg-surface-elevated transition-colors"
        >
          <span>🎮</span>
          Steam
        </button>
        <OAuthButton provider="Discord" icon="💬" />
      </div>

      {/* Register link */}
      <p className="text-center text-sm text-muted-foreground">
        Don't have an account?{" "}
        <Link href="/register" className="text-primary hover:text-primary/80 font-medium transition-colors">
          Sign up free
        </Link>
      </p>
    </div>
  );
}

function OAuthButton({ provider, icon }: { provider: string; icon: string }) {
  return (
    <button className="flex items-center justify-center gap-2 py-2.5 border border-border rounded-lg text-sm text-foreground hover:bg-surface-elevated transition-colors">
      <span>{icon}</span>
      {provider}
    </button>
  );
}
