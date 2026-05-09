"use client";

import Link from "next/link";
import { Bell, ChevronDown, Palette, Search, User } from "lucide-react";

import { useT } from "@/lib/i18n/useT";
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

        {/* Avatar → /profile */}
        <Link
          href="/profile"
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-surface-elevated transition-colors"
        >
          <div className="w-7 h-7 rounded-full bg-primary-dim flex items-center justify-center">
            <User size={14} className="text-primary" />
          </div>
          <span className="text-sm text-foreground">{t("nav.profile")}</span>
          <ChevronDown size={12} className="text-muted-foreground" />
        </Link>
      </div>
    </header>
  );
}
