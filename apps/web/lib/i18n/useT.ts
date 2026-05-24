"use client";

import { useSettings } from "@/lib/stores/settings";
import { translate } from "@/lib/i18n/messages";

/**
 * Reactive translator hook.
 *
 *   const t = useT();
 *   t("nav.myDemos")            -> "Mis demos"
 */
export function useT() {
  const locale = useSettings((s) => s.locale);
  return (path: string) => translate(locale, path);
}
