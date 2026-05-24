"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RoundTimeline, TimelineEvent, TimelineFrame } from "@/types/demo";

export type PlaybackSpeed = 0.5 | 1 | 2 | 4;

export interface PlaybackState {
  /** seconds since round start */
  time: number;
  playing: boolean;
  speed: PlaybackSpeed;
  /** interpolated frame at the current time, or null while loading */
  currentFrame: TimelineFrame | null;
  /** events that occurred at or before `time` */
  pastEvents: TimelineEvent[];
  /** events still scheduled in the future */
  futureEvents: TimelineEvent[];
  /** discrete frame index closest to time (helpful for keys) */
  frameIndex: number;
}

export interface PlaybackControls {
  play: () => void;
  pause: () => void;
  toggle: () => void;
  seek: (t: number) => void;
  step: (deltaSeconds: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
  reset: () => void;
}

/**
 * Optional override that clamps playback to a sub-range of the
 * timeline. When set, ``time`` is held inside ``[startT, endT]``,
 * play() restarts from ``startT`` (instead of 0) when at the end,
 * and the rAF loop auto-pauses at ``endT``.
 *
 * Used by the replay page to skip the freeze + post windows when
 * the user toggles off the "show pre/post round" layer — the
 * full extended timeline is always loaded, this just chooses
 * which slice of it is reachable via playback / scrubbing.
 */
export interface PlayableRange {
  startT: number;
  endT: number;
}

/**
 * Drives the 2D replay viewer.
 *
 * - Uses requestAnimationFrame to advance `time` smoothly while playing.
 * - Interpolates linearly between adjacent frames so motion is smooth even
 *   if the timeline is sampled at 10 FPS.
 * - Auto-pauses when the round ends; calling play() again resets to start.
 * - When ``playableRange`` is provided, clamps time + auto-pause to that
 *   sub-range instead of [0, durationSeconds].
 */
export function useRoundPlayback(
  timeline: RoundTimeline | null | undefined,
  playableRange?: PlayableRange,
) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const timelineRef = useRef(timeline);
  const speedRef = useRef(speed);
  const rangeRef = useRef<PlayableRange | undefined>(playableRange);

  // Effective playback range. Falls back to the full timeline when
  // no override is provided. Computed once per render to keep
  // seek/clamp callbacks consistent.
  const effRangeStart = playableRange?.startT ?? 0;
  const effRangeEnd =
    playableRange?.endT ?? timeline?.durationSeconds ?? 0;

  // Keep refs in sync without retriggering rAF effect
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);
  useEffect(() => {
    rangeRef.current = playableRange;
  }, [playableRange]);

  // Reset when the timeline changes (different round selected).
  // Starts at the range's startT so toggling "skip freeze" lands
  // the user on the round_freeze_end frame instead of t=0.
  useEffect(() => {
    setTime(rangeRef.current?.startT ?? 0);
    setPlaying(false);
    lastTickRef.current = null;
  }, [timeline?.roundNumber]);

  // When the user toggles the freeze/post layer mid-round, snap
  // the current time back into the new range if it's outside.
  // Without this, scrubbing while in the freeze window then
  // toggling "skip freeze" off would leave time stuck at e.g.
  // 5 s while the new range starts at 20 s.
  useEffect(() => {
    setTime((prev) => {
      if (prev < effRangeStart) return effRangeStart;
      if (prev > effRangeEnd) return effRangeEnd;
      return prev;
    });
  }, [effRangeStart, effRangeEnd]);

  // rAF loop
  useEffect(() => {
    if (!playing) {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTickRef.current = null;
      return;
    }

    const tick = (now: number) => {
      const last = lastTickRef.current;
      lastTickRef.current = now;
      if (last !== null) {
        const dt = (now - last) / 1000;
        const tl = timelineRef.current;
        const r = rangeRef.current;
        const rangeEnd = r?.endT ?? tl?.durationSeconds ?? 0;
        if (tl) {
          setTime((prev) => {
            const next = prev + dt * speedRef.current;
            if (next >= rangeEnd) {
              setPlaying(false);
              return rangeEnd;
            }
            return next;
          });
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing]);

  // ----------------- derived state -----------------

  const currentFrame = useCurrentFrame(timeline, time);
  const { pastEvents, futureEvents } = useEventBuckets(timeline, time);
  const frameIndex = timeline ? Math.min(timeline.frames.length - 1, Math.floor(time * timeline.fps)) : 0;

  // ----------------- controls -----------------

  // Resolve the playable range as a (start, end) pair, honouring
  // the override when present. Defined inside each callback so
  // the ref read is always current — no stale closure capture.
  const resolveRange = useCallback((): [number, number] => {
    const tl = timelineRef.current;
    const r = rangeRef.current;
    return [
      r?.startT ?? 0,
      r?.endT ?? tl?.durationSeconds ?? 0,
    ];
  }, []);

  const play = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) return wasPlaying;
      const [, rangeEnd] = resolveRange();
      const [rangeStart] = resolveRange();
      // If at the end of the playable range, restart from start.
      if (time >= rangeEnd - 0.05) {
        setTime(rangeStart);
      }
      return true;
    });
  }, [time, resolveRange]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      const [rangeStart, rangeEnd] = resolveRange();
      if (!p && time >= rangeEnd - 0.05) setTime(rangeStart);
      return !p;
    });
  }, [time, resolveRange]);

  const seek = useCallback((t: number) => {
    const [rangeStart, rangeEnd] = resolveRange();
    setTime(Math.max(rangeStart, Math.min(rangeEnd, t)));
    lastTickRef.current = null;
  }, [resolveRange]);

  const step = useCallback((dt: number) => {
    const [rangeStart, rangeEnd] = resolveRange();
    setTime((prev) => Math.max(rangeStart, Math.min(rangeEnd, prev + dt)));
    lastTickRef.current = null;
  }, [resolveRange]);

  const reset = useCallback(() => {
    const [rangeStart] = resolveRange();
    setTime(rangeStart);
    setPlaying(false);
    lastTickRef.current = null;
  }, [resolveRange]);

  const state: PlaybackState = {
    time,
    playing,
    speed,
    currentFrame,
    pastEvents,
    futureEvents,
    frameIndex,
  };

  const controls: PlaybackControls = {
    play,
    pause,
    toggle,
    seek,
    step,
    setSpeed,
    reset,
  };

  return [state, controls] as const;
}

