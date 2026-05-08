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
 * Drives the 2D replay viewer.
 *
 * - Uses requestAnimationFrame to advance `time` smoothly while playing.
 * - Interpolates linearly between adjacent frames so motion is smooth even
 *   if the timeline is sampled at 10 FPS.
 * - Auto-pauses when the round ends; calling play() again resets to 0.
 */
export function useRoundPlayback(timeline: RoundTimeline | null | undefined) {
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);

  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const timelineRef = useRef(timeline);
  const speedRef = useRef(speed);

  // Keep refs in sync without retriggering rAF effect
  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  // Reset when the timeline changes (different round selected)
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    lastTickRef.current = null;
  }, [timeline?.roundNumber]);

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
        if (tl) {
          setTime((prev) => {
            const next = prev + dt * speedRef.current;
            if (next >= tl.durationSeconds) {
              setPlaying(false);
              return tl.durationSeconds;
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

  const play = useCallback(() => {
    setPlaying((wasPlaying) => {
      if (wasPlaying) return wasPlaying;
      const tl = timelineRef.current;
      // If at the end, restart from 0
      if (tl && time >= tl.durationSeconds - 0.05) {
        setTime(0);
      }
      return true;
    });
  }, [time]);

  const pause = useCallback(() => setPlaying(false), []);

  const toggle = useCallback(() => {
    setPlaying((p) => {
      const tl = timelineRef.current;
      if (!p && tl && time >= tl.durationSeconds - 0.05) setTime(0);
      return !p;
    });
  }, [time]);

  const seek = useCallback((t: number) => {
    const tl = timelineRef.current;
    if (!tl) return;
    setTime(Math.max(0, Math.min(tl.durationSeconds, t)));
    lastTickRef.current = null;
  }, []);

  const step = useCallback((dt: number) => {
    const tl = timelineRef.current;
    if (!tl) return;
    setTime((prev) => Math.max(0, Math.min(tl.durationSeconds, prev + dt)));
    lastTickRef.current = null;
  }, []);

  const reset = useCallback(() => {
    setTime(0);
    setPlaying(false);
    lastTickRef.current = null;
  }, []);

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
  const i0 = Math.max(0, Math.min(timeline.frames.length - 1, Math.floor(exact)));
  const i1 = Math.min(timeline.frames.length - 1, i0 + 1);
  const alpha = exact - i0;

  const f0 = timeline.frames[i0];
  const f1 = timeline.frames[i1];

  // Interpolate per player by steamId (the order is stable but be safe)
  const i1Map = new Map(f1.players.map((p) => [p.steamId, p]));

  const players = f0.players.map((p0) => {
    const p1 = i1Map.get(p0.steamId) ?? p0;
    return {
      ...p0,
      x: p0.x + (p1.x - p0.x) * alpha,
      y: p0.y + (p1.y - p0.y) * alpha,
      // Keep alive=false sticky (a player who died stays dead)
      alive: p0.alive && p1.alive,
    };
  });

  return { t: time, players };
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
