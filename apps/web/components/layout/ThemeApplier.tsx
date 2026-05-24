"use client";

import { useEffect } from "react";

import { useSettings } from "@/lib/stores/settings";

/**
 * Syncs the persisted Settings store with the DOM:
 *   - <html data-theme="..."> drives the CSS variables in globals.css.
 *   - <html data-density="..."> drives compact / comfortable spacing.
 *   - <html lang="..."> reflects the chosen locale.
 *
 * Mounted once near the top of the tree (inside Providers) so a single
 * source of truth controls everything.
 */
export function ThemeApplier() {
  const theme = useSettings((s) => s.theme);
  const density = useSettings((s) => s.density);
  const locale = useSettings((s) => s.locale);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("data-density", density);
  }, [density]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);

  return null;
}
