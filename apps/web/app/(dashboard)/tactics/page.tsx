"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Loader2, Save, FilePlus2, FolderOpen, Trash2, Check } from "lucide-react";

import { TacticsToolbar } from "@/components/tactics/TacticsToolbar";
import { FrameTimeline } from "@/components/tactics/FrameTimeline";
import { ZoomControls } from "@/components/tactics/ZoomControls";
import type { TacticalBoardHandle } from "@/components/tactics/TacticalBoard";
import { usePlaybook } from "@/lib/stores/playbook";
import { useMapMeta } from "@/lib/hooks/useMaps";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PlaybookSummary, Team, TeamInfo } from "@/types/playbook";

// Pixi/WebGL board is browser-only.
const TacticalBoard = dynamic(
  () => import("@/components/tactics/TacticalBoard").then((m) => m.TacticalBoard),
  { ssr: false },
);

const MAPS = [
  "de_mirage",
  "de_inferno",
  "de_ancient",
  "de_dust2",
  "de_nuke",
  "de_overpass",
  "de_train",
  "de_vertigo",
  "de_anubis",
];

const TYPES = ["execute", "retake", "default", "eco", "force", "pistol", "anti-eco"];

function mapLabel(m: string): string {
  return m.replace(/^de_/, "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function TacticsPage() {
  const title = usePlaybook((s) => s.title);
  const map = usePlaybook((s) => s.map);
  const side = usePlaybook((s) => s.side);
  const playbookId = usePlaybook((s) => s.playbookId);
  const dirty = usePlaybook((s) => s.dirty);

  const type = usePlaybook((s) => s.type);
  const tags = usePlaybook((s) => s.tags);
  const teamId = usePlaybook((s) => s.teamId);

  const setTitle = usePlaybook((s) => s.setTitle);
  const setMap = usePlaybook((s) => s.setMap);
  const setSide = usePlaybook((s) => s.setSide);
  const setType = usePlaybook((s) => s.setType);
  const setTags = usePlaybook((s) => s.setTags);
  const setTeamId = usePlaybook((s) => s.setTeamId);
  const newPlaybook = usePlaybook((s) => s.newPlaybook);
  const loadPlaybook = usePlaybook((s) => s.loadPlaybook);
  const markSaved = usePlaybook((s) => s.markSaved);
  const entities = usePlaybook((s) => s.entities);
  const placingId = usePlaybook((s) => s.placingId);

  const { data: mapMeta } = useMapMeta(map);
  const [board, setBoard] = useState<TacticalBoardHandle | null>(null);
  const [library, setLibrary] = useState<PlaybookSummary[]>([]);
  const [teams, setTeams] = useState<TeamInfo[]>([]);
  const [showLib, setShowLib] = useState(false);
  const [saving, setSaving] = useState(false);

  const refreshLib = useCallback(async () => {
    try {
      setLibrary(await api.playbooks.list());
    } catch {
      /* not logged in / offline — leave empty */
    }
  }, []);

  useEffect(() => {
    refreshLib();
  }, [refreshLib]);

  // Teams the user belongs to (for the Share dropdown).
  useEffect(() => {
    api.teams.list().then(setTeams).catch(() => setTeams([]));
  }, []);

  // Open a specific tactic when arriving via /tactics?load=<id> (from the Playbook page).
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("load");
    if (!id) return;
    (async () => {
      try {
        const full = await api.playbooks.get(Number(id));
        loadPlaybook(full);
      } catch {
        /* */
      }
    })();
  }, [loadPlaybook]);

  // Keyboard shortcuts (ignored while typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const st = usePlaybook.getState();
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) st.redo();
        else st.undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        st.redo();
        return;
      }
      if (e.ctrlKey || e.metaKey) return; // leave other Ctrl combos alone
      if (k === "v") st.setTool("select");
      else if (k === "p" || k === "b") st.setTool("pen");
      else if (k === "a") st.setTool("arrow");
      else if (k === "r") st.setTool("rect");
      else if (k === "c") st.setTool("circle");
      else if (k === "e") st.setTool("eraser");
      else if (k === "[" || k === "]") {
        if (st.selectedEntityId) {
          e.preventDefault();
          st.rotateEntity(st.selectedEntityId, k === "[" ? -15 : 15);
        }
      } else if (k === "escape") {
        if (st.placingId) st.removeEntity(st.placingId); // cancel placement
      } else if (k === "delete" || k === "backspace") {
        if (st.selectedEntityId) {
          e.preventDefault();
          st.removeEntity(st.selectedEntityId);
        }
      } else if (e.key === " ") {
        e.preventDefault();
        st.setPlaying(!st.isPlaying);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        title: title || "Untitled tactic",
        map,
        side,
        type,
        tags,
        teamId,
        data: usePlaybook.getState().toData(),
      };
      if (playbookId) {
        await api.playbooks.update(playbookId, body);
        markSaved(playbookId);
      } else {
        const created = await api.playbooks.create(body);
        markSaved(created.id);
      }
      await refreshLib();
    } catch {
      /* surfaced via the dirty dot staying on */
    } finally {
      setSaving(false);
    }
  };

  const load = async (id: number) => {
    try {
      const full = await api.playbooks.get(id);
      loadPlaybook(full);
    } catch {
      /* */
    }
    setShowLib(false);
  };

  const del = async (id: number) => {
    try {
      await api.playbooks.delete(id);
      if (playbookId === id) newPlaybook(map);
      await refreshLib();
    } catch {
      /* */
    }
  };

  return (
    <div className="absolute inset-0 flex flex-col bg-background">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 h-12 border-b border-border/50 bg-surface/40 backdrop-blur-sm z-20 flex-shrink-0">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Sin título"
          className="w-52 bg-transparent text-sm font-display font-semibold focus:outline-none border-b border-transparent focus:border-primary/50"
        />

        <select
          value={map}
          onChange={(e) => setMap(e.target.value)}
          className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60"
        >
          {MAPS.map((m) => (
            <option key={m} value={m}>{mapLabel(m)}</option>
          ))}
        </select>

        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          <SideBtn active={side === null} onClick={() => setSide(null)}>Ambos</SideBtn>
          <SideBtn active={side === "ct"} onClick={() => setSide("ct")} tint="#4a9eff">CT</SideBtn>
          <SideBtn active={side === "tt"} onClick={() => setSide("tt")} tint="#ffb347">T</SideBtn>
        </div>

        <select
          value={type ?? ""}
          onChange={(e) => setType(e.target.value || null)}
          title="Tipo de táctica"
          className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs capitalize focus:outline-none focus:border-primary/60"
        >
          <option value="">Tipo…</option>
          {TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>

        <input
          value={tags.join(", ")}
          onChange={(e) => setTags(e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
          placeholder="tags…"
          title="Tags separados por coma"
          className="w-32 bg-surface border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60"
        />

        {teams.length > 0 && (
          <select
            value={teamId ?? ""}
            onChange={(e) => setTeamId(e.target.value ? Number(e.target.value) : null)}
            title="Compartir con equipo"
            className="bg-surface border border-border rounded-md px-2 py-1.5 text-xs focus:outline-none focus:border-primary/60 max-w-[140px]"
          >
            <option value="">Personal</option>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>{`◆ ${t.name}`}</option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => newPlaybook(map)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-foreground hover:bg-surface-elevated transition-colors"
          >
            <FilePlus2 size={13} /> Nueva
          </button>

          <div className="relative">
            <button
              onClick={() => setShowLib((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-border text-xs text-foreground hover:bg-surface-elevated transition-colors"
            >
              <FolderOpen size={13} /> Playbook
            </button>
            {showLib && (
              <div className="absolute right-0 top-full mt-1.5 w-72 max-h-80 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl z-30 p-1.5">
                {library.length === 0 ? (
                  <div className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Sin tácticas guardadas.
                  </div>
                ) : (
                  library.map((pb) => (
                    <div
                      key={pb.id}
                      className={cn(
                        "group flex items-center gap-2 rounded-md px-2 py-2 hover:bg-surface-elevated transition-colors",
                        pb.id === playbookId && "bg-primary-dim/30",
                      )}
                    >
                      <button onClick={() => load(pb.id)} className="flex-1 min-w-0 text-left">
                        <div className="text-xs font-medium truncate">{pb.title}</div>
                        <div className="text-[10px] text-muted-foreground font-mono-rs">
                          {mapLabel(pb.map)} · {new Date(pb.updatedAt).toLocaleDateString()}
                        </div>
                      </button>
                      <button
                        onClick={() => del(pb.id)}
                        title="Borrar"
                        className="p-1.5 rounded text-muted-foreground/70 hover:text-loss hover:bg-loss/10 transition-colors"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))
                )}
              </div>
            )}
          </div>

          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors font-display"
          >
            {saving ? (
              <Loader2 size={13} className="animate-spin" />
            ) : dirty ? (
              <Save size={13} />
            ) : (
              <Check size={13} />
            )}
            {saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
          </button>
        </div>
      </header>

      {/* Board area */}
      <div className={cn("relative flex-1 min-h-0", placingId && "cursor-crosshair")}>
        <TacticalBoard mapMeta={mapMeta} mapName={map} onReady={setBoard} />

        {/* Placement hint */}
        {placingId && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <div className="px-3 py-1.5 rounded-lg border border-primary/40 bg-background/90 backdrop-blur-sm text-xs font-mono-rs text-primary">
              Click para ubicar · Esc para cancelar
            </div>
          </div>
        )}

        {/* Empty-state hint — minimal, only shown when truly empty */}
        {entities.length === 0 && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none">
            <div className="text-center px-5 py-3 rounded-lg border border-border/40 bg-background/60 backdrop-blur-sm">
              <p className="text-xs text-muted-foreground">
                Tocá <span className="text-primary font-semibold">5v5</span> abajo para arrancar
              </p>
            </div>
          </div>
        )}

        {/* Zoom rail — top left */}
        <div className="absolute top-3 left-3 z-10 pointer-events-auto">
          <ZoomControls board={board} />
        </div>

        {/* Frame timeline — top right (compact, doesn't compete with toolbar) */}
        <div className="absolute top-3 right-3 z-10 pointer-events-auto">
          <FrameTimeline board={board} />
        </div>

        {/* Main toolbar — bottom centered (cs2.cam-style) */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 pointer-events-auto max-w-[95vw] overflow-x-auto">
          <TacticsToolbar board={board} />
        </div>
      </div>
    </div>
  );
}

function SideBtn({
  active,
  onClick,
  tint,
  children,
}: {
  active: boolean;
  onClick: () => void;
  tint?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-3 py-1.5 transition-colors",
        active ? "bg-primary-dim text-primary font-semibold" : "text-muted-foreground hover:text-foreground",
      )}
      style={active && tint ? { color: tint } : undefined}
    >
      {children}
    </button>
  );
}
