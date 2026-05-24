"use client";

import { create } from "zustand";

import { api, type AuthUser } from "@/lib/api";

export type { AuthUser } from "@/lib/api";

interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  /** Re-hydrate user state from the auth cookie. Safe to call multiple times. */
  fetchMe: () => Promise<void>;
  /** Hit ``/auth/logout`` to clear the cookie and zero local state. */
  logout: () => Promise<void>;
}

/**
 * Cookie-backed auth store.
 *
 * The actual session lives in an ``access_token`` httpOnly cookie set by
 * ``/auth/steam/callback`` — Zustand only mirrors the resolved user so
 * components can render synchronously instead of awaiting a fetch on
 * every paint.
 *
 * Pattern:
 *   - On first paint, components call ``fetchMe()`` (typically from a
 *     ``useEffect`` in the dashboard layout).
 *   - When the user clicks "logout" we call ``logout()`` which both
 *     clears the cookie server-side and resets local state.
 *   - 401s from any API call are NOT auto-handled here — call sites
 *     decide whether to redirect to /login or show an inline prompt.
 */
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: false,
  fetchMe: async () => {
    set({ isLoading: true });
    try {
      const me = await api.auth.me();
      set({ user: me, isLoading: false });
    } catch {
      // 401 / 404 / network — treat as logged out. The admin gate
      // shows its "ACCESO DENEGADO" screen in this state.
      set({ user: null, isLoading: false });
    }
  },
  logout: async () => {
    try {
      await api.auth.logout();
    } catch {
      // Already-expired cookie is fine — local state is still reset.
    }
    set({ user: null, isLoading: false });
  },
}));
