"use client";

import { create } from "zustand";

/**
 * Floating upload popover — global open/close state.
 *
 * Lives in its own store (not in a parent component) so any button
 * anywhere in the app — sidebar, /demos list, future hotkeys — can
 * trigger the same popover without prop-drilling a callback. The
 * popover itself reads the state and renders into the dashboard
 * layout, so a single instance is on screen at any time.
 */
interface UploadPopoverState {
  open: boolean;
  /** Optional anchor for positioning — DOMRect of the trigger button. */
  anchor: { x: number; y: number } | null;
  show: (anchor?: { x: number; y: number } | null) => void;
  hide: () => void;
  toggle: (anchor?: { x: number; y: number } | null) => void;
}

export const useUploadPopover = create<UploadPopoverState>((set, get) => ({
  open: false,
  anchor: null,
  show: (anchor = null) => set({ open: true, anchor }),
  hide: () => set({ open: false }),
  toggle: (anchor = null) =>
    set(get().open ? { open: false } : { open: true, anchor }),
}));
