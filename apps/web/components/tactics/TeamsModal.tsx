"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Plus, Users, Copy, Check, Trash2, LogOut, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { TeamInfo } from "@/types/playbook";

export function TeamsModal({
  open,
  onClose,
  onChange,
}: {
  open: boolean;
  onClose: () => void;
  onChange?: () => void;
}) {
  const [teams, setTeams] = useState<TeamInfo[] | null>(null);
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      setTeams(await api.teams.list());
    } catch {
      setTeams([]);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setError(null);
      refresh();
    }
  }, [open, refresh]);

  if (!open) return null;

  const fireChange = () => {
    refresh();
    onChange?.();
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.teams.create(name.trim());
      setName("");
      fireChange();
    } catch {
      setError("Couldn't create the team.");
    } finally {
      setBusy(false);
    }
  };

  const join = async () => {
    if (!code.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.teams.join(code.trim());
      setCode("");
      fireChange();
    } catch {
      setError("Invalid invite code.");
    } finally {
      setBusy(false);
    }
  };

  const leaveOrDelete = async (t: TeamInfo) => {
    setBusy(true);
    setError(null);
    try {
      if (t.role === "owner") await api.teams.delete(t.id);
      else await api.teams.leave(t.id);
      fireChange();
    } catch {
      setError("Action failed.");
    } finally {
      setBusy(false);
    }
  };

  const copy = (t: TeamInfo) => {
    try {
      navigator.clipboard.writeText(t.inviteCode);
      setCopied(t.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* */
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-surface shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display font-bold text-lg flex items-center gap-2">
            <Users size={18} className="text-primary" /> Teams
          </h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="p-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="rounded-lg bg-loss/10 border border-loss/30 text-loss text-xs px-3 py-2">{error}</div>
          )}

          {/* Create + join */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground font-mono-rs uppercase tracking-wider">Create team</label>
              <div className="flex gap-1.5">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && create()}
                  placeholder="Team name"
                  className="flex-1 min-w-0 bg-surface-elevated border border-border rounded-md px-2.5 py-2 text-sm focus:outline-none focus:border-primary/60"
                />
                <button onClick={create} disabled={busy || !name.trim()} className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors">
                  <Plus size={16} />
                </button>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] text-muted-foreground font-mono-rs uppercase tracking-wider">Join by code</label>
              <div className="flex gap-1.5">
                <input
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && join()}
                  placeholder="invite code"
                  className="flex-1 min-w-0 bg-surface-elevated border border-border rounded-md px-2.5 py-2 text-sm font-mono-rs focus:outline-none focus:border-primary/60"
                />
                <button onClick={join} disabled={busy || !code.trim()} className="flex h-9 px-3 items-center justify-center rounded-md border border-border text-sm hover:bg-surface-elevated transition-colors disabled:opacity-50">
                  Join
                </button>
              </div>
            </div>
          </div>

          {/* My teams */}
          <div>
            <div className="text-[11px] text-muted-foreground font-mono-rs uppercase tracking-wider mb-2">My teams</div>
            {teams === null ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-6 justify-center">
                <Loader2 size={15} className="animate-spin" /> Loading…
              </div>
            ) : teams.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">
                You're not in any team yet. Create one and share its code, or join with a code.
              </p>
            ) : (
              <div className="space-y-2">
                {teams.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-elevated/40 px-3 py-2.5">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold truncate">{t.name}</span>
                        <span className={cn("text-[10px] px-1.5 py-0.5 rounded font-mono-rs uppercase", t.role === "owner" ? "bg-primary-dim/50 text-primary" : "bg-surface text-muted-foreground")}>
                          {t.role}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-muted-foreground">
                        <span>{t.memberCount} member{t.memberCount === 1 ? "" : "s"}</span>
                        <span>·</span>
                        <button onClick={() => copy(t)} className="inline-flex items-center gap-1 font-mono-rs hover:text-foreground transition-colors" title="Copy invite code">
                          {copied === t.id ? <Check size={11} className="text-win" /> : <Copy size={11} />}
                          {t.inviteCode}
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => leaveOrDelete(t)}
                      disabled={busy}
                      title={t.role === "owner" ? "Delete team" : "Leave team"}
                      className="p-2 rounded-md text-muted-foreground hover:text-loss hover:bg-loss/10 transition-colors disabled:opacity-50"
                    >
                      {t.role === "owner" ? <Trash2 size={15} /> : <LogOut size={15} />}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
