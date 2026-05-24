"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  CheckCircle2,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const COMMON_MAPS = [
  "Mirage",
  "Inferno",
  "Nuke",
  "Anubis",
  "Ancient",
  "Dust2",
  "Train",
  "Vertigo",
  "Overpass",
];

// Tier vocabulary mirroring the backend's VALID_TIERS. Shown only in
// the admin upload form — NOT surfaced in the public /pro feed. The
// future AI scoring engine consumes this so it can weight tier-1
// pro patterns differently from tier-3 cup play.
const TIER_OPTIONS = [
  { value: "",   label: "—  Sin clasificar" },
  { value: "S+", label: "S+ · Majors (IEM Cologne / Katowice / Major)" },
  { value: "S",  label: "S  · BLAST Premier / ESL Pro League finals" },
  { value: "A",  label: "A  · Tier-1 regional, BLAST Showdown" },
  { value: "B",  label: "B  · Tier-2 online, qualifiers, LANs chicas" },
  { value: "C",  label: "C  · Tier-3, FACEIT cups, FPL-C" },
];

/**
 * Admin-only modal to upload a pro match into the /pro feed.
 *
 * Mirrors the metadata fields HLTV exposes (teams, score, map, event,
 * date) plus the .dem file itself. On success the demo gets queued
 * for parsing and the row lands in the /pro list immediately — once
 * parsing completes the "Ver en 2D" button activates automatically.
 */
