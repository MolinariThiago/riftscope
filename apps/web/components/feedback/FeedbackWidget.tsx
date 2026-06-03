"use client";

/**
 * Floating "send feedback" widget.
 *
 * - Bottom-right launcher button → opens a compact popover with category
 *   picker, optional subject, and a body textarea.
 * - Only rendered for logged-in users (the dashboard layout already gates
 *   anonymous traffic to /login, but we also guard inside the component so
 *   it can be dropped anywhere without leaking the launcher to anons).
 * - Auto-captures the current pathname, the User-Agent, and — if the user
 *   is inside /demo/{id}/* — the demo id, so admins get one-click repro
 *   context without the user having to copy/paste anything.
 *
 * Notes for future-me:
 * - Z-index 90 sits BELOW the upload popover (z-100) so a user with both
 *   open never sees the feedback launcher cover the upload UI.
 * - The launcher uses `position: fixed` + `bottom-6 right-6`. On the
 *   replay viewer (fullscreen canvas) it stays visible because the canvas
 *   sits inside `main` with `overflow-hidden`, not a stacking context.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  AlertCircle,
  Bug,
  CheckCircle2,
  FileWarning,
  HelpCircle,
  Lightbulb,
  Loader2,
  MessageSquarePlus,
  MessageSquareText,
  Send,
  Sparkles,
  X,
} from "lucide-react";

import { api, APIError } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";
import type { FeedbackCategory } from "@/types/feedback";

interface CategoryDef {
  key: FeedbackCategory;
  label: string;
  description: string;
  icon: React.ElementType;
  // Per-category accent for the chip. All sit on the same surface so the
  // popover stays visually quiet — colour is only the chip outline.
  accent: string;
}

const CATEGORIES: CategoryDef[] = [
  {
    key: "bug",
    label: "Bug",
    description: "Algo no funciona como debería",
    icon: Bug,
    accent: "text-loss border-loss/40",
  },
  {
    key: "demo_issue",
    label: "Problema con demo",
    description: "Una demo no parsea o muestra datos raros",
    icon: FileWarning,
    accent: "text-accent border-accent/40",
  },
  {
    key: "idea",
    label: "Idea",
    description: "Algo que se podría agregar",
    icon: Lightbulb,
    accent: "text-primary border-primary/40",
  },
  {
    key: "suggestion",
    label: "Sugerencia",
    description: "Una mejora a algo que ya existe",
    icon: Sparkles,
    accent: "text-win border-win/40",
  },
  {
    key: "question",
    label: "Pregunta",
    description: "Algo no se entiende o necesitás ayuda",
    icon: HelpCircle,
    accent: "text-muted-foreground border-border",
  },
];

const MAX_BODY = 1500;
const MAX_SUBJECT = 120;

export function FeedbackWidget() {
  const user = useAuthStore((s) => s.user);
  const pathname = usePathname() ?? "";
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<FeedbackCategory>("bug");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Resolve demo id from /demo/{id}/* — admins love having this auto-
  // attached when a user complains about replay rendering.
  const demoId = useMemo(() => {
    const m = pathname.match(/^\/demo\/(\d+)/);
    return m ? Number(m[1]) : null;
  }, [pathname]);

  // Close on Escape / outside click. Wired only while the popover is open
  // so the listeners aren't always-on.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const el = popoverRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    // defer the click listener one tick so the click that OPENED the
    // popover doesn't immediately close it on the same frame.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
    }, 0);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
      window.clearTimeout(t);
    };
  }, [open]);

  // Reset transient state every time the popover opens so a previous
  // "sent" toast or error doesn't bleed into the next session.
  useEffect(() => {
    if (open) {
      setError(null);
      setSent(false);
    }
  }, [open]);

  // Don't render anything for anonymous users.
  if (!user) return null;

  const reset = () => {
    setCategory("bug");
    setSubject("");
    setBody("");
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    const trimmed = body.trim();
    if (!trimmed) {
      setError("Escribí qué pasa o qué proponés.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.feedback.submit({
        category,
        subject: subject.trim() || null,
        body: trimmed,
        pageUrl: pathname,
        userAgent:
          typeof navigator !== "undefined" ? navigator.userAgent : null,
        demoId,
      });
      setSent(true);
      reset();
      // Auto-close after a short pause so the user sees the confirmation.
      window.setTimeout(() => {
        setOpen(false);
      }, 1500);
    } catch (err) {
      if (err instanceof APIError && err.status === 429) {
        setError(err.message || "Demasiados reportes — esperá un rato.");
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError("No se pudo enviar el reporte.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const remaining = MAX_BODY - body.length;
  const overLimit = remaining < 0;

  return (
    <>
      {/* Launcher — round chip in the bottom-right corner. */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Enviar feedback"
          title="Reportar bug, idea o pregunta"
          className={cn(
            "fixed bottom-6 right-6 z-[90]",
            "flex items-center gap-2 px-4 py-2.5 rounded-full",
            "bg-primary text-primary-foreground shadow-lg",
            "hover:bg-primary/90 active:scale-[0.97] transition-all duration-150",
            "font-semibold text-xs uppercase tracking-wider font-mono-rs",
          )}
        >
          <MessageSquarePlus size={14} />
          <span className="hidden sm:inline">Feedback</span>
        </button>
      )}

      {/* Popover */}
      {open && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Enviar feedback"
          className={cn(
            "fixed bottom-6 right-6 z-[90]",
            "w-[min(380px,calc(100vw-2rem))] max-h-[calc(100vh-3rem)]",
            "rounded-2xl border border-border bg-surface/95 backdrop-blur-md",
            "shadow-2xl flex flex-col overflow-hidden",
            "animate-in fade-in slide-in-from-bottom-2 duration-150",
          )}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/60 flex-shrink-0">
            <div className="flex items-center gap-2">
              <MessageSquareText size={15} className="text-primary" />
              <h2 className="text-sm font-display font-bold">
                Mandanos feedback
              </h2>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-surface-elevated"
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>

          {/* Body */}
          {sent ? (
            <div className="px-4 py-6 flex flex-col items-center gap-2 text-center">
              <CheckCircle2 size={24} className="text-win" />
              <p className="text-sm font-semibold">¡Gracias!</p>
              <p className="text-[11px] text-muted-foreground">
                Lo recibimos. Si necesitamos más datos te escribimos.
              </p>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              className="flex flex-col overflow-y-auto min-h-0"
            >
              {/* Category chips */}
              <div className="px-4 pt-3 pb-2 flex-shrink-0">
                <label className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground block mb-1.5">
                  Categoría
                </label>
                <div className="grid grid-cols-2 gap-1.5">
                  {CATEGORIES.map((c) => {
                    const Icon = c.icon;
                    const active = c.key === category;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        onClick={() => setCategory(c.key)}
                        title={c.description}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-all duration-150",
                          active
                            ? `${c.accent} bg-surface-elevated`
                            : "border-border/60 text-muted-foreground hover:bg-surface-elevated hover:text-foreground",
                        )}
                      >
                        <Icon
                          size={12}
                          className={cn(
                            "flex-shrink-0",
                            active && c.accent.split(" ")[0],
                          )}
                        />
                        <span className="truncate">{c.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Subject (optional) */}
              <div className="px-4 pt-1.5 flex-shrink-0">
                <input
                  type="text"
                  value={subject}
                  onChange={(e) =>
                    setSubject(e.target.value.slice(0, MAX_SUBJECT))
                  }
                  placeholder="Título (opcional)"
                  maxLength={MAX_SUBJECT}
                  className="w-full bg-surface-elevated border border-border/60 rounded-lg px-3 py-2 text-xs placeholder:text-muted-foreground/70 focus:outline-none focus:border-primary/50 transition-colors"
                />
              </div>

              {/* Body */}
              <div className="px-4 pt-1.5 flex-1 min-h-0 flex flex-col">
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Contanos qué pasó, qué esperabas, o tu idea…"
                  rows={5}
                  maxLength={MAX_BODY + 1 /* let the user see overflow */}
                  className={cn(
                    "w-full bg-surface-elevated border rounded-lg px-3 py-2 text-xs placeholder:text-muted-foreground/70 focus:outline-none transition-colors resize-none",
                    overLimit
                      ? "border-loss/50 focus:border-loss"
                      : "border-border/60 focus:border-primary/50",
                  )}
                />
                <div className="flex items-center justify-between mt-1">
                  <span className="text-[10px] text-muted-foreground/70 font-mono-rs">
                    {demoId
                      ? `Adjuntamos demo #${demoId} + URL automáticamente`
                      : "Adjuntamos la URL actual automáticamente"}
                  </span>
                  <span
                    className={cn(
                      "text-[10px] font-mono-rs",
                      overLimit
                        ? "text-loss"
                        : remaining < 100
                          ? "text-accent"
                          : "text-muted-foreground/70",
                    )}
                  >
                    {remaining}
                  </span>
                </div>
              </div>

              {error && (
                <div className="px-4 pt-2 flex-shrink-0">
                  <div className="flex items-start gap-2 text-[11px] text-loss bg-loss/10 border border-loss/30 rounded-lg px-2.5 py-1.5">
                    <AlertCircle
                      size={12}
                      className="flex-shrink-0 mt-0.5"
                    />
                    <span>{error}</span>
                  </div>
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-4 py-3 mt-2 border-t border-border/60 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  disabled={submitting}
                  className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={submitting || overLimit || body.trim().length === 0}
                  className={cn(
                    "text-xs font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground transition-colors",
                    "hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed",
                    "flex items-center gap-1.5",
                  )}
                >
                  {submitting ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Send size={12} />
                  )}
                  Enviar
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </>
  );
}
