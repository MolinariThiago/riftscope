/**
 * Shared layer-toggle definitions used by every renderer (SVG + Pixi) and
 * by the LayersPanel UI + Zustand settings store. Kept in a thin module so
 * we can hot-swap renderers without dragging React imports around.
 */

export interface ReplayLayers {
  callouts: boolean;
  sites: boolean;
  trajectories: boolean;
  heatmap: boolean;
  grenades: boolean;
  killMarkers: boolean;
  viewArrows: boolean;
  bomb: boolean;
  /** Show the SimpleRadar / Valve radar overlay as the canvas backdrop. */
  radarOverlay: boolean;
  /** Show the procedural grid backdrop. */
  grid: boolean;
}

export const DEFAULT_LAYERS: ReplayLayers = {
  callouts: true,
  sites: true,
  trajectories: false,
  heatmap: false,
  grenades: true,
  killMarkers: true,
  viewArrows: true,
  bomb: true,
  radarOverlay: true,
  grid: false,
};
