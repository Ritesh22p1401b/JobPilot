"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDashed, Copy, Download, ExternalLink, Focus, Gauge, Send, AlertTriangle } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

import { AIThinking, PIPELINES } from "@/components/ai/thinking";
import { MANUAL_STATUSES, agentState, isPrepared, readiness, statusOf, unansweredRequired } from "@/components/applications/model";
import { StatusBadge } from "@/components/applications/tracker";
import { useFocusMode } from "@/components/layout/app-shell";
import { VersionStatus } from "@/components/resume/version-status";
import { AIGenerated, Badge, Button, ButtonLink, Callout, Card, CardBody, CardHeader, ErrorState, Field, PageSkeleton, ScoreBadge, Select, Textarea, type Tone } from "@/components/ui";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, download } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useTaskTracker } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, fmtDateTime, humanize } from "@/lib/utils";

const CONF_TONE: Record<string, Tone> = { HIGH: "success", MEDIUM: "primary", LOW: "warning", UNKNOWN: "neutral" };

function StepIcon({ state }: { state: "done" | "attention" | "pending" }) {
  if (state === "done") return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (state === "attention") return <AlertTriangle className="h-3.5 w-3.5" aria-hidden />;
  return <CircleDashed className="h-3.5 w-3.5" aria-hidden />;
}

