"use client";

import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { CheckCircle2, FileVideo, Loader2, UploadCloud } from "lucide-react";

import { useUploadDemo } from "@/lib/hooks/useDemos";

export function DemoUploadCard() {
  const upload = useUploadDemo();
  const [fileName, setFileName] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const onDrop = useCallback(
    async (accepted: File[]) => {
      const file = accepted[0];
      if (!file) return;
      setFileName(file.name);
      setSuccessMessage(null);
      try {
        const res = await upload.mutateAsync(file);
        setSuccessMessage(`Demo queued (#${res.id}) — analyzing now`);
      } catch {
        // error surfaces via upload.error
      }
    },
    [upload],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { "application/octet-stream": [".dem"] },
    maxFiles: 1,
    // 2 GB cap — see UploadDemoPopover for rationale.
    maxSize: 2 * 1024 * 1024 * 1024,
  });

  const uploading = upload.isPending;
  const errorMessage = upload.error instanceof Error ? upload.error.message : null;

  return (
    <div className="glass-card rounded-2xl p-6 border border-white/5">
      <div className="mb-5">
        <h2 className="text-xl font-semibold">Demo Upload</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Drop CS2 .dem files to start automatic analysis.
        </p>
      </div>

      <div
        {...getRootProps()}
        className={`border border-dashed rounded-xl p-10 transition-all cursor-pointer text-center ${
          isDragActive ? "border-primary bg-primary/5" : "border-white/10 hover:border-primary/40"
        }`}
      >
        <input {...getInputProps()} />

        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
            {uploading ? <Loader2 className="animate-spin" /> : <UploadCloud />}
          </div>

          <div>
            <p className="font-medium">
              {uploading ? "Uploading demo..." : "Drag & drop your demo here"}
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              FACEIT, Premier and scrim demos supported.
            </p>
          </div>

          {fileName && (
            <div className="inline-flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-surface-elevated">
              <FileVideo size={16} />
              {fileName}
            </div>
          )}

          {successMessage && (
            <div className="inline-flex items-center gap-2 text-sm text-win">
              <CheckCircle2 size={16} />
              {successMessage}
            </div>
          )}

          {errorMessage && <div className="text-sm text-loss">{errorMessage}</div>}
        </div>
      </div>
    </div>
  );
}
