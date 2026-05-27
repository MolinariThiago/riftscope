"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { UploadDemoPopover } from "@/components/layout/UploadDemoPopover";
import { useAuthStore } from "@/lib/stores/auth";
import { cn } from "@/lib/utils";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const router = useRouter();
  // Hydrate the auth store ONCE at the dashboard layout level so the
  // TopBar / Sidebar / admin gate all read from the same source. Before
  // this lived in the admin layout only, which meant the avatar in the
  // TopBar didn't reflect the logged-in user and the admin link in the
  // sidebar never knew whether to render. Calling it here covers every
  // dashboard route.
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const user = useAuthStore((s) => s.user);
  // ``authChecked`` flips to true exactly once after the first
  // ``fetchMe`` settles (success OR failure).  We need this gate
  // because on the very first render ``user === null`` simply means
  // "we haven't asked yet" — without the gate the redirect below
  // would bounce a logged-in user to /login for a flash before the
  // store hydrates.
  const [authChecked, setAuthChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchMe().finally(() => {
      if (!cancelled) setAuthChecked(true);
    });
    return () => {
      cancelled = true;
    };
    // Run once on mount — fetchMe is idempotent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Defence-in-depth route guard: every backend endpoint now requires
  // auth, but having the frontend redirect anonymous visitors avoids
  // a flash of dashboard chrome + a wave of 401s before the user
  // realises they need to log in.  We also forward the original path
  // via ``?next=`` so /login can return them after Steam OpenID.
  useEffect(() => {
    if (authChecked && user === null) {
      const next = encodeURIComponent(pathname || "/demos");
      router.replace(`/login?next=${next}`);
    }
  }, [authChecked, user, pathname, router]);

  // While we're checking the cookie OR mid-redirect, render a small
  // spinner instead of the dashboard chrome.  Avoids the flash of
  // protected content for anonymous users.
  if (!authChecked || user === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <Loader2 className="animate-spin text-primary" size={28} />
      </div>
    );
  }
  // The 2D analysis (replay) view wants every available pixel for the
  // map. Hide the top search bar, drop the main-area padding, and
  // force the sidebar into compact icon-only mode while we're on
  // that route. Everything else keeps the normal dashboard chrome.
  const isReplay = /\/demo\/[^/]+\/replay(\/|$)/.test(pathname);

  return (
    <div className="flex h-screen bg-background overflow-hidden relative">
      <div className="mesh-bg opacity-30" />
      <Sidebar forceCollapsed={isReplay} />
      <div className="flex-1 flex flex-col overflow-hidden relative z-10">
        {!isReplay && <TopBar />}
        <main
          className={cn(
            "flex-1 min-h-0 noise-overlay",
            // Replay needs ``position: relative`` so the page inside
            // can position itself with ``absolute inset-0`` and fill
            // main reliably regardless of how the flex chain resolves
            // height. ``h-full`` cascading through ``flex: 1`` parents
            // is fragile across browsers; absolute positioning is the
            // bulletproof option for a full-bleed canvas viewer.
            isReplay ? "overflow-hidden p-0 relative" : "overflow-y-auto p-6",
          )}
        >
          {children}
        </main>
      </div>

      {/* Floating upload popover — single instance, opened from the
          sidebar button or the CTAs on /demos. Mounted at the layout
          level so it survives route changes (e.g. clicking "Previous
          uploads" inside the popover navigates without unmounting). */}
      <UploadDemoPopover />
    </div>
  );
}
