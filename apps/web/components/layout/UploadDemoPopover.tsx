"use client";

/**
 * Floating upload popover.
 *
 * Anchored to whichever button opened it (the sidebar upload icon or
 * the ``Upload demo`` chip on /demos). The position lives on the
 * useUploadPopover store and is set when the trigger fires —
 * defaulting to a sensible top-left location if nothing was passed.
 *
 * Uses react-dropzone for drag-and-drop (already a dependency for
 * apps/web/app/(dashboard)/demos/upload/page.tsx). Upload progress is
 * tracked with XHR rather than fetch so we can read the per-byte
 * upload progress and render it inline.
 *
 * Click-outside-to-close + Escape-to-close are handled here so every
 * trigger doesn't have to repeat that logic.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDropzone, type FileRejection } from "react-dropzone";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  File as FileIcon,
  Loader2,
  Upload as UploadIcon,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { useUploadPopover } from "@/lib/stores/upload";
import { cn } from "@/lib/utils";
import type { DemoStatus } from "@/types/demo";

type LocalStatus = "pending" | "uploading" | DemoStatus | "error";

interface UploadItem {
  localId: string;
  file: File;
  status: LocalStatus;
  uploadProgress: number;
  serverProgress: number;
  serverDemoId: string | null;
  error?: string;
}

const ACTIVE_SERVER_STATUSES: DemoStatus[] = [
  "uploaded",
  "queued",
  "processing",
];

// Popover footprint — wide enough to read filenames comfortably but
// narrow enough not to dominate the screen on /demos. Height adapts
// to the upload queue so an empty popover is just the dropzone.
const POPOVER_WIDTH = 380;
const POPOVER_OFFSET_X = 12; // gap from the anchor (sidebar edge)

export function UploadDemoPopover() {
  const open = useUploadPopover((s) => s.open);
  const anchor = useUploadPopover((s) => s.anchor);
  const hide = useUploadPopover((s) => s.hide);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const router = useRouter();

  const [items, setItems] = useState<UploadItem[]>([]);
  // Adjusted vertical offset computed AFTER first paint — we measure
  // the real popover height and flip / clamp it into the viewport so
  // the bottom of the popover is never cut off (e.g. when the
  // sidebar trigger sits near the bottom of the screen).
  const [adjustedTop, setAdjustedTop] = useState<number | null>(null);

  // ---- Drop handling -----------------------------------------------------
  //
  // We deliberately do NOT pass an ``accept`` mime map to react-dropzone.
  // Browsers report ``.dem`` files with all sorts of MIME types
  // depending on OS / drag source — sometimes ``application/octet-
  // stream``, sometimes empty string, sometimes ``video/dem`` if the
  // user has a weird file association. Filtering by MIME would
  // silently reject perfectly valid demos. Instead we accept ANY
  // dropped file and validate the EXTENSION ourselves in onDrop,
  // which is the only field that's reliable across all platforms.
  const onDrop = useCallback((accepted: File[]) => {
    const dems = accepted.filter((f) =>
      f.name.toLowerCase().endsWith(".dem"),
    );
    if (dems.length === 0) return;
    const fresh: UploadItem[] = dems.map((f) => ({
      localId: Math.random().toString(36).slice(2),
      file: f,
      status: "pending",
      uploadProgress: 0,
      serverProgress: 0,
      serverDemoId: null,
    }));
    setItems((prev) => [...prev, ...fresh]);
    fresh.forEach((it) => startUpload(it.localId, it.file, setItems));
  }, []);

  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    // Visible queue entry for rejected files — without this the
    // user clicks/drops, nothing happens, and they have no idea
    // why. Now they see a row with the error reason.
    const fresh: UploadItem[] = rejections.map((r) => ({
      localId: Math.random().toString(36).slice(2),
      file: r.file,
      status: "error",
      uploadProgress: 0,
      serverProgress: 0,
      serverDemoId: null,
      error: r.errors.map((e) => e.message).join(", ") || "Rejected",
    }));
    if (fresh.length > 0) {
      setItems((prev) => [...prev, ...fresh]);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive, open: openFileDialog } =
    useDropzone({
      onDrop,
      onDropRejected,
      // 2 GB cap — covers long pro matches and POV-style demos.
      // The original 500 MB cap rejected legitimate HLTV / long-OT
      // demos with "File is larger than 524288000 bytes" before
      // they even hit the server.
      maxSize: 2 * 1024 * 1024 * 1024,
      multiple: true,
      noClick: true, // we wire our own "click to browse" affordance
    });

  // ---- Background polling for active uploads -----------------------------
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      setItems((prev) => {
        const active = prev.filter(
          (it) =>
            it.serverDemoId !== null &&
            ACTIVE_SERVER_STATUSES.includes(it.status as DemoStatus),
        );
        if (active.length === 0) return prev;
        active.forEach((it) => {
          if (!it.serverDemoId) return;
          api.demos
            .status(it.serverDemoId)
            .then((res) => {
              setItems((cur) =>
                cur.map((c) =>
                  c.localId === it.localId
                    ? {
                        ...c,
                        status: res.status,
                        serverProgress: res.progress,
                        error: res.errorMessage ?? undefined,
                      }
                    : c,
                ),
              );
            })
            .catch(() => {
              /* the next tick will retry */
            });
        });
        return prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, [open]);

  // ---- Auto-flip / clamp into viewport -----------------------------------
  //
  // The trigger might sit near the bottom of the screen (sidebar
  // "Subir demo" button) — naively positioning the popover at
  // ``anchor.y`` then makes the popover overflow off the bottom.
  // After the first paint we measure the rendered popover height and
  // shift ``top`` upward so the bottom edge stays inside the viewport
  // (with an 8px safety margin). When the upload queue grows the
  // height changes and this re-fires.
  useLayoutEffect(() => {
    if (!open) {
      setAdjustedTop(null);
      return;
    }
    const el = containerRef.current;
    if (!el || !anchor) return;
    const rect = el.getBoundingClientRect();
    const vh = window.innerHeight;
    let top = anchor.y;
    if (top + rect.height > vh - 8) {
      // Doesn't fit below — flip upward so the BOTTOM aligns just
      // above the bottom of the viewport. Clamp to 8px from the top
      // when the popover would otherwise overflow the top edge.
      top = Math.max(8, vh - rect.height - 8);
    }
    if (top !== adjustedTop) setAdjustedTop(top);
  }, [open, anchor, items.length, adjustedTop]);

  // ---- Click outside + Escape to close -----------------------------------
  useEffect(() => {
    if (!open) return;
    function onPointer(e: MouseEvent) {
      const el = containerRef.current;
      if (!el) return;
      if (!el.contains(e.target as Node)) hide();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") hide();
    }
    // Defer one tick so the click that OPENED the popover isn't also
    // captured here and immediately closes it.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onPointer);
      window.addEventListener("keydown", onKey);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, hide]);

  if (!open) return null;

  // Default position: near top-left when no anchor (shouldn't happen
  // in practice — every trigger should pass one).
  const pos = anchor ?? { x: 80, y: 80 };

  // Horizontal: clamp into the viewport so the popover never falls
  // off the right edge (sidebar at x≈64 + offset + width is fine, but
  // /demos page anchors that pass ``x - width`` might go negative on
  // narrow screens — guard both directions).
  const left = Math.min(
    Math.max(pos.x + POPOVER_OFFSET_X, 8),
    typeof window !== "undefined"
      ? window.innerWidth - POPOVER_WIDTH - 8
      : pos.x,
  );
  // Vertical: use the first-paint position from ``anchor.y`` and let
  // the useLayoutEffect above override it once we know the real
  // rendered height. ``adjustedTop`` is null for the very first frame
  // so we fall back to the raw anchor, then immediately re-render with
  // the measured value — no visible flash because the effect fires
  // synchronously before the browser paints.
  const top = adjustedTop ?? Math.max(pos.y, 8);

  const removeItem = (localId: string) => {
    setItems((prev) => prev.filter((it) => it.localId !== localId));
  };

  const hasItems = items.length > 0;

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-label="Upload demo"
      className="fixed z-[100] rounded-2xl border border-border bg-surface/95 backdrop-blur-md shadow-2xl flex flex-col animate-in fade-in slide-in-from-left-2 duration-150"
      style={{
        left,
        top,
        width: POPOVER_WIDTH,
        maxHeight: "min(80vh, 600px)",
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50 flex-shrink-0">
        <h2 className="text-base font-display font-bold text-foreground">
          Upload demo
        </h2>
        <button
          onClick={hide}
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-surface-elevated"
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>

      {/* Body */}
      <div className="p-4 space-y-3 overflow-y-auto flex-1 min-h-0">
        {/* Dropzone */}
        <div
          {...getRootProps()}
          onClick={openFileDialog}
          className={cn(
            "rounded-xl border-2 border-dashed p-6 cursor-pointer transition-all duration-200 text-center",
            isDragActive
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/40 hover:bg-surface-elevated/40",
          )}
        >
          <input {...getInputProps()} />
          <div className="flex flex-col items-center gap-2">
            <div
              className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center transition-all",
                isDragActive
                  ? "bg-primary/20 text-primary"
                  : "bg-surface-elevated text-muted-foreground",
              )}
            >
              <UploadIcon size={18} />
            </div>
            {isDragActive ? (
              <>
                <p className="text-sm font-bold text-primary">Drop it!</p>
                <p className="text-[11px] text-muted-foreground">
                  Release to upload
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium text-foreground">
                  Drag .dem files here
                </p>
                <p className="text-[11px] text-muted-foreground">
                  or <span className="text-primary">click to browse</span>
                </p>
              </>
            )}
            <p className="text-[10px] text-muted-foreground/70 font-mono-rs uppercase tracking-wider mt-1">
              CS2 .DEM · MAX 2GB
            </p>
          </div>
        </div>

        {/* Upload queue */}
        {hasItems && (
          <div className="space-y-2">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider font-mono-rs">
              Uploads ({items.length})
            </h3>
            <div className="space-y-1.5">
              {items.map((it) => (
                <UploadRow
                  key={it.localId}
                  item={it}
                  onRemove={removeItem}
                  onOpen={(id) => {
                    hide();
                    router.push(`/demo/${id}/replay`);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-border/50 flex-shrink-0">
        <Link
          href="/demos"
          onClick={hide}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
        >
          Previous uploads
        </Link>
        <div className="flex items-center gap-2">
          <button
            onClick={hide}
            className="text-xs px-3 py-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-surface-elevated transition-colors"
          >
            Close
          </button>
          <button
            onClick={openFileDialog}
            className="text-xs font-semibold px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            Upload
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

async function startUpload(
  localId: string,
  file: File,
  setItems: React.Dispatch<React.SetStateAction<UploadItem[]>>,
) {
  setItems((prev) =>
    prev.map((it) =>
      it.localId === localId
        ? { ...it, status: "uploading", uploadProgress: 0 }
        : it,
    ),
  );

  try {
    const result = await uploadWithProgress(file, (pct) => {
      setItems((prev) =>
        prev.map((it) =>
          it.localId === localId ? { ...it, uploadProgress: pct } : it,
        ),
      );
    });
    setItems((prev) =>
      prev.map((it) =>
        it.localId === localId
          ? {
              ...it,
              status: result.status,
              uploadProgress: 100,
              serverDemoId: result.id,
            }
          : it,
      ),
    );
  } catch (err) {
    setItems((prev) =>
      prev.map((it) =>
        it.localId === localId
          ? {
              ...it,
              status: "error",
              error: err instanceof Error ? err.message : "Upload failed",
            }
          : it,
      ),
    );
  }
}

function uploadWithProgress(
  file: File,
  onProgress: (pct: number) => void,
): Promise<{ id: string; status: DemoStatus }> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("file", file);

    const xhr = new XMLHttpRequest();
    const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    xhr.open("POST", `${baseUrl}/demos/upload`);
    // Send the auth cookie so the upload is attributed to the
    // logged-in user (the demos router records ``user_id``).
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText);
          resolve({ id: body.id, status: body.status });
        } catch {
          reject(new Error("Invalid server response"));
        }
      } else {
        let detail = xhr.statusText;
        try {
          const body = JSON.parse(xhr.responseText);
          if (body?.detail) detail = body.detail;
        } catch {
          /* keep statusText */
        }
        reject(new Error(detail));
      }
    };

    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(fd);
  });
}

