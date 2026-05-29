"use client";

import { useEffect, useState } from "react";
import { X, Star, Loader2, PenTool } from "lucide-react";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { PlaybookFolder } from "@/types/playbook";

const TYPES = ["execute", "retake", "default", "eco", "force", "pistol", "anti-eco"];

export interface SaveRoundOpts {
  name: string;
  type: string | null;
  folderId: number | null;
  /** true = "Save & edit": also snapshot it to the board and open /tactics. */
  openAfter: boolean;
}

/**
 * Dialog shown when the user stars a round in the 2D replay.
 *
 * "Save" stores the round as a real reference (demo + round number) in the
 * chosen folder — replaying it later jumps back to the actual demo round.
 * "Save & edit" instead snapshots the positions onto the tactical board for
 * annotation. Folders can be picked or created inline.
 */
export function SaveRoundDialog({
  open,
  onClose,
  suggestedName,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  suggestedName: string;
  onConfirm: (opts: SaveRoundOpts) => Promise<void>;
}) {
  const [name, setName] = useState(suggestedName);
  const [type, setType] = useState("");
  const [folders, setFolders] = useState<PlaybookFolder[]>([]);
  const [folderSel, setFolderSel] = useState(""); // "" none · "new" · "<id>"
  const [newFolder, setNewFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName(suggestedName);
      setType("");
      setFolderSel("");
      setNewFolder("");
      setError(null);
      setBusy(false);
      api.folders.list().then(setFolders).catch(() => setFolders([]));
    }
  }, [open, suggestedName]);

  if (!open) return null;

  const submit = async (openAfter: boolean) => {
    if (!name.trim()) {
      setError("Ponele un nombre");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let folderId: number | null = null;
      if (folderSel === "new") {
        if (!newFolder.trim()) {
          setError("Nombre de la carpeta");
          setBusy(false);
          return;
        }
        const f = await api.folders.create(newFolder.trim());
        folderId = f.id;
      } else if (folderSel) {
        folderId = Number(folderSel);
      }
      await onConfirm({ name: name.trim(), type: type || null, folderId, openAfter });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar");
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-base flex items-center gap-2">
            <Star size={16} className="text-primary" fill="currentColor" /> Guardar ronda
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-3.5">
          <label className="block">
            <span className="text-[11px] text-muted-foreground font-mono-rs uppercase tracking-wider">Nombre</span>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit(false)}
              className="mt-1 w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-[11px] text-muted-foreground font-mono-rs uppercase tracking-wider">Tipo</span>
              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="mt-1 w-full bg-surface-elevated border border-border rounded-md px-2 py-2 text-sm capitalize focus:outline-none focus:border-primary/60"
              >
                <option value="">Ninguno</option>
                {TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="text-[11px] text-muted-foreground font-mono-rs uppercase tracking-wider">Carpeta</span>
              <select
                value={folderSel}
                onChange={(e) => setFolderSel(e.target.value)}
                className="mt-1 w-full bg-surface-elevated border border-border rounded-md px-2 py-2 text-sm focus:outline-none focus:border-primary/60"
              >
                <option value="">Sin carpeta</option>
                {folders.map((f) => (
                  <option key={f.id} value={String(f.id)}>{f.name}</option>
                ))}
                <option value="new">+ Nueva carpeta…</option>
              </select>
            </label>
          </div>

          {folderSel === "new" && (
            <input
              autoFocus
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              placeholder="Nombre de la nueva carpeta"
              className="w-full bg-surface-elevated border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
            />
          )}

          {error && (
            <div className="rounded-lg bg-loss/10 border border-loss/30 text-loss text-xs px-3 py-2">{error}</div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => submit(false)}
              disabled={busy}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors font-display"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Star size={14} fill="currentColor" />}
              Guardar
            </button>
            <button
              onClick={() => submit(true)}
              disabled={busy}
              title="Guardar una copia editable en la pizarra táctica"
              className={cn(
                "inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg border border-border text-sm hover:bg-surface-elevated transition-colors disabled:opacity-60",
              )}
            >
              <PenTool size={14} /> Guardar y dibujar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
