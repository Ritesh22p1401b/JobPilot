"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Send } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { AppStatusBadge } from "@/components/domain";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Field,
  LinkButton,
  Loading,
  Select,
  Table,
  Td,
  Textarea,
  Th,
  YesNo,
  type Tone,
} from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useApiMutation, useTaskTracker } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDateTime, humanize } from "@/lib/utils";

const MANUAL_STATUSES = ["SAVED", "READY", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"];
const CONF_TONE: Record<string, Tone> = { HIGH: "success", MEDIUM: "info", LOW: "warning", UNKNOWN: "neutral" };

export default function ApplicationPage() {
  const { id } = useParams<{ id: string }>();
  const app = useQuery({ queryKey: ["application", id], queryFn: () => api(S.Application, "GET", `/applications/${id}`) });
  const a = app.data;
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [cover, setCover] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState("");
  const prepare = useTaskTracker([["application", id], ["applications"]]);
  const keys = [["application", id], ["applications"], ["dashboard"]];

  useEffect(() => {
    if (a) {
      setAnswers(Object.fromEntries(a.answers.map((x) => [x.question, x.answer ?? ""])));
      setNotes(a.notes ?? "");
    }
  }, [a]);

  const approve = useApiMutation(
    () =>
      api(S.Application, "POST", `/applications/${a!.job_id}/approve`, {
        answers: Object.fromEntries(Object.entries(answers).map(([q, v]) => [q, v.trim() || null])),
        approve_resume: true,
        cover_letter: cover,
        notes: notes || null,
      }),
    keys,
  );
  const submit = useApiMutation(() => api(S.SubmitOut, "POST", `/applications/${a!.job_id}/submit`), keys);
  const patch = useApiMutation((body: { status?: string; notes?: string }) => api(S.Application, "PATCH", `/applications/${id}`, body), keys);

  if (app.isLoading) return <Loading />;
  if (app.error) return <ErrorState error={app.error} />;
  if (!a) return null;

  const pkg = a.package as Record<string, unknown>;
  const prepared = a.answers.length > 0 || !!a.cover_letter;
  const unanswered = (pkg.unanswered_required as string[] | undefined) ?? [];
  const destination = (pkg.destination_links as Record<string, string> | undefined) ?? {};
  const authorized = pkg.provider_authorized === true;

  const startPrepare = async () => {
    const out = await api(S.PrepareOut, "POST", `/applications/${a.job_id}/prepare`);
    prepare.start(out.task.id);
  };

  return (
    <>
      <Link href="/applications" className="text-sm text-muted-foreground hover:text-foreground">
        ← Applications
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{a.job?.title ?? "Application"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{a.job?.company}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <AppStatusBadge status={a.status} />
            <Badge>{humanize(a.mode)}</Badge>
            <Badge tone={authorized ? "info" : "neutral"}>Submission: {authorized ? "Authorized employer API" : "You apply on the employer site"}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/jobs/${a.job_id}`} variant="outline">View job</LinkButton>
          <Button variant="outline" onClick={startPrepare} loading={prepare.running}>
            {prepared ? "Re-prepare" : "Prepare application"}
          </Button>
        </div>
      </div>

      {prepare.failed && <Alert tone="danger" className="mb-4">{prepare.task?.error}</Alert>}
      {!prepared && !prepare.running && (
        <Alert tone="info" className="mb-5">
          Prepare the application to generate a tailored resume, a cover letter and draft answers. You review everything before anything is sent.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          {prepared && (
            <>
              <Card>
                <CardHeader
                  title="Application questions"
                  description="Draft answers use only facts from your profile and preferences. Sensitive answers (salary, visa, demographics) always need your confirmation. Leave blank if you don’t want to answer."
                />
                <CardBody className="space-y-5">
                  {a.answers.length === 0 && <p className="text-sm text-muted-foreground">No questions for this posting.</p>}
                  {a.answers.map((q) => (
                    <div key={q.question}>
                      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-sm font-medium">{q.question}</span>
                        {q.required && <Badge tone="danger">Required</Badge>}
                        {q.requires_approval && <Badge tone="warning">Needs your approval</Badge>}
                        <Badge tone={CONF_TONE[q.confidence] ?? "neutral"}>Confidence: {humanize(q.confidence)}</Badge>
                      </div>
                      <Textarea
                        rows={2}
                        value={answers[q.question] ?? ""}
                        placeholder={q.answer ? undefined : "No answer found in your profile. Answer yourself, or leave blank."}
                        onChange={(e) => setAnswers({ ...answers, [q.question]: e.target.value })}
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Source: {humanize(q.source)}. {q.reason}
                      </p>
                    </div>
                  ))}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Cover letter"
                  description={a.cover_letter_source === "llm" ? "Drafted by the LLM, then checked against your resume evidence." : a.cover_letter_source === "user" ? "Edited by you." : "Template-based draft built from your resume evidence."}
                />
                <CardBody>
                  <Textarea rows={12} value={cover ?? a.cover_letter ?? ""} onChange={(e) => setCover(e.target.value)} />
                </CardBody>
              </Card>

              <Card>
                <CardHeader title="Approve" />
                <CardBody className="space-y-3">
                  <Field label="Notes (optional)">
                    <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
                  </Field>
                  {unanswered.length > 0 && (
                    <Alert tone="warning" title="Required questions still unanswered">
                      <ul className="list-disc pl-4">
                        {unanswered.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ul>
                    </Alert>
                  )}
                  {approve.error && <Alert tone="danger">{(approve.error as ApiError).message}</Alert>}
                  {approve.isSuccess && <Alert tone="success">Saved. Status: {humanize(approve.data.status)}.</Alert>}
                  <Button onClick={() => approve.mutate(undefined)} loading={approve.isPending}>
                    Approve answers, cover letter and resume
                  </Button>
                </CardBody>
              </Card>
            </>
          )}

          <Card>
            <CardHeader title="Audit trail" description="Every action on this application, in order." />
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Who</Th>
                  <Th>Action</Th>
                  <Th>Status</Th>
                  <Th>Notes</Th>
                </tr>
              </thead>
              <tbody>
                {(a.events ?? []).map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-xs text-muted-foreground">{fmtDateTime(e.created_at)}</Td>
                    <Td className="text-xs">{humanize(e.actor)}</Td>
                    <Td className="text-xs">{humanize(e.action)}</Td>
                    <Td className="text-xs">
                      {e.from_status && e.from_status !== e.to_status ? `${humanize(e.from_status)} → ${humanize(e.to_status)}` : humanize(e.to_status)}
                    </Td>
                    <Td className="max-w-xs text-xs text-muted-foreground">{e.notes ?? ""}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Submit" />
            <CardBody className="space-y-3 text-sm">
              {authorized ? (
                <p className="text-xs text-muted-foreground">
                  This employer has authorized API submission. It’s sent only after you approve and press Submit.
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Assisted application: open the employer’s page, apply there with your approved resume and answers, then mark this as
                  applied.
                </p>
              )}
              <div className="grid gap-2">
                {a.resume_version_id && (
                  <LinkButton href={`/resume-lab/${a.resume_version_id}`} variant="outline">
                    Review resume used
                  </LinkButton>
                )}
                {(a.application_url ?? a.job?.application_url ?? a.job?.url) && (
                  <LinkButton href={a.application_url ?? a.job?.application_url ?? a.job?.url ?? "#"} target="_blank" rel="noreferrer" variant="outline">
                    Open employer application <ExternalLink className="h-3.5 w-3.5" />
                  </LinkButton>
                )}
                <Button
                  onClick={async () => {
                    const out = await submit.mutateAsync(undefined);
                    // Assisted mode: the backend logs the hand-off and returns the employer page to apply on.
                    if (out.result.method === "assisted" && out.result.application_url) window.open(out.result.application_url, "_blank", "noopener");
                  }}
                  loading={submit.isPending}
                  disabled={a.status !== "READY"}
                >
                  <Send className="h-4 w-4" /> {authorized ? "Submit application" : "Apply on employer site"}
                </Button>
                {a.status !== "READY" && <p className="text-xs text-muted-foreground">Available once the application is approved and Ready.</p>}
                {!authorized && a.status === "READY" && (
                  <Button variant="success" onClick={() => patch.mutate({ status: "APPLIED" })} loading={patch.isPending}>
                    I’ve applied — mark as Applied
                  </Button>
                )}
              </div>
              {submit.error && <Alert tone="danger">{(submit.error as ApiError).message}</Alert>}
              {submit.data?.result.missing_required.length ? (
                <Alert tone="warning" title="The employer requires answers to">
                  {submit.data.result.missing_required.join(", ")}
                </Alert>
              ) : null}
              {submit.data && <Alert tone={submit.data.result.status === "FAILED" ? "danger" : "success"}>{submit.data.result.message}</Alert>}
              {Object.keys(destination).length > 0 && (
                <div className="flex flex-wrap gap-2 border-t pt-3">
                  {Object.entries(destination).map(([name, url]) => (
                    <LinkButton key={name} href={url} target="_blank" rel="noreferrer" variant="ghost" size="sm">
                      Find on {humanize(name)} <ExternalLink className="h-3 w-3" />
                    </LinkButton>
                  ))}
                </div>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Track progress" description="Update the status yourself as things happen." />
            <CardBody className="space-y-3">
              <Select value={status || a.status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
                {!MANUAL_STATUSES.includes(a.status) && <option value={a.status}>{humanize(a.status)}</option>}
                {MANUAL_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {humanize(s)}
                  </option>
                ))}
              </Select>
              <Button variant="outline" className="w-full" disabled={!status || status === a.status} onClick={() => patch.mutate({ status })} loading={patch.isPending}>
                Update status
              </Button>
              {patch.error && <Alert tone="danger">{(patch.error as ApiError).message}</Alert>}
              <dl className="grid grid-cols-2 gap-y-1 border-t pt-3 text-xs">
                <dt className="text-muted-foreground">Applied</dt>
                <dd className="text-right">{fmtDateTime(a.applied_at)}</dd>
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="truncate text-right">{a.submission_reference ?? "—"}</dd>
                <dt className="text-muted-foreground">Resume approved</dt>
                <dd className="text-right">
                  <YesNo value={pkg.resume_status === "APPROVED" || !!pkg.approved_at} />
                </dd>
              </dl>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
