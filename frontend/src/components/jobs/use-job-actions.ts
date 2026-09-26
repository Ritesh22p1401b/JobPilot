"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import * as S from "@/lib/schemas";

/** Save / dismiss / prepare-application actions shared by job cards, lists and the job page. */
export function useJobActions() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = () => {
    for (const k of [["jobs"], ["job"], ["insights"], ["applications"], ["dashboard"], ["matches"]]) void qc.invalidateQueries({ queryKey: k });
  };

  const save = async (jobId: string, saved: boolean) => {
    setBusy(`save:${jobId}`);
    try {
      await api(S.Match, "POST", `/jobs/${jobId}/save?saved=${saved}`);
      toast({ tone: "success", title: saved ? "Saved" : "Removed from saved", body: saved ? "Added to your Application Tracker." : undefined });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t update this job", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (jobId: string) => {
    setBusy(`dismiss:${jobId}`);
    try {
      await api(S.Match, "POST", `/jobs/${jobId}/dismiss?dismissed=true`);
      toast({ tone: "info", title: "Hidden", body: "This job won’t appear in your results." });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t hide this job", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  /** Starts the Application Agent (prepare) and opens the application workspace. Never submits anything. */
  const apply = async (jobId: string) => {
    setBusy(`apply:${jobId}`);
    try {
      const out = await api(S.PrepareOut, "POST", `/applications/${jobId}/prepare`);
      refresh();
      router.push(`/applications/${out.application_id}?task=${out.task.id}`);
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t start the application", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return { save, dismiss, apply, busy };
}
