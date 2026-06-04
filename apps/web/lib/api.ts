// API client — talks to the FastAPI backend.

import type {
  DemoAnalysis,
  DemoInsights,
  DemoStatusPayload,
  DemoSummary,
  DemoUploadResponse,
  MapMetadata,
  PlayerSearchResponse,
  RoundTimeline,
} from "@/types/demo";
import type {
  PlaybookFolder,
  PlaybookFull,
  PlaybookSummary,
  PlaybookWriteBody,
  TeamInfo,
} from "@/types/playbook";
import type {
  AntiStratTeam,
  MapStrength,
  PreMatchReport,
  TeamReport,
} from "@/types/anti-strat";
import type {
  FeedbackAdminListResponse,
  FeedbackAdminRecord,
  FeedbackAdminUpdateBody,
  FeedbackCreateBody,
  FeedbackPublic,
  FeedbackStatus,
} from "@/types/feedback";
import type {
  LeaderboardQuery,
  LeaderboardResponse,
} from "@/types/leaderboards";

// API base URL.
//
// Production (Vercel): set ``NEXT_PUBLIC_API_URL=/api`` so every
// request goes to ``${vercel-domain}/api/...``, which the Next.js
// rewrite in ``next.config.js`` proxies to the Railway backend.
// Because the browser sees these as same-origin, the session cookie
// gets stored against the Vercel domain (first-party) and survives
// tab closes — the cross-site cookie problem the user was hitting
// where Safari / Chrome-3PCD silently dropped the cookie every time.
//
// Local dev: leave NEXT_PUBLIC_API_URL unset (or =http://localhost:8000)
// — the rewrite is a no-op in dev (BACKEND_URL is also unset), and
// the frontend talks straight to the Python dev server.
export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export class APIError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "APIError";
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData =
    typeof FormData !== "undefined" && options.body instanceof FormData;

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };
  if (!isFormData && !("Content-Type" in headers) && options.body) {
    headers["Content-Type"] = "application/json";
  }

  // ``credentials: "include"`` is REQUIRED for the auth cookie to flow
  // on cross-origin requests (the frontend lives on :3000, the API on
  // :8000 in dev). The default ``same-origin`` policy would drop the
  // cookie and every /auth/me call would 401.
  const res = await fetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...options,
    headers,
  });

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      if (body?.detail) message = body.detail;
    } catch {
      /* keep statusText */
    }
    throw new APIError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ status: string; version: string }>("/health"),

  demos: {
    list: () => request<DemoSummary[]>("/demos"),
    get: (id: string | number) => request<DemoSummary>(`/demos/${id}`),
    status: (id: string | number) =>
      request<DemoStatusPayload>(`/demos/${id}/status`),
    analysis: (id: string | number) =>
      request<DemoAnalysis>(`/demos/${id}/analysis`),
    insights: (id: string | number) =>
      request<DemoInsights>(`/demos/${id}/insights`),
    timeline: (id: string | number, round: number) =>
      request<RoundTimeline>(`/demos/${id}/timeline/${round}`),
    upload: (formData: FormData) =>
      request<DemoUploadResponse>("/demos/upload", {
        method: "POST",
        body: formData,
      }),
    /** Step 1 of the direct-to-storage upload: reserve a demo row and get
     *  a presigned PUT URL (R2). Returns ``mode: "direct"`` when the
     *  backend can't presign (local-FS dev) so the caller falls back to
     *  the multipart ``upload`` above. */
    presign: (filename: string) =>
      request<{
        mode: "presigned" | "direct";
        id?: string;
        url?: string;
        uploadHeaders?: Record<string, string>;
      }>("/demos/presign", {
        method: "POST",
        body: JSON.stringify({ filename }),
      }),
    /** Step 2: tell the backend the PUT landed so it verifies the object
     *  and kicks off parsing. */
    finalize: (id: string | number) =>
      request<DemoStatusPayload>(`/demos/${id}/finalize`, { method: "POST" }),
    delete: (id: string | number) =>
      request<void>(`/demos/${id}`, { method: "DELETE" }),
    reprocess: (id: string | number) =>
      request<DemoStatusPayload>(`/demos/${id}/reprocess`, { method: "POST" }),
  },

  players: {
    search: (query: string) =>
      request<PlayerSearchResponse>(
        `/players/search?query=${encodeURIComponent(query)}`,
      ),
  },

  maps: {
    list: () => request<MapMetadata[]>("/maps"),
    get: (name: string) =>
      request<MapMetadata>(`/maps/${encodeURIComponent(name)}`),
  },

  playbooks: {
    list: () => request<PlaybookSummary[]>("/playbooks"),
    get: (id: number) => request<PlaybookFull>(`/playbooks/${id}`),
    create: (body: PlaybookWriteBody) =>
      request<PlaybookFull>("/playbooks", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    update: (id: number, body: Partial<PlaybookWriteBody>) =>
      request<PlaybookFull>(`/playbooks/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    delete: (id: number) =>
      request<void>(`/playbooks/${id}`, { method: "DELETE" }),
  },

  folders: {
    list: () => request<PlaybookFolder[]>("/playbook-folders"),
    create: (name: string, teamId: number | null = null) =>
      request<PlaybookFolder>("/playbook-folders", {
        method: "POST",
        body: JSON.stringify({ name, teamId }),
      }),
    rename: (id: number, name: string) =>
      request<PlaybookFolder>(`/playbook-folders/${id}`, {
        method: "PUT",
        body: JSON.stringify({ name }),
      }),
    delete: (id: number) =>
      request<void>(`/playbook-folders/${id}`, { method: "DELETE" }),
  },

  teams: {
    list: () => request<TeamInfo[]>("/teams"),
    create: (name: string) =>
      request<TeamInfo>("/teams", { method: "POST", body: JSON.stringify({ name }) }),
    join: (code: string) =>
      request<TeamInfo>("/teams/join", { method: "POST", body: JSON.stringify({ code }) }),
    leave: (id: number) =>
      request<void>(`/teams/${id}/leave`, { method: "POST" }),
    delete: (id: number) =>
      request<void>(`/teams/${id}`, { method: "DELETE" }),
  },

  leaderboards: {
    /** Fetch the HLTV-2.0-rated player leaderboard. All filters are
     *  optional — calling with no args returns the top 30 across every
     *  completed demo with ≥16 rounds played. */
    list: (q: LeaderboardQuery = {}) => {
      const params = new URLSearchParams();
      if (q.map) params.set("map", q.map);
      if (q.since) params.set("since", q.since);
      if (q.minRounds !== undefined) params.set("min_rounds", String(q.minRounds));
      if (q.limit !== undefined) params.set("limit", String(q.limit));
      const qs = params.toString();
      return request<LeaderboardResponse>(
        `/leaderboards${qs ? `?${qs}` : ""}`,
      );
    },
  },

  antiStrat: {
    teams: () => request<AntiStratTeam[]>("/anti-strat/teams"),
    report: (team: string, map?: string) =>
      request<TeamReport>(
        `/anti-strat/report?team=${encodeURIComponent(team)}` +
          (map ? `&map=${encodeURIComponent(map)}` : ""),
      ),
    maps: (team: string) =>
      request<MapStrength[]>(`/anti-strat/maps?team=${encodeURIComponent(team)}`),
    preMatch: (team: string) =>
      request<PreMatchReport>(
        `/anti-strat/pre-match?team=${encodeURIComponent(team)}`,
      ),
  },

  pro: {
    matches: (limit = 50) =>
      request<{
        total: number;
        /** ISO datetime — the earliest played_at the API will surface.
         *  Driven by ``PRO_INDEX_FROM`` env (defaults to today UTC). */
        indexFrom: string;
        matches: Array<{
          id: number;
          source: string;
          sourceMatchId: string;
          teamA: string;
          teamB: string;
          scoreA: number | null;
          scoreB: number | null;
          map: string | null;
          event: string | null;
          /** Competitive tier (S+/S/A/B/C or null). Set by admin at
           *  upload; consumed by the AI scoring engine downstream.
           *  Intentionally NOT shown in public match cards — keep
           *  the public feed clean while the metadata lives in DB. */
          tier: "S+" | "S" | "A" | "B" | "C" | null;
          playedAt: string | null;
          demoUrl: string | null;
          demoId: number | null;
          /** Download-phase status while the HLTV import runs in the
           *  background (before a Demo row exists). null = idle/done,
           *  "importing" = downloading, "failed" = see importError. */
          importStatus: "importing" | "failed" | null;
          importError: string | null;
          /** Every Demo linked to this ProMatch (Bo3 series → 2-3 entries,
           *  Bo1 → 1 entry, empty if not imported yet). Backend joins on
           *  Demo.pro_match_id and serialises a slim per-map payload. */
          maps: Array<{
            demoId: number;
            map: string | null;
            filename: string;
            status: "uploaded" | "queued" | "processing" | "completed" | "failed";
            processingProgress: number;
            scoreA: number | null;
            scoreB: number | null;
            durationSeconds: number | null;
            errorMessage: string | null;
          }>;
        }>;
      }>(`/pro/matches?limit=${limit}`),
    sync: () =>
      request<{
        inserted: number;
        updated: number;
        /** Liquipedia matches older than the cutoff that we dropped
         *  instead of inserting. Surfaced so the manual sync result
         *  chip can be honest about what was filtered. */
        skipped_before_cutoff?: number;
        errors: unknown[];
      }>("/pro/sync", { method: "POST" }),
    /** Trigger the server-side import: downloads the demo from HLTV,
     *  drops the .dem(s) into storage, enqueues parsing, and links
     *  the ProMatch to the new Demo row.
     *
     *  Status values:
     *    - ``queued``: file is being parsed in the background. Poll
     *      ``/demos/{demo_id}/status`` for progress.
     *    - ``existing``: was already imported earlier. demo_id points
     *      at the existing Demo.
     *    - ``unsupported_archive``: HLTV served a .rar we can't
     *      extract; UX must direct the user to the manual link.
     */
    import: (matchId: number) =>
      request<{
        demo_id: number | null;
        /** "importing" — download started in the background; poll the
         *  /pro list and watch ``importStatus`` for progress. "existing"
         *  — already imported, demo_id points at the Demo. */
        status: "importing" | "existing";
        message: string;
      }>(`/pro/matches/${matchId}/import`, { method: "POST" }),
    /** Verify the configured outbound proxy actually changes the IP.
     *  Use the "Probar proxy" button on /pro to check before relying
     *  on it. Returns the direct + proxy public IPs so you can see
     *  whether the proxy is routing or passing through. */
    testProxy: () =>
      request<{
        configured: { var: string; value: string } | null;
        direct_ip: string | null;
        proxy_ip: string | null;
        proxy_ok: boolean;
        proxy_latency_ms?: number;
        errors: string[];
      }>("/pro/proxy-test"),
    /** Admin-only manual upload — publishes a pro match to /pro by
     *  uploading the .dem file directly. Returns the new pro_match_id
     *  and demo_id; the demo goes through the normal parse pipeline
     *  and becomes watchable in 2D once parsing completes. */
    uploadMatch: (form: FormData) =>
      request<{
        pro_match_id: number;
        demo_id: number;
        status: string;
        message: string;
      }>("/pro/matches/upload", {
        method: "POST",
        body: form,
        // Don't set Content-Type — the browser MUST pick the
        // multipart boundary itself for FormData uploads.
      }),
    /** Tiny status endpoint that surfaces what the background
     *  scheduler is doing. The UI shows a discreet "Auto-import
     *  activo" pill when ``running`` is true so the user knows
     *  the page is being kept up to date in the background. */
    schedulerStatus: () =>
      request<{
        enabled: boolean;
        running: boolean;
        interval_seconds: number;
        import_gap_seconds: number;
        max_imports_per_tick: number;
        /** ISO datetime — the cutoff applied to sync + import + list. */
        index_from: string;
        last_tick_at: string | null;
        last_sync_at: string | null;
        last_sync_result: {
          inserted: number;
          updated: number;
          errors: number;
        } | null;
        last_import_count: number;
        last_import_errors: number;
        last_import_status: Record<string, number> | null;
        /** RAR extraction state — surfaces whether unrar is functional
         *  so the UI can warn the operator if HLTV .rar demos are being
         *  silently skipped. */
        rar_extraction: {
          available: boolean;
          path: string | null;
          source: string;
        };
        /** > 0 when Liquipedia is rate-limiting us. The UI shows a
         *  yellow banner so users know why no new matches are flowing
         *  in — it's the source, not a bug on our side. */
        liquipedia_cooldown_seconds: number;
        /** Daily download budget — caps demo bytes pulled from HLTV in
         *  a single UTC day so the residential proxy quota lasts the
         *  month. ``exhausted=true`` means the scheduler is parked
         *  until 00:00 UTC. */
        daily_budget: {
          limit_gb: number;
          used_bytes: number;
          used_gb: number;
          remaining_bytes: number | null;
          remaining_gb: number | null;
          exhausted: boolean;
          day_start_utc: string;
        };
      }>("/pro/scheduler/status"),
  },

  // -----------------------------------------------------------------------
  // Auth — Steam OpenID flow + cookie-backed session.
  //
  // /auth/me returns the full serialized user (see _serialize_user in
  // apps/api/routers/auth.py). /auth/steam/login is a server-side 302 so
  // the frontend just navigates to it directly via window.location — we
  // expose it here only for completeness.
  // -----------------------------------------------------------------------
  auth: {
    me: () => request<AuthUser>("/auth/me"),
    session: () =>
      request<{ authenticated: boolean; user: AuthUser | null }>("/auth/session"),
    register: (body: { email: string; password: string; username?: string }) =>
      request<AuthUser>("/auth/register", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    login: (body: { email: string; password: string }) =>
      request<AuthUser>("/auth/login", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    logout: () => request<void>("/auth/logout", { method: "POST" }),
    steam: {
      // Backend issues a 302 here — fetch'ing it directly wouldn't follow
      // the cross-origin redirect, so the frontend should navigate the
      // browser to ``${API_BASE_URL}/auth/steam/login`` instead.
      loginUrl: () => `${API_BASE_URL}/auth/steam/login`,
      callback: (params: string) =>
        request<AuthUser>(`/auth/steam/callback?${params}`),
      /** Save the player's personal Steam Web API key (32-char hex).
       *  Backend validates the format and stores it on their User
       *  row. Used by the demo-extractor flow to pull the player's
       *  match history. */
      setApiKey: (apiKey: string) =>
        request<{ ok: boolean; has_steam_api_key: boolean }>(
          "/auth/me/steam-api-key",
          {
            method: "PUT",
            body: JSON.stringify({ api_key: apiKey }),
            headers: { "Content-Type": "application/json" },
          },
        ),
      clearApiKey: () =>
        request<{ ok: boolean; has_steam_api_key: boolean }>(
          "/auth/me/steam-api-key",
          { method: "DELETE" },
        ),
    },
  },

  // -----------------------------------------------------------------------
  // Admin — gated by ``require_admin`` on the backend. Shapes match the
  // real responses in apps/api/routers/admin.py.
  // -----------------------------------------------------------------------
  admin: {
    metrics: () =>
      request<{
        total_users: number;
        active_users: number;
        admins: number;
        pro_users: number;
        total_demos: number;
        processed_demos: number;
        failed_demos: number;
        in_flight_demos: number;
        stripe_revenue: number | null;
        api_cost: number | null;
        monetization_enabled: boolean;
      }>("/admin/metrics"),
    growth: (days = 28) =>
      request<{
        days: number;
        granularity: string;
        series: Array<{ bucket: string; users: number; demos: number }>;
      }>(`/admin/growth?days=${days}`),
    users: (limit = 100, offset = 0) =>
      request<{
        total: number;
        limit: number;
        offset: number;
        items: Array<{
          id: string;
          email: string | null;
          username: string | null;
          name: string;
          tier: "free" | "pro";
          subscription_status: string;
          role: "admin" | "user";
          status: "active" | "banned";
          demos_count: number;
          created_at: string | null;
          last_login: string | null;
        }>;
      }>(`/admin/users?limit=${limit}&offset=${offset}`),
    incidents: () =>
      request<
        Array<{
          id: string;
          filename: string;
          user_id: string | null;
          error: string;
          date: string | null;
        }>
      >("/admin/incidents"),
    setTier: (userId: string, tier: "free" | "pro") =>
      request<{ id: string; tier: string; status: string }>(
        `/admin/users/${userId}/tier`,
        {
          method: "POST",
          body: JSON.stringify({ tier }),
        },
      ),
    // Backend payload is ``{ value: bool }`` — a single ``_Toggle`` model
    // is reused for both admin + active flips so the API surface stays
    // symmetrical. Don't change to ``{ is_admin }`` without updating the
    // server side first.
    setAdmin: (userId: string, isAdmin: boolean) =>
      request<{ id: string; is_admin: boolean }>(
        `/admin/users/${userId}/admin`,
        {
          method: "POST",
          body: JSON.stringify({ value: isAdmin }),
        },
      ),
    setActive: (userId: string, isActive: boolean) =>
      request<{ id: string; is_active: boolean }>(
        `/admin/users/${userId}/active`,
        {
          method: "POST",
          body: JSON.stringify({ value: isActive }),
        },
      ),
    deleteDemo: (demoId: number) =>
      request<{ ok: boolean }>(`/admin/demos/${demoId}`, { method: "DELETE" }),
    /** Mark demos stuck in ``processing`` past the cutoff as ``failed``
     *  so the UI unblocks. Returns the count of demos + linked
     *  ProMatches that were updated. See backend
     *  ``routers/admin.py::admin_reset_stuck_demos``. */
    resetStuckDemos: (olderThanMinutes = 30) =>
      request<{ demosReset: number; matchesReset: number; cutoff: string }>(
        `/admin/demos/reset-stuck?older_than_minutes=${olderThanMinutes}`,
        { method: "POST" },
      ),
    /** Re-queue every ``failed`` demo for parsing without touching
     *  disk. ``proOnly=true`` limits to demos linked to a ProMatch
     *  (skips solo uploads). See backend
     *  ``routers/admin.py::admin_retry_failed_demos``. */
    retryFailedDemos: (proOnly = false, limit = 50) =>
      request<{
        requeued: number;
        skipped: number;
        /** Count of failed demos whose .dem bytes are missing from
         *  storage (S3 HEAD returned 404 / local path doesn't exist).
         *  These can't be retried — call ``purgeMissingDemos`` to
         *  delete the rows so the scheduler re-imports from source. */
        missingBytes: number;
        demoIds: number[];
        missingBytesIds: number[];
        proOnly: boolean;
      }>(
        `/admin/demos/retry-failed?pro_only=${proOnly}&limit=${limit}`,
        { method: "POST" },
      ),
    /** Delete failed demos whose bytes are gone AND clear the linked
     *  ProMatch.demo_id so the scheduler can re-download from HLTV.
     *  Only touches rows tagged by ``retryFailedDemos`` with the
     *  "Bytes missing in storage" marker. */
    purgeMissingDemos: () =>
      request<{
        deleted: number;
        matchesCleared: number;
        demoIds: number[];
      }>(`/admin/demos/purge-missing`, { method: "POST" }),
    /** Admin queue for the bottom-right feedback widget. */
    feedback: {
      list: (status?: FeedbackStatus, limit = 200) =>
        request<FeedbackAdminListResponse>(
          `/admin/feedback?limit=${limit}` +
            (status ? `&status=${status}` : ""),
        ),
      update: (reportId: number, body: FeedbackAdminUpdateBody) =>
        request<FeedbackAdminRecord>(`/admin/feedback/${reportId}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }),
    },
  },

  // -----------------------------------------------------------------------
  // Feedback widget — POST a user-submitted report.
  // -----------------------------------------------------------------------
  feedback: {
    submit: (body: FeedbackCreateBody) =>
      request<FeedbackPublic>("/feedback", {
        method: "POST",
        body: JSON.stringify(body),
      }),
  },
};

/**
 * Shape returned by ``/auth/me`` and ``/auth/steam/callback``. Mirrors
 * ``_serialize_user`` in ``apps/api/routers/auth.py`` — keep them in sync.
 */
export interface AuthUser {
  id: string;
  email: string | null;
  username: string | null;
  name: string;
  steam_id: string | null;
  avatar_url: string | null;
  /** Canonical https://steamcommunity.com/... profile URL. Always
   *  populated for Steam-linked users (falls back to the numeric
   *  ``/profiles/{steam_id}`` form when the Web API isn't reachable). */
  steam_profile_url: string | null;
  /** Real name, if the user filled it in their Steam profile. */
  steam_realname: string | null;
  /** ISO 3166 country code (privacy-locked profiles may omit it). */
  steam_country: string | null;
  /** True when the user has saved their personal Steam Web API key
   *  (the one for fetching their match history). The raw value is
   *  NEVER returned by the API — only this boolean. */
  has_steam_api_key: boolean;
  is_admin: boolean;
  is_active: boolean;
  tier: "free" | "pro";
  subscription_status: string;
  role: "admin" | "user";
  status: "active" | "banned";
  created_at: string | null;
  last_login: string | null;
}
