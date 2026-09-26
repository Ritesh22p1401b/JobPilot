"use client";

import { useQueryClient } from "@tanstack/react-query";
import { MessagesSquare } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/applications/tracker";
import { RequireProfile } from "@/components/layout/require-profile";
import { Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, ScoreBadge, Textarea } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApplications } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import type { Application } from "@/lib/schemas";
import { fmtDate } from "@/lib/utils";

function InterviewCard({ a }: { a: Application }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [notes, setNotes] = useState(a.notes ?? "");
  const [busy, setBusy] = useState(false);
  const gaps = a.job?.match?.missing_skills.required ?? [];
  const strengths = a.job?.match?.matched_skills ?? [];
  const save = async () => {
    setBusy(true);
    try {
      await api(S.Application, "PATCH", `/applications/${a.id}`, { notes });
      toast({ tone: "success", title: "Notes saved" });
      void qc.invalidateQueries({ queryKey: ["applications"] });
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t save notes", body: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-semibold">{a.job?.company}</div>
          <div className="text-[13px] text-subtle">{a.job?.title}</div>
          <div className="mt-1 text-xs text-muted">Applied {fmtDate(a.applied_at)}</div>
        </div>
        <div className="flex items-center gap-2">
          <ScoreBadge score={a.job?.match?.overall_score} suffix="% match" />
          <StatusBadge status={a.status} />
        </div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Talk about (your evidence)</div>
          <p className="text-[13px] text-subtle">{strengths.length ? strengths.slice(0, 8).join(", ") : "Open the job’s requirement map."}</p>
        </div>
        <div>
          <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Be ready to discuss (gaps)</div>
          <p className="text-[13px] text-subtle">{gaps.length ? gaps.join(", ") : "No required gaps."}</p>
        </div>
      </div>
      <label className="mt-4 block text-[13px] font-medium" htmlFor={`n-${a.id}`}>
        Preparation notes
      </label>
      <Textarea id={`n-${a.id}`} className="mt-1.5" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Interviewers, dates, topics to review…" />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" onClick={save} loading={busy} disabled={notes === (a.notes ?? "")}>
          Save notes
        </Button>
        <ButtonLink href={`/jobs/${a.job_id}`} size="sm" variant="secondary">
          Review job requirements
        </ButtonLink>
        <ButtonLink href={`/applications/${a.id}`} size="sm" variant="ghost">
          Application
        </ButtonLink>
      </div>
    </Card>
  );
}

export default function InterviewsPage() {
  const apps = useApplications();
  const list = (apps.data?.applications ?? []).filter((a) => a.status === "INTERVIEW" || a.status === "ASSESSMENT");
  return (
    <RequireProfile title="Interviews">
      <PageHeader title="Interviews" description="Applications at the assessment or interview stage, with the evidence to talk about and the gaps to prepare for." />
      {apps.isLoading && <PageSkeleton rows={2} />}
      {apps.error && <ErrorState error={apps.error} onRetry={() => apps.refetch()} />}
      {apps.data &&
        (list.length ? (
          <div className="grid gap-4 xl:grid-cols-2">
            {list.map((a) => (
              <InterviewCard key={a.id} a={a} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<MessagesSquare className="h-5 w-5" />} title="No interviews yet" action={<ButtonLink href="/applications">Open tracker</ButtonLink>}>
            When an application moves to Assessment or Interview in your tracker, it appears here with preparation notes.
          </EmptyState>
        ))}
    </RequireProfile>
  );
}
