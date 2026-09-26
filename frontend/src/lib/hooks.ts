"use client";

import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

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
 * Tracks a background task *and everything it triggers*. The event bus fans work out
 * (discovery → normalization → matching …), so a run counts as finished only when the root task,
 * its children and every other active task of this user have settled.
 */
export function useTaskTracker(invalidate: QueryKey[] = []) {
  const qc = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const seen = useRef<Set<string>>(new Set());
  const root = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => api(S.TaskDetail, "GET", `/tasks/${taskId}`),
    enabled: !!taskId,
    refetchInterval: (q) => (q.state.data && !ACTIVE.has(q.state.data.status) && !q.state.data.children.some((c) => ACTIVE.has(c.status)) ? false : 1500),
  });
  const rootSettled = !!root.data && !ACTIVE.has(root.data.status) && !root.data.children.some((c) => ACTIVE.has(c.status));
  const active = useQuery({
    queryKey: ["tasks", "active", "tracker", taskId],
    queryFn: () => api(S.TaskList, "GET", "/tasks?active_only=true"),
    enabled: !!taskId,
    refetchInterval: (q) => (rootSettled && q.state.data && q.state.data.tasks.length === 0 ? false : 2000),
  });
  const activeTypes = (active.data?.tasks ?? []).map((t) => t.event_type);
  for (const t of activeTypes) seen.current.add(t);
  if (root.data) {
    seen.current.add(root.data.event_type);
    for (const c of root.data.children) seen.current.add(c.event_type);
  }
  const running = !!taskId && (!rootSettled || activeTypes.length > 0);
  const done = !!taskId && !running;
  useEffect(() => {
    if (done) for (const key of invalidate) void qc.invalidateQueries({ queryKey: key });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- invalidate keys are static per call site
  }, [done, qc]);
  return {
    task: root.data,
    running,
    done,
    failed: root.data?.status === "FAILED",
    activeTypes,
    seenTypes: seen.current,
    start: (id: string) => {
      seen.current = new Set();
      setTaskId(id);
    },
    reset: () => setTaskId(null),
  };
}
export type TaskTracker = ReturnType<typeof useTaskTracker>;

/** Any agent work still running for this user (drives the global activity indicator). */
export function useActiveTasks() {
  const token = useToken();
  return useQuery({
    queryKey: ["tasks", "active"],
    queryFn: () => api(S.TaskList, "GET", "/tasks?active_only=true"),
    enabled: !!token,
    refetchInterval: (q) => ((q.state.data?.tasks.length ?? 0) > 0 ? 3000 : 20000),
  });
}

export function useDashboard() {
  return useQuery({ queryKey: ["dashboard"], queryFn: () => api(S.Dashboard, "GET", "/dashboard") });
}

export function useInsights(enabled = true) {
  const me = useMe();
  return useQuery({ queryKey: ["insights"], queryFn: () => api(S.Insights, "GET", "/insights"), enabled: enabled && !!me.data?.has_profile, retry: false });
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
    retry: false,
  });
}

export function useApplications() {
  return useQuery({ queryKey: ["applications"], queryFn: () => api(S.ApplicationList, "GET", "/applications"), retry: false });
}

export function useTemplates() {
  return useQuery({ queryKey: ["templates"], queryFn: () => api(S.Templates, "GET", "/resume/templates"), staleTime: Infinity });
}

/** Template id → display name (e.g. "ats_ai_ml" → "AI / ML Engineer"), falling back to the id. */
export function useTemplateName(): (id: string) => string {
  const t = useTemplates();
  return (id: string) => t.data?.templates.find((x) => x.id === id)?.name ?? id.replace(/_/g, " ");
}

export function useLlmStatus() {
  const token = useToken();
  return useQuery({ queryKey: ["llm"], queryFn: () => api(S.LlmHealth, "GET", "/system/llm"), enabled: !!token, refetchInterval: 60000 });
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

/** Persisted per-viewer UI preference (sidebar collapsed, view mode…). Storage failures fall back to state. */
export function useLocalPref<T extends string>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(initial);
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(`jobpilot.${key}`);
      if (v !== null) setValue(v as T);
    } catch {
      /* storage unavailable */
    }
  }, [key]);
  const set = (v: T) => {
    setValue(v);
    try {
      window.localStorage.setItem(`jobpilot.${key}`, v);
    } catch {
      /* storage unavailable */
    }
  };
  return [value, set];
}
