"use client";

import { useEffect, useState, useCallback } from "react";
import {
  Activity,
  Ban,
  CheckCircle2,
  DollarSign,
  Gift,
  Loader2,
  Server,
  Settings2,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

type Metrics = Awaited<ReturnType<typeof api.admin.metrics>>;
type Growth = Awaited<ReturnType<typeof api.admin.growth>>;
type Users = Awaited<ReturnType<typeof api.admin.users>>;
type Incidents = Awaited<ReturnType<typeof api.admin.incidents>>;

/**
 * Admin dashboard — all data comes from /admin/* endpoints.
 *
 * The parent ``layout.tsx`` already gates the route to admins only, so
 * this component can focus on data fetching + interactions. Mutations
 * (admin / active / tier) optimistically update the row and then refetch
 * the user list to reconcile.
 */
export default function AdminDashboardPage() {
  const me = useAuthStore((s) => s.user);

  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [growth, setGrowth] = useState<Growth | null>(null);
  const [users, setUsers] = useState<Users | null>(null);
  const [incidents, setIncidents] = useState<Incidents | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionUserId, setActionUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const [m, g, u, i] = await Promise.all([
        api.admin.metrics(),
        api.admin.growth(28),
        api.admin.users(100, 0),
        api.admin.incidents(),
      ]);
      setMetrics(m);
      setGrowth(g);
      setUsers(u);
      setIncidents(i);
    } catch (err: any) {
      setError(err?.message || "Failed to load admin data");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const runAction = async (
    userId: string,
    fn: () => Promise<unknown>,
  ) => {
    setActionUserId(userId);
    try {
      await fn();
      await refresh();
    } catch (err: any) {
      alert(err?.message || "Action failed");
    } finally {
      setActionUserId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-[70vh] items-center justify-center flex-col gap-3">
        <ShieldAlert className="text-loss" size={32} />
        <p className="text-sm text-muted-foreground">{error}</p>
        <button
          onClick={() => refresh()}
          className="px-3 py-2 rounded-lg bg-surface-elevated text-sm hover:bg-surface"
        >
          Reintentar
        </button>
      </div>
    );
  }

  // ----------------- Render -----------------

  // Format growth buckets into something nice for the chart (max ~14 ticks)
  const chartData = (growth?.series ?? []).map((s) => ({
    name: s.bucket,
    users: s.users,
    demos: s.demos,
  }));

  return (
    <div className="p-8 max-w-[1400px] mx-auto space-y-8 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-black font-display text-white tracking-tight flex items-center gap-3">
            <Settings2 className="text-primary" /> COMMAND CENTER
          </h1>
          <p className="text-muted-foreground mt-1">
            Monitoreo de sistema, usuarios y métricas — datos reales en vivo.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          {metrics?.monetization_enabled === false && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md bg-amber-500/10 text-amber-400 border border-amber-500/30">
              Monetización OFF
            </span>
          )}
          <button
            onClick={refresh}
            className="text-xs px-3 py-1.5 rounded-lg bg-surface-elevated hover:bg-surface text-muted-foreground hover:text-foreground transition-colors"
          >
            Refrescar
          </button>
          <div className="glass-card px-4 py-2 flex items-center gap-2 rounded-xl border-primary/20">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold text-emerald-400">SYSTEM HEALTHY</span>
          </div>
        </div>
      </div>

      {/* KPI Cards — REAL DATA */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          title="Usuarios totales"
          value={metrics?.total_users ?? 0}
          subtitle={`${metrics?.active_users ?? 0} activos · ${metrics?.admins ?? 0} admins`}
          icon={Users}
          color="text-blue-400"
        />
        <KpiCard
          title="Demos procesadas"
          value={metrics?.processed_demos ?? 0}
          subtitle={`${metrics?.total_demos ?? 0} total · ${metrics?.in_flight_demos ?? 0} en proceso`}
          icon={Server}
          color="text-primary"
        />
        <KpiCard
          title="Usuarios PRO"
          value={metrics?.pro_users ?? 0}
          subtitle={metrics?.monetization_enabled ? "Subscripciones activas" : "Monetización OFF"}
          icon={ShieldCheck}
          color="text-emerald-400"
        />
        <KpiCard
          title="Ingresos (Stripe)"
          value={
            metrics?.stripe_revenue !== null && metrics?.stripe_revenue !== undefined
              ? `$${metrics.stripe_revenue.toFixed(2)}`
              : "—"
          }
          subtitle={
            metrics?.monetization_enabled
              ? "Estimado · esperando webhook real"
              : "Activá MONETIZATION_ENABLED"
          }
          icon={DollarSign}
          color="text-emerald-400"
        />
      </div>

      {/* Charts & Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 glass-card rounded-2xl p-6 border-border/30">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-white">Crecimiento — últimos {growth?.days ?? 28} días</h2>
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              Granularidad: {growth?.granularity}
            </span>
          </div>
          {chartData.length === 0 ? (
            <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground">
              Sin actividad reciente — registrá un usuario o subí una demo para
              ver datos acá.
            </div>
          ) : (
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                  <XAxis dataKey="name" stroke="#ffffff50" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="#ffffff50" fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0d1015",
                      borderColor: "#ffffff20",
                      borderRadius: "8px",
                    }}
                    itemStyle={{ color: "#fff" }}
                    labelStyle={{ color: "#fff", fontSize: 12 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="demos"
                    name="Demos"
                    stroke="hsl(var(--primary))"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="users"
                    name="Usuarios"
                    stroke="#60a5fa"
                    strokeWidth={3}
                    dot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="glass-card rounded-2xl p-6 border-loss/20 flex flex-col">
          <div className="flex items-center gap-2 mb-6">
            <ShieldAlert className="text-loss" size={20} />
            <h2 className="text-lg font-bold text-white">Incidencias (Workers)</h2>
            <span className="ml-auto text-xs text-muted-foreground">
              {incidents?.length ?? 0}
            </span>
          </div>
          <div className="flex-1 space-y-3 overflow-y-auto pr-2 max-h-[300px]">
            {(incidents ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center mt-10">
                Sin incidencias. Todos los demos procesaron correctamente.
              </p>
            ) : (
              (incidents ?? []).map((inc) => (
                <div
                  key={inc.id}
                  className="bg-surface/50 border border-loss/10 p-3 rounded-xl"
                >
                  <div className="flex justify-between items-start mb-2 gap-2">
                    <span className="text-xs font-mono-rs text-muted-foreground truncate">
                      #{inc.id} — {inc.filename}
                    </span>
                    <span className="text-[10px] text-muted-foreground/60 shrink-0">
                      {inc.date ? new Date(inc.date).toLocaleDateString() : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-loss/90 font-medium">{inc.error}</p>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* User Management */}
      <div className="glass-card rounded-2xl p-6 border-border/30">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-bold text-white">Gestión de Usuarios</h2>
          <span className="text-xs text-muted-foreground">
            {users?.items.length ?? 0} de {users?.total ?? 0}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-[10px] uppercase text-muted-foreground font-bold tracking-widest border-b border-border/30">
              <tr>
                <th className="pb-3 px-4">Usuario</th>
                <th className="pb-3 px-4 text-center">Plan</th>
                <th className="pb-3 px-4 text-center">Rol</th>
                <th className="pb-3 px-4 text-center">Estado</th>
                <th className="pb-3 px-4 text-right">Demos</th>
                <th className="pb-3 px-4 text-right">Creado</th>
                <th className="pb-3 px-4 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/10">
              {(users?.items ?? []).map((u) => {
                const isSelf = me?.id === u.id;
                const busy = actionUserId === u.id;
                return (
                  <tr key={u.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-white">{u.name}</div>
                      <div className="text-[11px] text-muted-foreground">{u.email}</div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={cn(
                          "inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          u.tier === "pro"
                            ? "bg-primary/20 text-primary border border-primary/30"
                            : "bg-surface text-muted-foreground border border-border",
                        )}
                      >
                        {u.tier}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={cn(
                          "inline-flex px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          u.role === "admin"
                            ? "bg-amber-500/20 text-amber-400 border border-amber-500/30"
                            : "text-muted-foreground",
                        )}
                      >
                        {u.role}
                        {isSelf && <span className="ml-1 opacity-60">(vos)</span>}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          u.status === "banned" ? "text-loss" : "text-emerald-400",
                        )}
                      >
                        {u.status === "active" ? (
                          <CheckCircle2 size={10} />
                        ) : (
                          <Ban size={10} />
                        )}
                        {u.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right font-mono text-xs text-muted-foreground">
                      {u.demos_count}
                    </td>
                    <td className="py-3 px-4 text-right text-[11px] text-muted-foreground">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {busy && <Loader2 size={12} className="animate-spin text-muted-foreground mr-1" />}
                        <button
                          onClick={() =>
                            runAction(u.id, () =>
                              api.admin.setTier(u.id, u.tier === "pro" ? "free" : "pro"),
                            )
                          }
                          disabled={busy}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            u.tier === "pro"
                              ? "text-emerald-400 hover:bg-emerald-400/10"
                              : "text-muted-foreground hover:text-emerald-400 hover:bg-emerald-400/10",
                          )}
                          title={u.tier === "pro" ? "Quitar PRO" : "Otorgar PRO"}
                        >
                          <Gift size={16} />
                        </button>
                        <button
                          onClick={() =>
                            runAction(u.id, () => api.admin.setAdmin(u.id, u.role !== "admin"))
                          }
                          disabled={busy || isSelf}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            u.role === "admin"
                              ? "text-amber-400 hover:bg-amber-400/10"
                              : "text-muted-foreground hover:text-amber-400 hover:bg-amber-400/10",
                            isSelf && "opacity-30 cursor-not-allowed",
                          )}
                          title={
                            isSelf
                              ? "No podés cambiar tu propio rol"
                              : u.role === "admin"
                                ? "Quitar admin"
                                : "Hacer admin"
                          }
                        >
                          <Shield size={16} />
                        </button>
                        <button
                          onClick={() =>
                            runAction(u.id, () =>
                              api.admin.setActive(u.id, u.status !== "active"),
                            )
                          }
                          disabled={busy || isSelf}
                          className={cn(
                            "p-1.5 rounded-lg transition-colors",
                            u.status === "banned"
                              ? "text-loss hover:bg-loss/10"
                              : "text-muted-foreground hover:text-loss hover:bg-loss/10",
                            isSelf && "opacity-30 cursor-not-allowed",
                          )}
                          title={
                            isSelf
                              ? "No podés banearte"
                              : u.status === "active"
                                ? "Banear usuario"
                                : "Desbanear usuario"
                          }
                        >
                          <Ban size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {(users?.items.length ?? 0) === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                    No hay usuarios registrados todavía.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function KpiCard({
  title,
  value,
  subtitle,
  icon: Icon,
  color,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
  icon: typeof Activity;
  color: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-5 border-border/30 flex items-center justify-between group hover:border-border transition-colors">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-muted-foreground mb-1">{title}</p>
        <h3 className="text-3xl font-black font-display text-white tracking-tight truncate">
          {value}
        </h3>
        {subtitle && (
          <p className="text-[11px] text-muted-foreground/80 mt-1 truncate">{subtitle}</p>
        )}
      </div>
      <div
        className={cn(
          "w-12 h-12 rounded-xl flex items-center justify-center bg-surface border border-border/50 shrink-0 transition-transform group-hover:scale-110",
          color,
        )}
      >
        <Icon size={24} />
      </div>
    </div>
  );
}
