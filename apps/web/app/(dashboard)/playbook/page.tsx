"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Folder,
  FolderPlus,
  Play,
  PenTool,
  Trash2,
  Pencil,
  ChevronLeft,
  Film,
  Loader2,
  Check,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { PlaybookFolder, PlaybookSummary } from "@/types/playbook";

function mapLabel(m: string): string {
  return m.replace(/^de_/, "").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PlaybookPage() {
  const router = useRouter();

  const [folders, setFolders] = useState<PlaybookFolder[] | null>(null);
  const [items, setItems] = useState<PlaybookSummary[] | null>(null);
  const [current, setCurrent] = useState<number | null>(null); // null = root
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [f, i] = await Promise.all([
      api.folders.list().catch(() => []),
      api.playbooks.list().catch(() => []),
    ]);
    setFolders(f);
    setItems(i);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const looseItems = useMemo(
    () => (items ?? []).filter((i) => i.folderId == null),
    [items],
  );
  const folderItems = useMemo(
    () => (items ?? []).filter((i) => i.folderId === current),
    [items, current],
  );
  const currentFolder = folders?.find((f) => f.id === current) ?? null;

  // ---- actions ----
  const createFolder = async () => {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.folders.create(name);
      setNewName("");
      setCreating(false);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const renameFolder = async (id: number) => {
    const name = renameVal.trim();
    if (!name) {
      setRenaming(null);
      return;
    }
    setBusy(true);
    try {
      await api.folders.rename(id, name);
      setRenaming(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteFolder = async (id: number) => {
    if (!confirm("¿Borrar la carpeta? Las rondas que tenga adentro vuelven a 'Sin carpeta'.")) return;
    setBusy(true);
    try {
      await api.folders.delete(id);
      if (current === id) setCurrent(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const deleteItem = async (id: number) => {
    setBusy(true);
    try {
      await api.playbooks.delete(id);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const moveItem = async (id: number, folderId: number | null) => {
    setBusy(true);
    try {
      await api.playbooks.update(id, { folderId });
      await load();
    } finally {
      setBusy(false);
    }
  };

  const openItem = (item: PlaybookSummary) => {
    if (item.kind === "round") {
      if (item.demoId == null) return; // demo gone — replay disabled
      router.push(`/demo/${item.demoId}/replay?round=${item.roundNumber ?? 1}`);
    } else {
      router.push(`/tactics?load=${item.id}`);
    }
  };

  const loading = folders === null || items === null;

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 mb-6">
        <div className="min-w-0">
          {current !== null ? (
            <button
              onClick={() => setCurrent(null)}
              className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors mb-1"
            >
              <ChevronLeft size={15} /> Playbook
            </button>
          ) : (
            <h1 className="text-2xl font-display font-bold">Playbook</h1>
          )}
          <p className="text-sm text-muted-foreground mt-0.5 truncate">
            {current !== null
              ? `${currentFolder?.name ?? "Carpeta"} · ${folderItems.length} elemento${folderItems.length === 1 ? "" : "s"}`
              : "Tus rondas guardadas y tácticas, organizadas en carpetas."}
          </p>
        </div>
        {current === null && (
          <div className="flex items-center gap-2">
            {creating ? (
              <div className="flex items-center gap-1.5">
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") createFolder();
                    if (e.key === "Escape") setCreating(false);
                  }}
                  placeholder="Nombre de carpeta"
                  className="bg-surface border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-primary/60"
                />
                <button onClick={createFolder} disabled={busy} className="p-2 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                  <Check size={16} />
                </button>
                <button onClick={() => setCreating(false)} className="p-2 rounded-lg border border-border hover:bg-surface-elevated transition-colors">
                  <X size={16} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors font-display"
              >
                <FolderPlus size={16} /> Nueva carpeta
              </button>
            )}
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="animate-spin mr-2" size={18} /> Cargando…
        </div>
      ) : current !== null ? (
        /* ---- Inside a folder ---- */
        folderItems.length === 0 ? (
          <EmptyState>Esta carpeta está vacía. Guardá rondas desde el visor 2D.</EmptyState>
        ) : (
          <div className={cn("grid sm:grid-cols-2 lg:grid-cols-3 gap-4", busy && "opacity-60 pointer-events-none")}>
            {folderItems.map((it) => (
              <ItemCard
                key={it.id}
                item={it}
                folders={folders}
                onOpen={() => openItem(it)}
                onDelete={() => deleteItem(it.id)}
                onMove={(fid) => moveItem(it.id, fid)}
              />
            ))}
          </div>
        )
      ) : (
        /* ---- Root: folders + loose items ---- */
        <div className="space-y-8">
          <div>
            {folders.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no tenés carpetas. Creá una para organizar tus rondas.
              </p>
            ) : (
              <div className={cn("grid sm:grid-cols-2 lg:grid-cols-3 gap-3", busy && "opacity-60 pointer-events-none")}>
                {folders.map((f) => (
                  <div
                    key={f.id}
                    className="group flex items-center gap-3 rounded-xl border border-border/60 bg-surface-elevated/40 p-4 hover:border-border transition-colors"
                  >
                    {renaming === f.id ? (
                      <>
                        <Folder size={20} className="text-primary flex-shrink-0" />
                        <input
                          autoFocus
                          value={renameVal}
                          onChange={(e) => setRenameVal(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") renameFolder(f.id);
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          className="flex-1 min-w-0 bg-surface border border-border rounded px-2 py-1 text-sm focus:outline-none focus:border-primary/60"
                        />
                        <button onClick={() => renameFolder(f.id)} className="text-primary"><Check size={16} /></button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => setCurrent(f.id)} className="flex items-center gap-3 flex-1 min-w-0 text-left">
                          <Folder size={20} className="text-primary flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-semibold text-sm truncate">{f.name}</div>
                            <div className="text-[11px] text-muted-foreground font-mono-rs">
                              {f.itemCount} elemento{f.itemCount === 1 ? "" : "s"}
                            </div>
                          </div>
                        </button>
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button onClick={() => { setRenaming(f.id); setRenameVal(f.name); }} title="Renombrar" className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-surface transition-colors">
                            <Pencil size={13} />
                          </button>
                          <button onClick={() => deleteFolder(f.id)} title="Borrar" className="p-1.5 rounded text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors">
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {looseItems.length > 0 && (
            <div>
              <h2 className="text-sm font-display font-semibold text-muted-foreground mb-3">Sin carpeta</h2>
              <div className={cn("grid sm:grid-cols-2 lg:grid-cols-3 gap-4", busy && "opacity-60 pointer-events-none")}>
                {looseItems.map((it) => (
                  <ItemCard
                    key={it.id}
                    item={it}
                    folders={folders}
                    onOpen={() => openItem(it)}
                    onDelete={() => deleteItem(it.id)}
                    onMove={(fid) => moveItem(it.id, fid)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass-card rounded-xl py-16 text-center">
      <Folder size={28} className="mx-auto text-muted-foreground/50 mb-3" />
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function ItemCard({
  item,
  folders,
  onOpen,
  onDelete,
  onMove,
}: {
  item: PlaybookSummary;
  folders: PlaybookFolder[];
  onOpen: () => void;
  onDelete: () => void;
  onMove: (folderId: number | null) => void;
}) {
  const isRound = item.kind === "round";
  const disabled = isRound && item.demoId == null;

  return (
    <div className="group rounded-xl border border-border/60 bg-surface-elevated/40 overflow-hidden hover:border-border transition-colors">
      <button
        onClick={onOpen}
        disabled={disabled}
        className="relative block h-32 w-full bg-[hsl(220_18%_7%)] overflow-hidden disabled:cursor-not-allowed"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/maps/${item.map}.png`}
          alt={item.map}
          className="absolute inset-0 h-full w-full object-cover opacity-70 group-hover:opacity-90 transition-opacity"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[hsl(220_18%_7%)] via-transparent to-transparent" />
        <span
          className="absolute top-2 left-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide bg-background/70 backdrop-blur-sm"
          style={{ color: isRound ? "#0ddde8" : "#c084fc" }}
        >
          {isRound ? <Film size={10} /> : <PenTool size={10} />}
          {isRound ? "Ronda" : "Táctica"}
        </span>
        {!disabled && (
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
              <Play size={12} fill="currentColor" /> {isRound ? "Reproducir" : "Abrir"}
            </span>
          </div>
        )}
        {disabled && (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[10px] text-muted-foreground bg-background/70 px-2 py-1 rounded">demo no disponible</span>
          </div>
        )}
      </button>

      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold truncate">{item.title}</h3>
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
            <button onClick={onDelete} title="Borrar" className="p-1.5 rounded text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors">
              <Trash2 size={13} />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <Chip>{mapLabel(item.map)}</Chip>
          {isRound && item.roundNumber != null && <Chip>R{item.roundNumber}</Chip>}
          {item.type && <Chip>{item.type}</Chip>}
          <select
            value={item.folderId ?? ""}
            onChange={(e) => onMove(e.target.value ? Number(e.target.value) : null)}
            title="Mover a carpeta"
            className="ml-auto bg-surface border border-border/60 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground focus:outline-none focus:border-primary/60 max-w-[90px]"
          >
            <option value="">Sin carpeta</option>
            {folders.map((f) => (
              <option key={f.id} value={String(f.id)}>{f.name}</option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="px-2 py-0.5 rounded-md border border-border/60 text-[10px] font-mono-rs uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  );
}