function Workspace() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { focus, setFocus } = useFocusMode();
  const tracker = useTaskTracker([["application", id], ["applications"], ["insights"], ["versions"]]);
  const started = useRef(false);

  const q = useQuery({ queryKey: ["application", id], queryFn: () => api(S.Application, "GET", `/applications/${id}`) });
  const a = q.data;
  const version = useQuery({ queryKey: ["version", a?.resume_version_id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${a!.resume_version_id}`), enabled: !!a?.resume_version_id });
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api(S.ProfileOut, "GET", "/profile") });

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cover, setCover] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    const t = params.get("task");
    if (t && !started.current) {
      started.current = true;
      tracker.start(t);
      router.replace(`/applications/${id}`, { scroll: false });
    }
  }, [params, id, router, tracker]);
  useEffect(() => {
    if (a) {
      setAnswers(Object.fromEntries(a.answers.map((x) => [x.question, x.answer ?? ""])));
      setCover(null);
    }
  }, [a]);

  if (q.isLoading) return <PageSkeleton rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!a) return null;

  const refresh = () => {
    for (const k of [["application", id], ["applications"], ["insights"], ["dashboard"], ["versions"]]) void qc.invalidateQueries({ queryKey: k });
  };
  const pkg = a.package as Record<string, unknown>;
  const authorized = pkg.provider_authorized === true;
  const prepared = isPrepared(a);
  const agent = agentState(a, tracker.running);
  const { checks, pct } = readiness(a, version.data, profile.data?.profile);
  const missing = unansweredRequired(a);
  const needsInput = a.answers.filter((x) => x.requires_approval || (x.required && !x.answer));
  const submitted = ["APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"].includes(a.status);
  const employerUrl = a.application_url ?? a.job?.application_url ?? a.job?.url ?? null;

  const steps: { id: string; label: string; state: "done" | "attention" | "pending" }[] = [
    { id: "step-job", label: "Job", state: "done" },
    { id: "step-resume", label: "Resume", state: version.data ? (version.data.status === "APPROVED" ? "done" : "attention") : "pending" },
    { id: "step-resume", label: "ATS", state: version.data?.quality_index ? "done" : "pending" },
    { id: "step-cover", label: "Cover letter", state: a.cover_letter ? "done" : "pending" },
    { id: "step-questions", label: "Questions", state: !a.answers.length ? "pending" : missing.length ? "attention" : "done" },
    { id: "step-submit", label: "Submit", state: submitted ? "done" : a.status === "READY" ? "attention" : "pending" },
  ];

  const prepare = async () => {
    setBusy("prepare");
    try {
      const out = await api(S.PrepareOut, "POST", `/applications/${a.job_id}/prepare`);
      tracker.start(out.task.id);
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t prepare the application", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const approve = async () => {
    const empty = a.answers.filter((x) => x.required && !answers[x.question]?.trim()).length;
    const ok = await confirm({
      title: "Approve this application?",
      body: (
        <>
          You’re confirming the resume, cover letter and {a.answers.length} answer{a.answers.length === 1 ? "" : "s"} are accurate.
          {empty > 0 && <span className="mt-2 block text-warning">{empty} required question(s) are still empty, so the application will stay in “Needs your input”.</span>}
          <span className="mt-2 block">Nothing is submitted yet.</span>
        </>
      ),
      confirmLabel: "Approve",
    });
    if (!ok) return;
    setBusy("approve");
    try {
      const out = await api(S.Application, "POST", `/applications/${a.job_id}/approve`, {
        answers: Object.fromEntries(Object.entries(answers).map(([k, v]) => [k, v.trim() || null])),
        approve_resume: true,
        cover_letter: cover,
        notes: notes || null,
      });
      toast({ tone: "success", title: out.status === "READY" ? "Approved: ready to submit" : "Saved. Some answers are still needed." });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t approve", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const submit = async () => {
    const ok = await confirm(
      authorized
        ? { title: "Submit application?", body: `Your approved resume, cover letter and answers will be sent to ${a.job?.company} through their authorized application API. This can’t be undone.`, confirmLabel: "Submit application" }
        : { title: "Apply on the employer’s site?", body: `JobPilot doesn’t automate ${a.job?.company}’s site. We’ll open their application page so you can submit with your approved resume and answers, then you mark it as Applied.`, confirmLabel: "Open employer page" },
    );
    if (!ok) return;
    setBusy("submit");
    try {
      const out = await api(S.SubmitOut, "POST", `/applications/${a.job_id}/submit`);
      if (out.result.method === "assisted" && out.result.application_url) window.open(out.result.application_url, "_blank", "noopener");
      toast({ tone: out.result.status === "APPROVAL_REQUIRED" ? "error" : "success", title: out.result.message });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t submit", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const setStatus = async (status: string) => {
    if (status === a.status) return;
    const ok = await confirm({ title: `Mark as ${statusOf(status).label}?`, body: "This is recorded in the application timeline.", confirmLabel: "Update status" });
    if (!ok) return;
    setBusy("status");
    try {
      await api(S.Application, "PATCH", `/applications/${id}`, { status });
      toast({ tone: "success", title: `Status: ${statusOf(status).label}` });
      refresh();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t update status", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      {/* header */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 animate-rise">
        <div className="min-w-0">
          {!focus && (
            <Link href="/applications" className="text-[13px] text-muted hover:text-foreground">
              ← Application Tracker
            </Link>
          )}
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">
            {a.job?.company} — {a.job?.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <StatusBadge status={a.status} />
            {a.job?.match && <ScoreBadge score={a.job.match.overall_score} suffix="% match" />}
            <Badge>{authorized ? "Authorized employer API" : "Assisted: you submit on the employer site"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant={focus ? "secondary" : "ghost"} size="sm" onClick={() => setFocus(!focus)} aria-pressed={focus}>
            <Focus className="h-3.5 w-3.5" /> {focus ? "Exit focus mode" : "Focus mode"}
          </Button>
          <ButtonLink href={`/jobs/${a.job_id}`} variant="secondary" size="sm">
            View job
          </ButtonLink>
        </div>
      </div>

      {/* stepper */}
      <nav aria-label="Application steps" className="relative mb-5 overflow-x-auto">
        <ol className="flex min-w-max items-center gap-2">
          {steps.map((s, i) => (
            <li key={`${s.label}`} className="flex items-center gap-2">
              <a
                href={`#${s.id}`}
                className={cn(
                  "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                  s.state === "done" ? "tint-success border-transparent" : s.state === "attention" ? "tint-warning border-transparent" : "border-border text-muted hover:text-foreground",
                )}
              >
                <StepIcon state={s.state} />
                <span className="font-mono text-[11px] opacity-70">{i + 1}</span> {s.label}
                <span className="sr-only">({s.state === "done" ? "done" : s.state === "attention" ? "needs attention" : "not started"})</span>
              </a>
              {i < steps.length - 1 && <span className="h-px w-5 bg-border" aria-hidden />}
            </li>
          ))}
        </ol>
      </nav>

      {(tracker.running || (tracker.done && !prepared)) && (
        <AIThinking tracker={tracker} steps={PIPELINES.prepare} title="Preparing your application. You’ll review everything before anything is sent." className="mb-5" />
      )}
      {tracker.failed && (
        <Callout tone="danger" className="mb-5" title="Preparation failed" action={<Button size="sm" variant="secondary" onClick={prepare}>Try again</Button>}>
          {tracker.task?.error}
        </Callout>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_360px]">
        <div className="min-w-0 space-y-5">
          <span id="step-job" />
          {!prepared && !tracker.running && (
            <Card className="ai-gradient ai-border">
              <CardBody className="flex flex-col items-start gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-medium">Let the Application Agent prepare this</div>
                  <p className="text-[13px] text-subtle">It tailors your resume, writes a cover letter and drafts answers from your verified profile. It pauses on anything it can’t safely answer.</p>
                </div>
                <Button onClick={prepare} loading={busy === "prepare"}>
                  <span aria-hidden>✦</span> Prepare application
                </Button>
              </CardBody>
            </Card>
          )}

          {/* resume */}
          <Card id="step-resume" className="scroll-mt-24">
            <CardHeader title="Resume" description="The version that will be used for this application." />
            <CardBody>
              {version.data ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-elevated/40 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{version.data.version_type === "MASTER" ? "Base resume" : version.data.label ?? `Tailored v${version.data.version_number}`}</span>
                      <VersionStatus status={version.data.status} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {version.data.version_type === "TAILORED" ? "Tailored for this job" : "Not tailored"} · ATS readiness {version.data.quality_index ? Math.round(version.data.quality_index) : "not tested"} ·{" "}
                      {version.data.claims.filter((c) => c.verified).length}/{version.data.claims.length} claims verified
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <ButtonLink href={`/resume-lab/${version.data.id}`} size="sm" variant="secondary">
                      Review changes
                    </ButtonLink>
                    <ButtonLink href={`/resume-lab/${version.data.id}/test`} size="sm" variant="ghost">
                      <Gauge className="h-3.5 w-3.5" /> ATS
                    </ButtonLink>
                    <Button size="sm" variant="ghost" onClick={() => download(`/resume/${version.data!.id}/download?format=pdf`, "resume.pdf")}>
                      <Download className="h-3.5 w-3.5" /> PDF
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted">No resume selected yet. Preparing the application creates a tailored version.</p>
              )}
            </CardBody>
          </Card>

          {/* questions */}
          <Card id="step-questions" className="scroll-mt-24">
            <CardHeader
              title="Application questions"
              description="Drafted only from facts in your profile and preferences. Sensitive questions (salary, visa, demographics) always need your confirmation."
              action={a.answers.length ? <Badge tone={missing.length ? "warning" : "success"}>{missing.length ? `${missing.length} need your input` : `${a.answers.length} answered`}</Badge> : undefined}
            />
            <CardBody className="space-y-4">
              {!a.answers.length && <p className="text-sm text-muted">{prepared ? "No questions were detected for this posting." : "Questions appear once the application is prepared."}</p>}
              {a.answers.map((x) => {
                const blocked = !x.answer && (x.required || x.requires_approval);
                return (
                  <div key={x.question} className={cn("rounded-xl border p-4", blocked ? "border-[color-mix(in_oklab,var(--warning)_45%,var(--border))]" : "border-border")}>
                    {blocked && (
                      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold tracking-wider text-warning uppercase">
                        <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Input required
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5">
                      <label htmlFor={`q-${x.question}`} className="text-sm font-medium">
                        {x.question}
                      </label>
                      {x.required && <Badge tone="danger">Required</Badge>}
                      {x.requires_approval && <Badge tone="warning">Needs your confirmation</Badge>}
                      {x.answer && <Badge tone={CONF_TONE[x.confidence] ?? "neutral"}>Confidence: {humanize(x.confidence)}</Badge>}
                    </div>
                    <Textarea
                      id={`q-${x.question}`}
                      className="mt-2"
                      rows={2}
                      value={answers[x.question] ?? ""}
                      disabled={submitted}
                      placeholder={x.answer ? undefined : "JobPilot can’t safely infer this. Answer it yourself, or leave it blank."}
                      onChange={(e) => setAnswers({ ...answers, [x.question]: e.target.value })}
                    />
                    <p className="mt-1.5 text-xs text-muted">
                      {x.answer ? `Drafted from: ${humanize(x.source)}.` : "No answer in your profile."} {x.reason}
                    </p>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          {/* cover letter */}
          <Card id="step-cover" className="scroll-mt-24">
            <CardHeader
              title="Cover letter"
              description={a.cover_letter_source === "user" ? "Edited by you." : a.cover_letter_source === "llm" ? "Written from your matched evidence and checked against your resume." : "Built from your matched evidence (template)."}
              action={
                a.cover_letter && (
                  <div className="flex items-center gap-2">
                    {a.cover_letter_source === "llm" && <AIGenerated />}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard.writeText(cover ?? a.cover_letter ?? "");
                        toast({ tone: "success", title: "Copied to clipboard" });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                  </div>
                )
              }
            />
            <CardBody>
              {a.cover_letter ? (
                <Textarea rows={12} value={cover ?? a.cover_letter} onChange={(e) => setCover(e.target.value)} disabled={submitted} aria-label="Cover letter" />
              ) : (
                <p className="text-sm text-muted">The cover letter appears once the application is prepared.</p>
              )}
            </CardBody>
          </Card>

          {prepared && !submitted && (
            <Card className="scroll-mt-24">
              <CardHeader title="Review & approve" description="Approving confirms everything above is accurate. It does not submit anything." />
              <CardBody className="space-y-3">
                <Field label="Notes (optional)" htmlFor="app-notes">
                  <Textarea id="app-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                <Button onClick={approve} loading={busy === "approve"}>
                  <Check className="h-4 w-4" /> Approve application
                </Button>
              </CardBody>
            </Card>
          )}

          {/* timeline */}
          <Card>
            <CardHeader title="Activity timeline" description="Every action on this application, including the agent’s." />
            <CardBody>
              <ol className="relative space-y-4 border-l border-border pl-5">
                {[...(a.events ?? [])].reverse().map((e) => (
                  <li key={e.id} className="relative">
                    <span className={cn("absolute top-1.5 -left-[25px] h-2 w-2 rounded-full ring-4 ring-surface", e.actor.startsWith("agent") ? "bg-primary" : "bg-subtle")} aria-hidden />
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-[13px] font-medium">
                        {humanize(e.action)}
                        {e.from_status && e.to_status && e.from_status !== e.to_status && (
                          <span className="font-normal text-subtle">
                            {" "}
                            · {statusOf(e.from_status).label} → {statusOf(e.to_status).label}
                          </span>
                        )}
                      </span>
                      <span className="text-[11px] text-muted">{fmtDateTime(e.created_at)}</span>
                    </div>
                    <div className="text-xs text-muted">{e.actor.startsWith("agent") ? `JobPilot agent (${e.actor.replace("agent:", "")})` : "You"}</div>
                    {e.notes && <p className="mt-1 text-xs text-subtle">{e.notes}</p>}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>

        {/* agent / submit */}
        <aside className="space-y-4">
          <div className="space-y-4 xl:sticky xl:top-20">
            <Card className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Application agent</span>
                <Badge tone={agent.tone}>
                  <span aria-hidden>{agent.symbol}</span> {agent.label}
                </Badge>
              </div>
              <div className="mt-4">
                <div className="flex items-baseline justify-between text-[13px]">
                  <span className="text-subtle">Readiness</span>
                  <span className="tabular font-mono font-semibold">{pct}%</span>
                </div>
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-hover" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Application readiness">
                  <div className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-700" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <ul className="mt-4 space-y-2">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2.5 text-[13px]">
                    <span className={cn("mt-0.5", c.done ? "text-success" : c.user ? "text-warning" : "text-muted")} aria-hidden>
                      {c.done ? <Check className="h-4 w-4" /> : c.user ? <AlertTriangle className="h-4 w-4" /> : <CircleDashed className="h-4 w-4" />}
                    </span>
                    <span>
                      <span className={c.done ? "" : "text-subtle"}>{c.label}</span>
                      <span className="sr-only">{c.done ? " (done)" : " (not done)"}</span>
                      {c.detail && <span className="block text-xs text-muted">{c.detail}</span>}
                    </span>
                  </li>
                ))}
              </ul>
              {needsInput.length > 0 && !submitted && (
                <a href="#step-questions" className="mt-4 flex items-center gap-2 rounded-lg tint-warning px-3 py-2 text-[13px] font-medium">
                  <AlertTriangle className="h-4 w-4" aria-hidden /> {needsInput.length} question{needsInput.length === 1 ? "" : "s"} need your input
                </a>
              )}
            </Card>

            <Card id="step-submit" className="scroll-mt-24 p-5">
              <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Submit</div>
              {submitted ? (
                <p className="mt-2 text-sm">
                  <Check className="mr-1 inline h-4 w-4 text-success" aria-hidden />
                  Submitted{a.applied_at ? ` on ${fmtDateTime(a.applied_at)}` : ""}.{a.submission_reference && <span className="block text-xs text-muted">Reference: {a.submission_reference}</span>}
                </p>
              ) : (
                <>
                  <p className="mt-2 text-[13px] text-subtle">
                    {authorized
                      ? "This employer has authorized API submission. It’s sent only after you approve and confirm."
                      : "Assisted application: open the employer’s page, apply with your approved resume and answers, then mark it as applied."}
                  </p>
                  <div className="mt-3 grid gap-2">
                    <Button onClick={submit} loading={busy === "submit"} disabled={a.status !== "READY"}>
                      <Send className="h-4 w-4" /> {authorized ? "Submit application" : "Apply on employer site"}
                    </Button>
                    {a.status !== "READY" && <p className="text-xs text-muted">Available after you approve the application.</p>}
                    {!authorized && a.status === "READY" && (
                      <Button variant="success" onClick={() => setStatus("APPLIED")} loading={busy === "status"}>
                        I’ve applied: mark as Applied
                      </Button>
                    )}
                  </div>
                </>
              )}
              {employerUrl && (
                <ButtonLink href={employerUrl} variant="ghost" size="sm" className="mt-2">
                  Employer posting <ExternalLink className="h-3 w-3" />
                </ButtonLink>
              )}
            </Card>

            <Card className="p-5">
              <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Track progress</div>
              <Field label="Status" htmlFor="app-status" className="mt-3">
                <Select id="app-status" value={a.status} onChange={(e) => void setStatus(e.target.value)}>
                  {!MANUAL_STATUSES.includes(a.status) && <option value={a.status}>{statusOf(a.status).label}</option>}
                  {MANUAL_STATUSES.filter((s) => s !== "READY" || a.status === "READY").map((s) => (
                    <option key={s} value={s}>
                      {statusOf(s).label}
                    </option>
                  ))}
                </Select>
              </Field>
            </Card>
          </div>
        </aside>
      </div>
    </>
  );
}

export default function ApplicationPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Workspace />
    </Suspense>
  );
}
