"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ShieldAlert, Loader2 } from "lucide-react";

import { useAuthStore } from "@/lib/stores/auth";

/**
 * Admin route gate.
 *
 * Renders a denied screen for non-admins and redirects to /demos after a
 * short delay. We don't redirect immediately so the user actually sees the
 * 403 reason (otherwise a deep-link refresh would just bounce silently).
 *
 * Children only render when ``user.is_admin === true``. The page itself
 * still re-checks (defence in depth) but trusts this layout for the basic
 * gate so it can focus on data fetching.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const router = useRouter();

  // If we don't have a user yet, attempt to hydrate from cookies/tokens
  // once. Avoids the "ACCESO DENEGADO" flash on first paint when an
  // admin reloads /admin directly.
  useEffect(() => {
    if (user === null && !isLoading) {
      fetchMe();
    }
  }, [user, isLoading, fetchMe]);

  // Bounce non-admins after 2s so deep links don't trap them.
  useEffect(() => {
    if (user && !user.is_admin) {
      const t = setTimeout(() => router.replace("/demos"), 2000);
      return () => clearTimeout(t);
    }
  }, [user, router]);

  if (isLoading || user === null) {
    return (
      <div className="flex h-[70vh] items-center justify-center">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }

  if (!user.is_admin) {
    return (
      <div className="flex h-[70vh] items-center justify-center flex-col gap-4 text-center px-6">
        <ShieldAlert size={64} className="text-loss" />
        <h1 className="text-2xl font-black font-display text-white">ACCESO DENEGADO</h1>
        <p className="text-muted-foreground max-w-md">
          Esta zona es exclusiva para administradores del sistema. Si crees que
          es un error, contactá al equipo. Redirigiendo a /demos…
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
