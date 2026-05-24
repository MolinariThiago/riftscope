"use client";

import Link from "next/link";
import Image from "next/image";
import { Bell, LogOut, Palette, Search, User } from "lucide-react";

import { api } from "@/lib/api";
import { useT } from "@/lib/i18n/useT";
import { useAuthStore } from "@/lib/stores/auth";
import { useSettings, type ThemeName } from "@/lib/stores/settings";

const THEME_CYCLE: ThemeName[] = [
  "tactical-dark",
  "hltv-classic",
  "minimal-pro",
  "light",
];

export function TopBar() {
  const t = useT();
  const theme = useSettings((s) => s.theme);
  const setSetting = useSettings((s) => s.set);
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

  const cycleTheme = () => {
    const idx = THEME_CYCLE.indexOf(theme);
    const next = THEME_CYCLE[(idx + 1) % THEME_CYCLE.length];
    setSetting("theme", next);
  };

  return (
    <header className="h-16 border-b border-border bg-surface/50 backdrop-blur-sm flex items-center px-6 gap-4 flex-shrink-0">
      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            placeholder={`${t("nav.myDemos")}, ${t("nav.players")}…`}
            className="w-full bg-surface-elevated border border-border rounded-lg pl-9 pr-4 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50 transition-colors"
          />
          <kbd className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground font-mono-rs bg-surface px-1.5 py-0.5 rounded border border-border">
            ⌘K
          </kbd>
        </div>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        {/* Quick theme cycle */}
        <button
          onClick={cycleTheme}
          title={`Theme: ${theme}`}
          className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors"
        >
          <Palette size={16} />
        </button>

        {/* Notifications */}
        <button className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors">
          <Bell size={16} />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-primary rounded-full" />
        </button>

        {/* Auth area: Steam-logged-in user or Sign-in CTA.
            Signed in: Steam avatar + name → /profile, with a sibling
              logout button.
            Signed out: a single "Iniciar sesión con Steam" button that
              redirects the browser to the backend's Steam OpenID start
              route (full-page nav, NOT a fetch). */}
        {user ? (
          <>
            <Link
              href="/profile"
              className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-elevated transition-colors"
              title={user.steam_id ? `Steam ID: ${user.steam_id}` : undefined}
            >
              <div className="w-7 h-7 rounded-full bg-primary-dim flex items-center justify-center overflow-hidden">
                {user.avatar_url ? (
                  <Image
                    src={user.avatar_url}
                    alt={user.name ?? "Steam avatar"}
                    width={28}
                    height={28}
                    className="w-full h-full object-cover"
                    unoptimized
                  />
                ) : (
                  <User size={14} className="text-primary" />
                )}
              </div>
              <span className="text-sm text-foreground max-w-[160px] truncate">
                {user.name ?? user.username ?? "Profile"}
              </span>
              {user.is_admin && (
                <span className="text-[10px] font-mono-rs uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary/15 text-primary">
                  ADMIN
                </span>
              )}
            </Link>
            <button
              onClick={() => {
                logout().then(() => {
                  // Refresh the page so the now-empty auth state
                  // propagates everywhere (and any server-rendered
                  // route guards re-evaluate).
                  window.location.href = "/demos";
                });
              }}
              title="Cerrar sesión"
              className="p-2 rounded-lg text-muted-foreground hover:text-loss hover:bg-surface-elevated transition-colors"
            >
              <LogOut size={16} />
            </button>
          </>
        ) : (
          <a
            href={api.auth.steam.loginUrl()}
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-semibold bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <span>🎮</span>
            Iniciar sesión con Steam
          </a>
        )}
      </div>
    </header>
  );
}
