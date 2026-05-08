"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import type { DemoStatus } from "@/types/demo";

const ACTIVE_STATUSES: DemoStatus[] = ["uploaded", "queued", "processing"];

export function useDemos() {
  return useQuery({
    queryKey: ["demos"],
    queryFn: () => api.demos.list(),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return false;
      return data.some((d) => ACTIVE_STATUSES.includes(d.status)) ? 2000 : false;
    },
  });
}

export function useDemoStatus(id: string | number | null) {
  return useQuery({
    queryKey: ["demo-status", id],
    queryFn: () => api.demos.status(id!),
    enabled: id !== null && id !== undefined,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 1500;
      return ACTIVE_STATUSES.includes(data.status) ? 1500 : false;
    },
  });
}

export function useDemo(id: string | number | null) {
  return useQuery({
    queryKey: ["demo", id],
    queryFn: () => api.demos.get(id!),
    enabled: id !== null && id !== undefined,
  });
}

export function useDemoAnalysis(id: string | number | null, enabled = true) {
  return useQuery({
    queryKey: ["demo-analysis", id],
    queryFn: () => api.demos.analysis(id!),
    enabled: enabled && id !== null && id !== undefined,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Per-round timeline for the 2D replay viewer.
 * Cached for 30 minutes since timelines are deterministic and heavy (~1MB).
 */
export function useRoundTimeline(
  demoId: string | number | null,
  roundNumber: number | null,
  enabled = true,
) {
  return useQuery({
    queryKey: ["demo-timeline", demoId, roundNumber],
    queryFn: () => api.demos.timeline(demoId!, roundNumber!),
    enabled:
      enabled &&
      demoId !== null &&
      demoId !== undefined &&
      roundNumber !== null &&
      roundNumber !== undefined,
    staleTime: 30 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
  });
}

export function useUploadDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return api.demos.upload(fd);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["demos"] });
    },
  });
}

export function useDeleteDemo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => api.demos.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["demos"] });
    },
  });
}