function UploadRow({
  item,
  onRemove,
  onOpen,
}: {
  item: UploadItem;
  onRemove: (localId: string) => void;
  onOpen: (demoId: string) => void;
}) {
  const cfg = statusConfig(item);
  const Icon = cfg.icon;
  const showSpinner =
    item.status === "uploading" ||
    item.status === "queued" ||
    item.status === "processing" ||
    item.status === "uploaded";

  const pct =
    item.status === "uploading"
      ? item.uploadProgress
      : showSpinner
        ? item.serverProgress
        : 100;

  return (
    <div className="bg-surface-elevated/60 px-3 py-2 rounded-lg flex items-center gap-2">
      <FileIcon size={12} className="text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-0.5 gap-2">
          <span className="text-[11px] font-medium truncate">
            {item.file.name}
          </span>
          <span
            className={`text-[10px] font-mono-rs flex items-center gap-1 ${cfg.color} flex-shrink-0`}
          >
            <Icon size={10} className={showSpinner ? "animate-spin" : ""} />
            {cfg.label}
          </span>
        </div>
        {(showSpinner || item.status === "completed") && (
          <div className="h-1 bg-surface rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                item.status === "completed" ? "bg-win" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {item.error && (
          <div className="text-[10px] text-loss font-mono-rs mt-0.5 truncate">
            {item.error}
          </div>
        )}
      </div>
      {item.status === "completed" && item.serverDemoId && (
        <button
          onClick={() => onOpen(item.serverDemoId!)}
          className="text-primary hover:text-primary/80 transition-colors p-1"
          title="Open analysis"
        >
          <ExternalLink size={12} />
        </button>
      )}
      {(item.status === "completed" ||
        item.status === "error" ||
        item.status === "failed") && (
        <button
          onClick={() => onRemove(item.localId)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

function statusConfig(item: UploadItem): {
  icon: React.ElementType;
  color: string;
  label: string;
} {
  switch (item.status) {
    case "pending":
      return {
        icon: FileIcon,
        color: "text-muted-foreground",
        label: "Pending",
      };
    case "uploading":
      return {
        icon: Loader2,
        color: "text-primary",
        label: `${item.uploadProgress}%`,
      };
    case "uploaded":
    case "queued":
      return { icon: Loader2, color: "text-primary", label: "Queued" };
    case "processing":
      return {
        icon: Loader2,
        color: "text-accent",
        label: `${item.serverProgress}%`,
      };
    case "completed":
      return { icon: CheckCircle2, color: "text-win", label: "Done" };
    case "failed":
    case "error":
      return {
        icon: AlertCircle,
        color: "text-loss",
        label: item.error ? "Error" : "Failed",
      };
  }
}
