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

  const res = await fetch(`${API_BASE_URL}${path}`, { ...options, headers });

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
    delete: (id: string | number) =>
      request<void>(`/demos/${id}`, { method: "DELETE" }),
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

  pro: {
    matches: (limit = 50) =>
      request<{
        total: number;
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
          playedAt: string | null;
          demoUrl: string | null;
          demoId: number | null;
        }>;
      }>(`/pro/matches?limit=${limit}`),
    sync: () =>
      request<{ inserted: number; updated: number; errors: unknown[] }>(
        "/pro/sync",
        { method: "POST" },
      ),
  },
};