// =========================================================================
// Helpers
// =========================================================================

function useCurrentFrame(
  timeline: RoundTimeline | null | undefined,
  time: number,
): TimelineFrame | null {
  if (!timeline || timeline.frames.length === 0) return null;

  const fps = timeline.fps;
  const exact = time * fps;
  // Four adjacent samples for Catmull-Rom: f_-1, f0, f1, f2. At fps=10
  // each sample is 100 ms apart, so linear interp produced a visible
  // "elbow" every 100 ms where the player suddenly changed direction.
  // Catmull-Rom uses the surrounding two samples to smooth the curve —
  // motion looks natural even at 10 Hz source data.
  const total = timeline.frames.length - 1;
  const i0 = Math.max(0, Math.min(total, Math.floor(exact)));
  const i1 = Math.min(total, i0 + 1);
  const im = Math.max(0, i0 - 1);
  const i2 = Math.min(total, i1 + 1);
  const alpha = exact - i0;

  const fm = timeline.frames[im];
  const f0 = timeline.frames[i0];
  const f1 = timeline.frames[i1];
  const f2 = timeline.frames[i2];

  // Index neighbouring frames by steamId so we can recover each player's
  // four-sample window in O(1).
  const fmMap = new Map(fm.players.map((p) => [p.steamId, p]));
  const f1Map = new Map(f1.players.map((p) => [p.steamId, p]));
  const f2Map = new Map(f2.players.map((p) => [p.steamId, p]));

  const players = f0.players.map((p0) => {
    const pm = fmMap.get(p0.steamId) ?? p0;
    const p1 = f1Map.get(p0.steamId) ?? p0;
    const p2 = f2Map.get(p0.steamId) ?? p1;

    // Catmull-Rom spline (uniform parameterization). Produces smooth
    // curves through the four control points while passing exactly
    // through p0 at alpha=0 and p1 at alpha=1.
    const x = catmullRom(pm.x, p0.x, p1.x, p2.x, alpha);
    const y = catmullRom(pm.y, p0.y, p1.y, p2.y, alpha);

    // Yaw needs shortest-arc lerp — a player rotating from 350° → 10°
    // should sweep +20° not -340°. Linear interp on raw degrees flips
    // the model.
    const yaw = lerpAngle(p0.yaw ?? 0, p1.yaw ?? p0.yaw ?? 0, alpha);

    return {
      ...p0,
      x,
      y,
      yaw,
      // Take the CURRENT frame's alive flag. Using ``p0.alive && p1.alive``
      // looked safer ("once dead, stay dead") but produced a much worse
      // artefact: when a player dies mid-interval (between p0 and p1),
      // ``p1.alive`` is already false, so the AND clause flipped them to
      // dead at the very start of the interval — sometimes up to 100 ms
      // before the actual kill event fired. The X mark would appear on
      // the radar a tenth of a second before the kill itself.
      //
      // With ``p0.alive`` the transition lags by at most one frame
      // (the death is reflected on the NEXT 100 ms sample) which is
      // imperceptible. The sticky-dead invariant is preserved by the
      // demo data itself — CS2 players don't respawn mid-round.
      alive: p0.alive,
    };
  });

  return { t: time, players };
}

/**
 * Catmull-Rom interpolation between p1 and p2 with p0/p3 as outer
 * control points. ``t`` ∈ [0, 1]. When p0=p1 or p2=p3 the spline
 * degrades gracefully to linear at the endpoint, so we don't need
 * special-casing for the first/last frame.
 */
function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

/** Lerp between two angles (degrees) along the shortest path. */
function lerpAngle(a: number, b: number, t: number): number {
  let diff = ((b - a) % 360 + 540) % 360 - 180;  // -180..180
  return a + diff * t;
}

function useEventBuckets(
  timeline: RoundTimeline | null | undefined,
  time: number,
) {
  if (!timeline) {
    return { pastEvents: [] as TimelineEvent[], futureEvents: [] as TimelineEvent[] };
  }
  const past: TimelineEvent[] = [];
  const future: TimelineEvent[] = [];
  for (const e of timeline.events) {
    if (e.t <= time) past.push(e);
    else future.push(e);
  }
  return { pastEvents: past, futureEvents: future };
}
