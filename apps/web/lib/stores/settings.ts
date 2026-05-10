"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

import { DEFAULT_LAYERS, type ReplayLayers } from "@/components/replay/layers";

// ---------------------------------------------------------------------------
// Theme + locale + replay + privacy preferences (persisted in localStorage).
// Backed up to the API once Steam auth ships; today it's client-only.
// ---------------------------------------------------------------------------

export type ThemeName =
  | "tactical-dark"
  | "hltv-classic"
  | "minimal-pro"
  | "light";
export type Locale = "en" | "es" | "pt";
export type Density = "comfortable" | "compact";
export type PlaybackSpeedDefault = 0.5 | 1 | 2 | 4;

export interface SettingsState {
  // Display
  theme: ThemeName;
  locale: Locale;
  density: Density;

  // Replay
  defaultPlaybackSpeed: PlaybackSpeedDefault;
  defaultLayers: ReplayLayers;
  autoPauseOnKill: boolean;
  killFeedFadeSeconds: number;

  // Notifications
  notifyOnDemoComplete: boolean;
  notifyOnNewProMatch: boolean;

  // Privacy
  profileVisibility: "public" | "friends" | "private";
  showInLeaderboards: boolean;

  // Integrations (linked accounts — stub until auth lands)
  steamLinked: boolean;
  faceitLinked: boolean;
  hltvProfileUrl: string | null;
}

interface SettingsActions {
  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  setLayers: (next: ReplayLayers) => void;
  reset: () => void;
}

const DEFAULTS: SettingsState = {
  theme: "tactical-dark",
  locale: "es",
  density: "comfortable",

  defaultPlaybackSpeed: 1,
  defaultLayers: DEFAULT_LAYERS,
  autoPauseOnKill: false,
  killFeedFadeSeconds: 6,

  notifyOnDemoComplete: true,
  notifyOnNewProMatch: false,

  profileVisibility: "public",
  showInLeaderboards: true,

  steamLinked: false,
  faceitLinked: false,
  hltvProfileUrl: null,
};

export const useSettings = create<SettingsState & SettingsActions>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      setLayers: (next) => set({ defaultLayers: next }),
      reset: () => set(DEFAULTS),
    }),
    {
      name: "riftscope-settings",
      version: 1,
    },
  ),
);
