"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Minus, Square, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Fully customizable floating panel — the user can:
 *   • drag it anywhere on screen (mousedown on the header)
 *   • resize from the bottom-right corner
 *   • adjust opacity via the slider in the header
 *   • collapse / expand
 *   • hide entirely (X)
 *
 * State is persisted to localStorage keyed by ``id`` so each panel keeps
 * its position, size, and opacity across reloads. Initial defaults come
 * from the ``defaults`` prop; if the persisted geometry would put the
 * panel off-screen we clamp it back into view.
 */
export interface FloatingPanelState {
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  collapsed: boolean;
  hidden: boolean;
}

interface FloatingPanelProps {
  id: string; // unique key for localStorage
  title: string;
  defaults: Partial<FloatingPanelState> & { x: number; y: number; w: number; h: number };
  minWidth?: number;
  minHeight?: number;
  /** When true, the panel will not render at all if `hidden` is set. */
  closable?: boolean;
  /** Optional callback when the panel is closed via the X button. */
  onClose?: () => void;
  /**
   * When true, the panel renders WITHOUT chrome (no header / no drag /
   * no resize / no opacity slider) — the user can't move or hide it.
   * This is the default UX for the replay HUD; flipping this to `false`
   * via the settings toggle exposes the customization controls.
   *
   * In locked mode, position + size always come from `defaults` (not
   * from the persisted state), so the layout is deterministic.
   */
  locked?: boolean;
  /**
   * When true, fully omit the panel chrome AND any background/border.
   * Useful for content that already has its own card styling (e.g. the
   * team loadout cards). The panel just acts as a positioner.
   */
  transparent?: boolean;
  children: React.ReactNode;
  className?: string;
}

// Version suffix in the storage key prefix. Bumping invalidates all
// previously-saved panel positions so layout-wide overhauls (e.g.
// hiding the TopBar on the replay route) take effect without users
// having to manually reset every panel they had moved.
const STORAGE_KEY_PREFIX = "riftscope.panel.v2.";

function loadState(id: string, defaults: FloatingPanelState): FloatingPanelState {
  if (typeof window === "undefined") return defaults;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_PREFIX + id);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<FloatingPanelState>;
    return {
      x: typeof parsed.x === "number" ? parsed.x : defaults.x,
      y: typeof parsed.y === "number" ? parsed.y : defaults.y,
      w: typeof parsed.w === "number" ? parsed.w : defaults.w,
      h: typeof parsed.h === "number" ? parsed.h : defaults.h,
      opacity: typeof parsed.opacity === "number" ? parsed.opacity : defaults.opacity,
      collapsed: typeof parsed.collapsed === "boolean" ? parsed.collapsed : defaults.collapsed,
      hidden: typeof parsed.hidden === "boolean" ? parsed.hidden : defaults.hidden,
    };
  } catch {
    return defaults;
  }
}

function saveState(id: string, state: FloatingPanelState) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY_PREFIX + id, JSON.stringify(state));
  } catch {
    /* quota exceeded — ignore */
  }
}

function clampToViewport(s: FloatingPanelState, minW: number, minH: number): FloatingPanelState {
  if (typeof window === "undefined") return s;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(minW, Math.min(s.w, vw - 20));
  const h = Math.max(minH, Math.min(s.h, vh - 20));
  // Keep at least 80px of the header visible so the user can always grab it.
  const x = Math.max(-(w - 80), Math.min(s.x, vw - 80));
  const y = Math.max(0, Math.min(s.y, vh - 30));
  return { ...s, x, y, w, h };
}