export function ProMatchUploadModal({ open, onClose, onSuccess }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");
  const [scoreA, setScoreA] = useState("");
  const [scoreB, setScoreB] = useState("");
  const [eventName, setEventName] = useState("");
  const [mapName, setMapName] = useState("");
  const [tier, setTier] = useState("");  // "" = unclassified; stored as NULL in DB
  const [playedAt, setPlayedAt] = useState(todayISO());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);

  // Portal target only available client-side — guard the createPortal
  // call so SSR / first-paint doesn't crash with "document undefined".
  useEffect(() => {
    setMounted(true);
  }, []);

  // Lock body scroll while the modal is open so wheel events don't
  // leak through and the page underneath doesn't visually drift.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  // ESC closes the modal — universal UX expectation.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, submitting]);

  if (!open || !mounted) return null;

  const reset = () => {
    setFile(null);
    setTeamA("");
    setTeamB("");
    setScoreA("");
    setScoreB("");
    setEventName("");
    setMapName("");
    setTier("");
    setPlayedAt(todayISO());
    setError(null);
    setSuccess(null);
  };

  const handleClose = () => {
    if (submitting) return;
    reset();
    onClose();
  };

  const validate = (): string | null => {
    if (!file) return "Elegí un archivo .dem";
    if (!file.name.toLowerCase().endsWith(".dem"))
      return "Solo se aceptan archivos .dem (si tenés .rar/.zip, extraelo primero)";
    if (!teamA.trim()) return "Falta Team A";
    if (!teamB.trim()) return "Falta Team B";
    if (teamA.trim().toLowerCase() === teamB.trim().toLowerCase())
      return "Team A y Team B no pueden ser iguales";
    const a = Number(scoreA);
    const b = Number(scoreB);
    if (!Number.isInteger(a) || a < 0 || a > 30)
      return "Score A debe ser 0-30";
    if (!Number.isInteger(b) || b < 0 || b > 30)
      return "Score B debe ser 0-30";
    if (!eventName.trim()) return "Falta el evento";
    return null;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    if (!file) return;

    const form = new FormData();
    form.append("file", file);
    form.append("team_a", teamA.trim());
    form.append("team_b", teamB.trim());
    form.append("score_a", scoreA);
    form.append("score_b", scoreB);
    form.append("event_name", eventName.trim());
    if (mapName.trim()) form.append("map_name", mapName.trim());
    if (tier) form.append("tier", tier);
    form.append("played_at", playedAt);

    setSubmitting(true);
    try {
      const res = await api.pro.uploadMatch(form);
      setSuccess(res.message);
      onSuccess();
      // Auto-close after a short pause so the user sees confirmation.
      setTimeout(() => {
        reset();
        onClose();
      }, 1800);
    } catch (err: any) {
      setError(err?.message ?? "No se pudo subir la partida");
    } finally {
      setSubmitting(false);
    }
  };

  // createPortal escapes any parent containing block (the dashboard
  // layout uses transforms / filters that broke ``position: fixed``
  // — the modal was rendering INSIDE the main content area with the
  // sidebar still visible on the side, which is the bug the user
  // reported with the screenshot). Rendering into ``document.body``
  // means we sit above EVERYTHING in the page hierarchy.
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm overflow-y-auto p-4"
      onClick={handleClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="pro-upload-title"
    >
      <div
        className="glass-card rounded-2xl p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto my-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2
              id="pro-upload-title"
              className="text-xl font-display font-bold flex items-center gap-2"
            >
              <Upload size={18} className="text-primary" />
              Subir partida pro
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Subí el .dem y los datos del match. Aparece en /pro apenas
              termina de parsearse.
            </p>
          </div>
          <button
            onClick={handleClose}
            disabled={submitting}
            className="text-muted-foreground hover:text-foreground p-1 rounded transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* File picker */}
          <FileField
            file={file}
            onChange={setFile}
            disabled={submitting}
          />

          {/* Teams + scores side by side */}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Team A">
              <input
                value={teamA}
                onChange={(e) => setTeamA(e.target.value)}
                disabled={submitting}
                placeholder="NaVi"
                className={inputClass}
              />
            </Field>
            <Field label="Team B">
              <input
                value={teamB}
                onChange={(e) => setTeamB(e.target.value)}
                disabled={submitting}
                placeholder="G2"
                className={inputClass}
              />
            </Field>
            <Field label="Score A">
              <input
                type="number"
                min={0}
                max={30}
                value={scoreA}
                onChange={(e) => setScoreA(e.target.value)}
                disabled={submitting}
                placeholder="13"
                className={cn(inputClass, "font-mono-rs")}
              />
            </Field>
            <Field label="Score B">
              <input
                type="number"
                min={0}
                max={30}
                value={scoreB}
                onChange={(e) => setScoreB(e.target.value)}
                disabled={submitting}
                placeholder="9"
                className={cn(inputClass, "font-mono-rs")}
              />
            </Field>
          </div>

          {/* Event + map */}
          <Field label="Evento">
            <input
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
              disabled={submitting}
              placeholder="PGL Astana 2026"
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Mapa (opcional)">
              <input
                list="cs2-maps"
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
                disabled={submitting}
                placeholder="Mirage"
                className={inputClass}
              />
              <datalist id="cs2-maps">
                {COMMON_MAPS.map((m) => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </Field>
            <Field label="Fecha del match">
              <div className="relative">
                <Calendar
                  size={13}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none"
                />
                <input
                  type="date"
                  value={playedAt}
                  onChange={(e) => setPlayedAt(e.target.value)}
                  disabled={submitting}
                  className={cn(inputClass, "pl-9")}
                />
              </div>
            </Field>
          </div>

          {/* Tier — internal classification for the future AI scoring
              engine. Lives only in this admin form; the public /pro
              cards intentionally don't render it. Default ("Sin
              clasificar") leaves the DB field NULL. */}
          <Field label="Tier (interno · no se muestra en público)">
            <select
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              disabled={submitting}
              className={cn(inputClass, "cursor-pointer")}
            >
              {TIER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </Field>

          {/* Error / success feedback */}
          {error && (
            <div className="text-xs text-loss bg-loss/10 border border-loss/30 rounded-md px-3 py-2">
              {error}
            </div>
          )}
          {success && (
            <div className="text-xs text-win bg-win/10 border border-win/30 rounded-md px-3 py-2 flex items-center gap-2">
              <CheckCircle2 size={13} />
              {success}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={handleClose}
              disabled={submitting}
              className="px-4 py-2 rounded-lg text-xs font-semibold border border-border hover:bg-surface-elevated transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !!success}
              className={cn(
                "inline-flex items-center gap-2 px-4 py-2 rounded-lg",
                "bg-primary text-primary-foreground text-xs font-semibold",
                "hover:bg-primary/90 disabled:opacity-50 transition-colors",
                "glow-primary",
              )}
            >
              {submitting ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  Subiendo…
                </>
              ) : (
                <>
                  <Upload size={13} />
                  Publicar partida
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}

const inputClass =
  "w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:border-primary/60 transition-colors";

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1">
      <span className="text-[10px] font-mono-rs uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function FileField({
  file,
  onChange,
  disabled,
}: {
  file: File | null;
  onChange: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <label
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-6 rounded-lg border-2 border-dashed cursor-pointer transition-colors",
        file
          ? "border-primary/50 bg-primary/5"
          : "border-border hover:border-primary/40 hover:bg-surface-elevated/40",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <Upload
        size={22}
        className={file ? "text-primary" : "text-muted-foreground"}
      />
      {file ? (
        <>
          <span className="text-sm font-semibold text-foreground truncate max-w-full">
            {file.name}
          </span>
          <span className="text-[11px] font-mono-rs text-muted-foreground">
            {(file.size / 1024 / 1024).toFixed(1)} MB · click para cambiar
          </span>
        </>
      ) : (
        <>
          <span className="text-sm font-semibold">Click para elegir un .dem</span>
          <span className="text-[11px] text-muted-foreground">
            Si tu archivo es .rar/.zip, extraelo y subí cada .dem por separado
          </span>
        </>
      )}
      <input
        type="file"
        accept=".dem"
        className="hidden"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </label>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
