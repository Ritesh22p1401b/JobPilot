"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useState, useSyncExternalStore } from "react";

import { api, getToken } from "@/lib/api";
import * as S from "@/lib/schemas";

function subscribe(cb: () => void) {
  window.addEventListener("jobpilot:auth", cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener("jobpilot:auth", cb);
    window.removeEventListener("storage", cb);
  };
}

/** Current token; `undefined` during SSR / before hydration so guards don't redirect prematurely. */
export function useToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, getToken, () => undefined);
}

export function useMe() {
  const token = useToken();
  return useQuery({ queryKey: ["me", token], queryFn: () => api(S.Me, "GET", "/auth/me"), enabled: !!token, retry: false });
}

const ACTIVE = new Set(["PENDING", "RUNNING"]);

/**
 * Poll a background task (event-bus job) until it and its follow-up tasks finish, then invalidate
 * the given queries. Background agents are asynchronous, so the UI tracks them instead of blocking.
 */
export function useTaskTracker(invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api(S.TaskDetail, "GET", `/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (query) => {
      const t = query.state.data;
      if (!t) return 1500;
      return ACTIVE.has(t.status) || t.children.some((c) => ACTIVE.has(c.status)) ? 2000 : false;
    },
  });
  const t = q.data;
  const running = !!taskId && (!t || ACTIVE.has(t.status) || t.children.some((c) => ACTIVE.has(c.status)));
  const done = !!t && !running;
  useEffect(() => {
    if (done) for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate keys are static per call site
  }, [done, qc]);
  return { task: t, running, done, failed: t?.status === "FAILED", start: setTaskId, reset: () => setTaskId(null) };
}

/** Any agent work still running for this user (drives the global activity indicator). */
export function useActiveTasks() {
  const token = useToken();
  return useQuery({
    queryKey: ["tasks", "active"],
    queryFn: () => api(S.TaskList, "GET", "/tasks?active_only=true"),
    enabled: !!token,
    refetchInterval: (query) => ((query.state.data?.tasks.length ?? 0) > 0 ? 3000 : 20000),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => api(S.Dashboard, "GET", "/dashboard") });
}

export function usePreferences() {
  return useQuery({ queryKey: ["preferences"], queryFn: () => api(S.Preferences, "GET", "/preferences") });
}

export function useResume(enabled = true) {
  return useQuery({ queryKey: ["resume"], queryFn: () => api(S.ResumeOut, "GET", "/resume"), enabled, retry: false });
}

export function useVersions(jobId?: string) {
  return useQuery({
    queryKey: ["versions", jobId ?? "all"],
    queryFn: () => api(S.VersionList, "GET", `/resume/versions${jobId ? `?job_id=${jobId}` : ""}`),
  });
}

export function useTemplates() {
  return useQuery({ queryKey: ["templates"], queryFn: () => api(S.Templates, "GET", "/resume/templates"), staleTime: Infinity });
}

export function useNotifications() {
  const token = useToken();
  return useQuery({
    queryKey: ["notifications"],
    queryFn: () => api(S.NotificationList, "GET", "/notifications"),
    enabled: !!token,
    refetchInterval: 60000,
  });
}

/** Mutation that invalidates the given query keys on success. */
export function useApiMutation<TVars, TOut>(fn: (vars: TVars) => Promise<TOut>, invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    },
  });
}
