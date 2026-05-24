"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { useAuthStore } from "@/lib/stores/auth";

/**
 * Steam OpenID callback page.
 *
 * Lives at the LITERAL path ``/auth/steam/callback`` (not the
 * ``(auth)`` route group) because the Steam OpenID return_to URL is
 * hard-coded to ``${frontend_origin}/auth/steam/callback`` on the
 * backend — route-group parentheses don't add to the URL, so a page
 * at ``app/(auth)/steam/callback`` actually serves ``/steam/callback``
 * and Steam's redirect 404'd.
 *
 * Next.js requires components that read ``useSearchParams`` to live
 * inside a Suspense boundary during prerendering, otherwise the
 * static export step fails. The outer shell handles that; the inner
 * component does the actual work.
 */
export default function SteamCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
          <p className="text-muted-foreground animate-pulse">Cargando…</p>
        </div>
      }
    >
      <SteamCallbackInner />
    </Suspense>
  );
}

function SteamCallbackInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const { fetchMe } = useAuthStore();
  // useRef-as-mutex against React StrictMode's double-mount in dev.
  // The Steam OpenID nonce is single-use — calling /auth/steam/callback
  // twice with the same params makes Steam reject the second call
  // with 401, which would clobber the first call's success and show
  // an error on screen even though the user IS authenticated. The
  // guard ensures the network call fires exactly once.
  const calledRef = useRef(false);

  useEffect(() => {
    const handleCallback = async () => {
      if (calledRef.current) return;
      calledRef.current = true;
      try {
        const params = searchParams.toString();
        await api.auth.steam.callback(params);
        await fetchMe();
        router.push("/demos");
      } catch (err: any) {
        console.error("Steam Auth Error:", err);
        setError(err.message || "Fallo la autenticación con Steam");
      }
    };

    if (searchParams.get("openid.mode")) {
      handleCallback();
    }
  }, [searchParams, router, fetchMe]);

  if (error) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4 px-6">
        <div className="max-w-md p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-500 text-sm text-center">
          {error}
        </div>
        <button
          onClick={() => router.push("/login")}
          className="text-primary hover:underline text-sm"
        >
          Volver al login
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center space-y-4">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
      <p className="text-muted-foreground animate-pulse">
        Verificando cuenta de Steam...
      </p>
    </div>
  );
}
