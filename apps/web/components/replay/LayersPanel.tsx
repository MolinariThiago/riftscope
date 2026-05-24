"use client";

import {
  Bomb,
  Clock,
  Compass,
  Crosshair,
  Flame,
  Footprints,
  Grid2x2,
  Image as ImageIcon,
  MapPin,
  Skull,
  Sparkles,
} from "lucide-react";

import { cn } from "@/lib/utils";
import type { ReplayLayers } from "@/components/replay/layers";

interface LayersPanelProps {
  layers: ReplayLayers;
  onChange: (next: ReplayLayers) => void;
}

const ITEMS: Array<{
  key: keyof ReplayLayers;
  label: string;
  icon: typeof MapPin;
  hint: string;
}> = [
  { key: "radarOverlay", label: "Radar", icon: ImageIcon, hint: "SimpleRadar / Valve radar image" },
  { key: "grid", label: "Grid", icon: Grid2x2, hint: "Procedural grid backdrop" },
  { key: "trajectories", label: "Paths", icon: Footprints, hint: "Per-player trail up to current time" },
  { key: "heatmap", label: "Heatmap", icon: Sparkles, hint: "Density of player presence over the round" },
  { key: "viewArrows", label: "View dir", icon: Compass, hint: "Direction each living player faces" },
  { key: "grenades", label: "Grenades", icon: Flame, hint: "Smoke / molotov / flash / he zones" },
  { key: "killMarkers", label: "Kills", icon: Skull, hint: "Skull marker at each kill location" },
  { key: "shots", label: "Shots", icon: Crosshair, hint: "Thin tracer line for every bullet fired" },
  { key: "bomb", label: "Bomb", icon: Bomb, hint: "Sticky planted-bomb marker" },
  {
    key: "showFreezeAndPost",
    label: "Pre/Post",
    icon: Clock,
    hint: "Include the freeze (buy time) + post-round periods in playback. Off = only the play period (round_freeze_end → round_end).",
  },
];

export function LayersPanel({ layers, onChange }: LayersPanelProps) {
  const toggle = (key: keyof ReplayLayers) =>
    onChange({ ...layers, [key]: !layers[key] });

  return (
    <div className="glass-card rounded-xl p-3">
      <h3 className="text-xs font-mono-rs uppercase tracking-wider text-muted-foreground mb-2 px-1">
        Layers
      </h3>
      <div className="grid grid-cols-2 gap-1.5">
        {ITEMS.map(({ key, label, icon: Icon, hint }) => {
          const active = layers[key];
          return (
            <button
              key={key}
              onClick={() => toggle(key)}
              title={hint}
              className={cn(
                "flex items-center gap-2 px-2.5 py-2 rounded-md text-xs transition-colors text-left",
                active
                  ? "bg-surface-elevated text-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated/50",
              )}
            >
              <Icon
                size={13}
                className={cn(
                  "flex-shrink-0",
                  active ? "text-primary" : "opacity-60",
                )}
              />
              <span className="truncate">{label}</span>
              <span
                className={cn(
                  "ml-auto w-1.5 h-1.5 rounded-full flex-shrink-0",
                  active ? "bg-primary" : "bg-border",
                )}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