export function FloatingPanel({
  id,
  title,
  defaults,
  minWidth = 220,
  minHeight = 120,
  closable = true,
  onClose,
  locked = false,
  transparent = false,
  children,
  className,
}: FloatingPanelProps) {
  const fullDefaults: FloatingPanelState = {
    opacity: 0.92,
    collapsed: false,
    hidden: false,
    ...defaults,
  };

  const [state, setState] = useState<FloatingPanelState>(fullDefaults);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from localStorage AFTER mount — avoids SSR/CSR drift since the
  // server has no window/localStorage.
  useEffect(() => {
    const loaded = clampToViewport(loadState(id, fullDefaults), minWidth, minHeight);
    setState(loaded);
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Persist whenever the user-controlled bits change (after hydration).
  useEffect(() => {
    if (!hydrated) return;
    saveState(id, state);
  }, [id, hydrated, state]);

  // -------------- drag --------------
  const dragRef = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const onHeaderDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: state.x,
      baseY: state.y,
    };
  };
  const onHeaderMove = (e: React.PointerEvent) => {
    // Snapshot the ref BEFORE the async setState. React may run the
    // updater on a later tick by which point dragRef.current may have
    // been cleared by onHeaderUp (especially when the pointerup lands
    // outside the captured element), which produced
    // "Cannot read properties of null (reading 'baseX')".
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    const nextX = d.baseX + dx;
    const nextY = d.baseY + dy;
    setState((s) => clampToViewport(
      { ...s, x: nextX, y: nextY },
      minWidth, minHeight,
    ));
  };
  const onHeaderUp = (e: React.PointerEvent) => {
    if (dragRef.current) {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    }
    dragRef.current = null;
  };

  // -------------- resize --------------
  const resizeRef = useRef<{ startX: number; startY: number; baseW: number; baseH: number } | null>(null);
  const onResizeDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    resizeRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseW: state.w,
      baseH: state.h,
    };
  };
  const onResizeMove = (e: React.PointerEvent) => {
    // Same snapshot trick as the drag handler — resizeRef can be cleared
    // by the next event loop tick before React applies the updater.
    const r = resizeRef.current;
    if (!r) return;
    const dw = e.clientX - r.startX;
    const dh = e.clientY - r.startY;
    const nextW = r.baseW + dw;
    const nextH = r.baseH + dh;
    setState((s) => clampToViewport(
      { ...s, w: nextW, h: nextH },
      minWidth, minHeight,
    ));
  };
  const onResizeUp = (e: React.PointerEvent) => {
    if (resizeRef.current) {
      try { (e.target as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* */ }
    }
    resizeRef.current = null;
  };

  // -------------- opacity slider --------------
  const onOpacityChange = useCallback((v: number) => {
    setState((s) => ({ ...s, opacity: Math.max(0.25, Math.min(1, v)) }));
  }, []);

  const handleClose = () => {
    setState((s) => ({ ...s, hidden: true }));
    onClose?.();
  };

  // Re-clamp on window resize.
  useEffect(() => {
    const onResize = () => setState((s) => clampToViewport(s, minWidth, minHeight));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minWidth, minHeight]);

  // ============================================================
  // LOCKED MODE — render a chrome-less positioner at the default
  // coordinates. No drag, no resize, no opacity slider, no header.
  // The user opts into customization via the Edit panels toggle.
  // ============================================================
  if (locked) {
    return (
      <div
        className={cn(
          "fixed z-30 pointer-events-auto overflow-hidden",
          // Only paint a background/border when the child doesn't bring
          // its own (transparent === false). Most HUD cards already have
          // their own rounded surface — set transparent to skip ours.
          !transparent && "rounded-lg shadow-2xl border border-border/60 bg-surface/95 backdrop-blur-md",
          className,
        )}
        style={{
          left: defaults.x,
          top: defaults.y,
          width: defaults.w,
          // ``maxHeight`` (not ``height``) so the panel sizes to its
          // content — matches the cs2.cam-style compact roster that
          // claims only the vertical space it needs. Two stacked
          // panels render via the parent ``LockedRightColumn`` flex
          // container in the replay page so the second one docks
          // tightly under the first regardless of the first's size.
          maxHeight: defaults.h,
        }}
      >
        {children}
      </div>
    );
  }

  if (!hydrated) return null;
  if (closable && state.hidden) return null;

  const headerHeight = 28;
  const visibleH = state.collapsed ? headerHeight : state.h;

  return (
    <div
      className={cn(
        "fixed z-30 rounded-lg shadow-2xl border border-border/60 bg-surface/95 backdrop-blur-md flex flex-col overflow-hidden pointer-events-auto",
        className,
      )}
      style={{
        left: state.x,
        top: state.y,
        width: state.w,
        height: visibleH,
        opacity: state.opacity,
      }}
    >
      {/* ---- Header (drag handle) ---- */}
      <div
        onPointerDown={onHeaderDown}
        onPointerMove={onHeaderMove}
        onPointerUp={onHeaderUp}
        onPointerCancel={onHeaderUp}
        className="flex items-center gap-1.5 px-2 h-7 border-b border-border/40 bg-surface-elevated/70 cursor-move select-none"
        title="Drag to move"
      >
        <GripVertical size={11} className="text-muted-foreground/60 shrink-0" />
        <span className="text-[10px] font-mono-rs uppercase tracking-widest text-foreground/80 truncate flex-1">
          {title}
        </span>

        {/* Opacity slider (compact) */}
        <div
          data-no-drag
          className="flex items-center gap-1 px-1 rounded hover:bg-surface-elevated/80"
          title={`Opacity: ${Math.round(state.opacity * 100)}%`}
        >
          <input
            type="range"
            min={25}
            max={100}
            step={5}
            value={Math.round(state.opacity * 100)}
            onChange={(e) => onOpacityChange(parseInt(e.target.value, 10) / 100)}
            className="w-14 h-1 accent-primary"
          />
        </div>

        <button
          data-no-drag
          onClick={() => setState((s) => ({ ...s, collapsed: !s.collapsed }))}
          className="p-0.5 rounded hover:bg-surface-elevated/80 text-muted-foreground hover:text-foreground transition-colors"
          title={state.collapsed ? "Expand" : "Collapse"}
        >
          {state.collapsed ? <Square size={10} /> : <Minus size={10} />}
        </button>
        {closable && (
          <button
            data-no-drag
            onClick={handleClose}
            className="p-0.5 rounded hover:bg-loss/15 text-muted-foreground hover:text-loss transition-colors"
            title="Hide panel"
          >
            <X size={10} />
          </button>
        )}
      </div>

      {/* ---- Body ---- */}
      {!state.collapsed && (
        <div className="flex-1 overflow-auto">
          {children}
        </div>
      )}

      {/* ---- Resize grip (bottom-right) ---- */}
      {!state.collapsed && (
        <div
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          onPointerCancel={onResizeUp}
          className="absolute bottom-0 right-0 w-3.5 h-3.5 cursor-nwse-resize"
          title="Resize"
        >
          <svg viewBox="0 0 10 10" width="14" height="14" className="text-muted-foreground/60">
            <path d="M0 9 L9 0 M3 9 L9 3 M6 9 L9 6" stroke="currentColor" strokeWidth="1.2" fill="none" />
          </svg>
        </div>
      )}
    </div>
  );
}

/**
 * Reset a panel back to its default position. Useful if the user gets the
 * panel stuck off-screen after a resolution change.
 */
export function resetFloatingPanel(id: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORAGE_KEY_PREFIX + id);
    window.location.reload();
  } catch {
    /* */
  }
}
