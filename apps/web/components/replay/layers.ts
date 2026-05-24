/**
 * Shared layer-toggle definitions used by every renderer (SVG + Pixi) and
 * by the LayersPanel UI + Zustand settings store. Kept in a thin module so
 * we can hot-swap renderers without dragging React imports around.
 */

export interface ReplayLayers {
  trajectories: boolean;
  heatmap: boolean;
  grenades: boolean;
  killMarkers: boolean;
  /** Thin tracer rays for every weapon_fire event in the round. */
  shots: boolean;
  viewArrows: boolean;
  bomb: boolean;
  /** Show the SimpleRadar / Valve radar overlay as the canvas backdrop. */
  radarOverlay: boolean;
  /** Show the procedural grid backdrop. */
  grid: boolean;
  /**
   * Include the FREEZE (pre-round buy time) + POST (post-round
   * freeze) windows in the playback scrub range. When false,
   * playback is clamped to the actual play period (round_freeze_end
   * → round_end) and the freeze + post seconds are unreachable.
   * Default ON — matches the user's expectation that the round
   * should be visible "completa" including freeze and end time.
   */
  showFreezeAndPost: boolean;
}

export const DEFAULT_LAYERS: ReplayLayers = {
  trajectories: false,
  heatmap: false,
  grenades: true,
  killMarkers: true,
  shots: true,
  viewArrows: true,
  bomb: true,
  radarOverlay: true,
  grid: false,
  showFreezeAndPost: true,
};
