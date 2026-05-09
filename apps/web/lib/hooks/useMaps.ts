"use client";

import { useQuery } from "@tanstack/react-query";

import { api } from "@/lib/api";

/**
 * Per-map metadata: world bounds, site/spawn anchors, and named callouts.
 * Cached aggressively — this rarely changes (it's static map data).
 */
export function useMapMeta(name: string | null | undefined) {
  return useQuery({
    queryKey: ["map-meta", name ?? null],
    queryFn: () => api.maps.get(name as string),
    enabled: typeof name === "string" && name.length > 0,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 60 * 60 * 1000,
  });
}

export function useMaps() {
  return useQuery({
    queryKey: ["maps"],
    queryFn: () => api.maps.list(),
    staleTime: 60 * 60 * 1000,
    gcTime: 60 * 60 * 1000,
  });
}
