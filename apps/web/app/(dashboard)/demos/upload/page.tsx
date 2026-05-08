"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useDropzone } from "react-dropzone";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  File as FileIcon,
  Loader2,
  Upload,
  X,
} from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { DemoStatus } from "@/types/demo";

type LocalStatus =
  | "pending"
  | "uploading"
  | DemoStatus // server-side states
  | "error";

interface UploadItem {
  localId: string;
  file: File;
  status: LocalStatus;
  uploadProgress: number; // 0..100, while uploading
  serverProgress: number; // 0..100, while processing
  serverDemoId: string | null;
  error?: string;
}

const ACTIVE_SERVER_STATUSES: DemoStatus[] = ["uploaded", "queued", "processing"];

export default function UploadPage() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const router = useRouter();

  const onDrop = useCallback((accepted: File[]) => {
    const fresh: UploadItem[] = accepted.map((f) => ({
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

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dem"] },
    maxSize: 500 * 1024 * 1024,
    multiple: true,
  });

  const removeItem = (localId: string) => {
    setItems((prev) => prev.filter((it) => it.localId !== localId));
  };

  // Background polling — every 1.5s walk the active server uploads and refresh status.
  useEffect(() => {
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
              // ignore polling errors — the next tick will retry
            });
        });
        return prev;
      });
    }, 1500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">Upload Demo</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Upload CS2 .dem files for automatic analysis. Up to 500MB per file.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={cn(
          "relative rounded-2xl border-2 border-dashed p-12 cursor-pointer transition-all duration-200 text-center group",
          isDragActive
            ? "border-primary bg-primary/5 scale-[1.01]"
            : "border-border hover:border-primary/50 hover:bg-surface",
        )}
      >
        <input {...getInputProps()} />
        <div className="relative space-y-4">
          <div
            className={cn(
              "w-16 h-16 rounded-2xl mx-auto flex items-center justify-center transition-all duration-200",
              isDragActive
                ? "bg-primary/15 scale-110"
                : "bg-surface-elevated group-hover:bg-primary/10",
            )}
          >
            <Upload
              size={24}
              className={cn(
                "transition-colors duration-200",
                isDragActive
                  ? "text-primary"
                  : "text-muted-foreground group-hover:text-primary",
              )}
            />
          </div>

          {isDragActive ? (
            <div>
              <p className="text-lg font-display font-bold text-primary">Drop it!</p>
              <p className="text-sm text-muted-foreground">Release to upload your demo</p>
            </div>
          ) : (
            <div>
              <p className="text-base font-semibold text-foreground">
                Drag &amp; drop your .dem file here
              </p>
              <p className="text-sm text-muted-foreground mt-1">
                or <span className="text-primary font-medium">click to browse</span>
              </p>
            </div>
          )}

          <div className="flex items-center justify-center gap-6 text-xs text-muted-foreground font-mono-rs">
            <span>CS2 .DEM</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span>MAX 500MB</span>
            <span className="w-1 h-1 rounded-full bg-border" />
            <span>MULTIPLE FILES</span>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground font-mono-rs uppercase tracking-wider">
            Uploads ({items.length})
          </h3>
          {items.map((it) => (
            <UploadRow
              key={it.localId}
              item={it}
              onRemove={removeItem}
              onOpen={(id) => router.push(`/demo/${id}/replay`)}
            />
          ))}
        </div>
      )}

      <div className="glass-card p-4 rounded-xl">
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="text-foreground font-semibold">Processing time:</span> typically 1–3 minutes
          per demo depending on file size. Demos are processed securely and only
          accessible to you.
        </p>
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
      it.localId === localId ? { ...it, status: "uploading", uploadProgress: 0 } : it,
    ),
  );

  // Use XHR so we can show byte-level upload progress.
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
        } catch (err) {
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

// ---------------------------------------------------------------------------

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
    <div className="glass-card p-4 rounded-xl flex items-center gap-3">
      <FileIcon size={16} className="text-muted-foreground flex-shrink-0" />

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium truncate">{item.file.name}</span>
          <span className={`text-xs font-mono-rs flex items-center gap-1 ${cfg.color}`}>
            <Icon size={12} className={showSpinner ? "animate-spin" : ""} />
            {cfg.label}
          </span>
        </div>

        {(showSpinner || item.status === "completed") && (
          <div className="h-1 bg-surface-elevated rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all duration-300",
                item.status === "completed" ? "bg-win" : "bg-primary",
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <div className="text-xs text-muted-foreground font-mono-rs mt-1">
          {(item.file.size / (1024 * 1024)).toFixed(1)} MB
          {item.error && <span className="text-loss ml-2">• {item.error}</span>}
        </div>
      </div>

      {item.status === "completed" && item.serverDemoId && (
        <button
          onClick={() => onOpen(item.serverDemoId!)}
          className="text-primary hover:text-primary/80 transition-colors p-1"
          title="Open analysis"
        >
          <ExternalLink size={14} />
        </button>
      )}

      {(item.status === "completed" || item.status === "error" || item.status === "failed") && (
        <button
          onClick={() => onRemove(item.localId)}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
        >
          <X size={14} />
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
      return { icon: FileIcon, color: "text-muted-foreground", label: "Pending" };
    case "uploading":
      return { icon: Loader2, color: "text-primary", label: `${item.uploadProgress}%` };
    case "uploaded":
    case "queued":
      return { icon: Loader2, color: "text-primary", label: "Queued" };
    case "processing":
      return {
        icon: Loader2,
        color: "text-accent",
        label: `Analyzing ${item.serverProgress}%`,
      };
    case "completed":
      return { icon: CheckCircle2, color: "text-win", label: "Complete" };
    case "failed":
    case "error":
      return { icon: AlertCircle, color: "text-loss", label: item.error ?? "Error" };
  }
}
