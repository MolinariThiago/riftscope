"use client";

// Mini vertical zoom rail — cs2.cam-style.
// Sits in the top-left corner. Compact lock + zoom in/out + reset + screenshot.

import { Lock, Unlock, ZoomIn, ZoomOut, RotateCcw, Camera, type LucideIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";
import type { TacticalBoardHandle } from "./TacticalBoard";

export function ZoomControls({ board }: { board: TacticalBoardHandle | null }) {
  const [locked, setLocked] = useState(false);

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border/60 bg-surface/95 backdrop-blur-xl p-1 shadow-2xl">
      <ZoomBtn
        icon={locked ? Lock : Unlock}
        title={locked ? "Desbloquear vista" : "Bloquear vista"}
        active={locked}
        onClick={() => setLocked((v) => !v)}
      />
      <ZoomBtn icon={ZoomIn} title="Zoom in" onClick={() => board?.zoomBy(1.4)} />
      <ZoomBtn icon={ZoomOut} title="Zoom out" onClick={() => board?.zoomBy(1 / 1.4)} />
      <ZoomBtn icon={RotateCcw} title="Resetear vista" onClick={() => board?.resetView()} />
      <ZoomBtn icon={Camera} title="Captura" onClick={() => board?.screenshot()} />
    </div>
  );
}

function ZoomBtn({
  icon: Icon,
  title,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={cn(
        "h-8 w-8 flex items-center justify-center rounded-lg transition-colors",
        active
          ? "bg-primary-dim/60 text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-surface-elevated",
      )}
    >
      <Icon size={14} />
    </button>
  );
}
