"use client";

import { AlertTriangle, Bot, Check, CircleDashed } from "lucide-react";

import { agentState, readiness, unansweredRequired } from "@/components/applications/model";
import { RequireProfile } from "@/components/layout/require-profile";
import { Badge, ButtonLink, Callout, Card, EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useApplications, usePreferences } from "@/lib/hooks";
import type { Application } from "@/lib/schemas";
import { humanize } from "@/lib/utils";

function Row({ ok, label, warn }: { ok: boolean; label: string; warn?: string }) {
  return (
    <div className="flex items-center justify-between gap-2 text-[13px]">
      <span className="text-subtle">{label}</span>
      {warn ? (
        <span className="flex items-center gap-1 text-warning">
          <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> {warn}
        </span>
      ) : ok ? (
        <span className="flex items-center gap-1 text-success">
          <Check className="h-3.5 w-3.5" aria-hidden /> Done
        </span>
      ) : (
        <span className="flex items-center gap-1 text-muted">
          <CircleDashed className="h-3.5 w-3.5" aria-hidden /> Not yet
        </span>
      )}
    </div>
  );
}

function AgentCard({ a }: { a: Application }) {
  const st = agentState(a);
  const { pct } = readiness(a);
  const missing = unansweredRequired(a);
  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-semibold">{a.job?.company}</div>
          <div className="truncate text-[13px] text-subtle">{a.job?.title}</div>
        </div>
        <Badge tone={st.tone}>
          <span aria-hidden>{st.symbol}</span> {st.label}
        </Badge>
      </div>
      <div className="mt-4 space-y-2">
        <Row ok={!!a.resume_version_id} label="Resume" />
        <Row ok={!!a.cover_letter} label="Cover letter" />
        <Row ok={a.answers.length > 0 && !missing.length} label="Questions" warn={missing.length ? `${missing.length} need your input` : undefined} />
      </div>
      <div className="mt-4">
        <div className="flex justify-between text-xs text-muted">
          <span>Progress</span>
          <span className="tabular font-mono">{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden>
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <ButtonLink href={`/applications/${a.id}`} className="mt-4" variant={a.status === "APPROVAL_REQUIRED" || a.status === "READY" ? "primary" : "secondary"}>
        {a.status === "READY" ? "Review & submit" : a.status === "APPROVAL_REQUIRED" ? "Answer & approve" : "Review application"}
      </ButtonLink>
    </Card>
  );
}

export default function AgentPage() {
  const apps = useApplications();
  const prefs = usePreferences();
  const p = prefs.data;
  const inFlight = (apps.data?.applications ?? []).filter((a) => ["SAVED", "APPROVAL_REQUIRED", "READY"].includes(a.status));
  const order = { APPROVAL_REQUIRED: 0, READY: 1, SAVED: 2 } as Record<string, number>;
  inFlight.sort((x, y) => (order[x.status] ?? 9) - (order[y.status] ?? 9));

  return (
    <RequireProfile title="Application Agent">
      <PageHeader
        title="Application Agent"
        description="The agent prepares applications: it tailors your resume, writes a cover letter and drafts answers. It pauses whenever something can’t be safely determined, and never submits without your approval."
        action={<ButtonLink href="/preferences" variant="secondary">Automation settings</ButtonLink>}
      />
      {p && (
        <Callout
          tone={p.auto_apply ? "warning" : "info"}
          icon={<Bot className="h-4 w-4" />}
          className="mb-5"
          title={p.auto_apply ? "Authorized auto-apply is on" : `Mode: ${humanize(p.application_mode)}`}
        >
          {p.auto_apply
            ? `The agent may submit through employer-authorized APIs only, for approved resumes, matches ≥ ${p.auto_apply_minimum_score}, up to ${p.daily_application_limit} per day. It still pauses on sensitive or unknown questions.`
            : p.application_mode === "DISCOVERY_ONLY"
              ? "The agent prepares applications only when you ask. Submission is always done by you."
              : "The agent prepares applications for your review. You submit on the employer’s site."}
        </Callout>
      )}
      {apps.isLoading && <PageSkeleton rows={2} />}
      {apps.error && <ErrorState error={apps.error} onRetry={() => apps.refetch()} />}
      {apps.data &&
        (inFlight.length ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {inFlight.map((a) => (
              <AgentCard key={a.id} a={a} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Bot className="h-5 w-5" />} title="Nothing in progress" action={<ButtonLink href="/matches">Find a high-match job</ButtonLink>}>
            Choose Apply on any job and the agent will prepare the application for your review.
          </EmptyState>
        ))}
    </RequireProfile>
  );
}
