"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Download, GitCompare, Gauge, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { TestsTable } from "@/components/ats/report";
import { ResumeDiff } from "@/components/resume/diff";
import { RESUME_SECTIONS, ResumeDocument } from "@/components/resume/document";
import { VersionStatus } from "@/components/resume/version-status";
import { Badge, Button, ButtonLink, Callout, Card, CardBody, CardHeader, EmptyState, ErrorState, Meter, PageSkeleton, ScoreRing, Table, Tabs, Td, Textarea, Th, YesNo } from "@/components/ui";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, download } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApiMutation, useTemplateName } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, fmtDateTime, humanize } from "@/lib/utils";

type Tab = "resume" | "changes" | "claims" | "tests";

export default function VersionWorkspace() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("resume");
  const [notes, setNotes] = useState("");
  const confirm = useConfirm();
  const toast = useToast();
  const templateName = useTemplateName();
  const q = useQuery({ queryKey: ["version", id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${id}`) });
  const v = q.data;
  const diff = useQuery({ queryKey: ["version", id, "diff"], queryFn: () => api(S.DiffOut, "GET", `/resume/${id}/diff`), enabled: !!v?.parent_version_id, retry: false });
  const tests = useQuery({ queryKey: ["version", id, "tests"], queryFn: () => api(S.TestResults, "GET", `/resume/${id}/test-results`) });
  const review = useApiMutation(({ action }: { action: "approve" | "reject" }) => api(S.Version, "POST", `/resume/${id}/${action}`, { notes: notes || null }), [["version", id], ["versions"], ["insights"]]);

  if (q.isLoading) return <PageSkeleton rows={3} />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!v) return null;
  const isBase = v.version_type === "MASTER";
  const unverified = v.claims.filter((c) => !c.verified);
  const rewritten = (v.content?.experience ?? []).concat([]).flatMap((e) => e.bullets).concat((v.content?.projects ?? []).flatMap((p) => p.bullets)).filter((b) => b.original_text && b.original_text.trim() !== b.text.trim()).length;
  const canReview = !isBase && v.status !== "APPROVED";

  const doReview = async (action: "approve" | "reject") => {
    const ok = await confirm(
      action === "approve"
        ? { title: "Approve this resume?", body: "Approved versions can be used in applications. Make sure every statement is accurate.", confirmLabel: "Approve" }
        : { title: "Reject this resume?", body: "It stays in your history but won’t be used for applications.", confirmLabel: "Reject", tone: "danger" },
    );
    if (!ok) return;
    review.mutate(
      { action },
      {
        onSuccess: () => toast({ tone: "success", title: action === "approve" ? "Resume approved" : "Resume rejected" }),
        onError: (e) => toast({ tone: "error", title: "Couldn’t update this resume", body: errorText(e) }),
      },
    );
  };

  return (
    <>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 animate-rise">
        <div className="min-w-0">
          <Link href="/resume-lab" className="text-[13px] text-muted hover:text-foreground">
            ← Resume Versions
          </Link>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{isBase ? "Base resume" : v.label ?? `Version ${v.version_number}`}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone={isBase ? "primary" : "neutral"}>{isBase ? "Base · never modified by AI" : "Job-tailored"}</Badge>
            <VersionStatus status={v.status} />
            <Badge>v{v.version_number}</Badge>
            <Badge>{templateName(v.template)}</Badge>
            <span className="text-xs text-muted">{fmtDateTime(v.created_at)}</span>
            {v.job_id && (
              <Link href={`/jobs/${v.job_id}`} className="text-xs text-primary hover:underline">
                View target job →
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/resume-lab/${id}/test`} variant="secondary" size="sm">
            <Gauge className="h-3.5 w-3.5" /> ATS test
          </ButtonLink>
          <ButtonLink href={`/resume-lab/${id}/compare`} variant="secondary" size="sm">
            <GitCompare className="h-3.5 w-3.5" /> Compare
          </ButtonLink>
          {(["docx", "pdf", "txt"] as const).map((f) => (
            <Button key={f} variant="ghost" size="sm" onClick={() => download(`/resume/${id}/download?format=${f}`, `resume.${f}`)}>
              <Download className="h-3.5 w-3.5" /> {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {unverified.length > 0 && (
        <Callout tone="danger" className="mb-5" title={`${unverified.length} statement(s) couldn’t be verified against your base resume`} action={<Button size="sm" variant="secondary" onClick={() => setTab("claims")}>Review claims</Button>}>
          They must be resolved before this version can be approved.
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-[180px_1fr] xl:grid-cols-[180px_1fr_300px]">
        {/* sections */}
        <nav aria-label="Resume sections" className="hidden lg:block">
          <div className="sticky top-20 space-y-0.5">
            <div className="mb-2 px-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Sections</div>
            {RESUME_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#sec-${s.id}`}
                onClick={() => setTab("resume")}
                className="block rounded-lg px-2 py-1.5 text-[13px] text-subtle hover:bg-hover hover:text-foreground"
              >
                {s.label}
              </a>
            ))}
          </div>
        </nav>

        {/* editor / content */}
        <div className="min-w-0 space-y-4">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "resume", label: "Resume" },
              { id: "changes", label: "Changes", count: diff.data?.diff.changes.length },
              { id: "claims", label: "Claims", count: v.claims.length },
              { id: "tests", label: "Tests", count: tests.data?.tests.length },
            ]}
          />
          {tab === "resume" && (v.content ? <ResumeDocument content={v.content} /> : <pre className="rounded-xl border border-border bg-surface p-6 text-sm whitespace-pre-wrap">{v.text_preview}</pre>)}
          {tab === "changes" &&
            (!v.parent_version_id ? (
              <EmptyState title="Nothing to compare">This is an original upload; there’s no earlier version.</EmptyState>
            ) : diff.isLoading ? (
              <PageSkeleton rows={2} />
            ) : diff.error ? (
              <ErrorState error={diff.error} />
            ) : diff.data ? (
              <div className="space-y-4">
                <Card>
                  <CardHeader title={`Changes from ${diff.data.from.version_type === "MASTER" ? "your base resume" : `v${diff.data.from.version_number}`}`} description="Every AI change is listed here. Nothing is modified silently." />
                  <CardBody>
                    <ResumeDiff changes={diff.data.diff.changes} counts={diff.data.diff.counts} />
                  </CardBody>
                </Card>
                <Card>
                  <CardHeader title="Regression check" />
                  <CardBody className="space-y-3 text-sm">
                    {diff.data.regression.warnings.map((w) => (
                      <Callout key={w} tone="warning">
                        {w}
                      </Callout>
                    ))}
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div>
                        <span className="text-muted">Skills removed: </span>
                        {diff.data.regression.skills_lost.join(", ") || "None"}
                      </div>
                      <div>
                        <span className="text-muted">Skills added: </span>
                        {diff.data.regression.skills_added.join(", ") || "None"}
                      </div>
                    </div>
                    {Object.keys(diff.data.regression.score_deltas).length > 0 && (
                      <Table>
                        <thead>
                          <tr>
                            <Th>Score</Th>
                            <Th>Before</Th>
                            <Th>After</Th>
                            <Th>Change</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(diff.data.regression.score_deltas).map(([k, d]) => (
                            <tr key={k}>
                              <Td>{humanize(k)}</Td>
                              <Td className="tabular font-mono">{d.old.toFixed(0)}</Td>
                              <Td className="tabular font-mono">{d.new.toFixed(0)}</Td>
                              <Td className={cn("tabular font-mono", d.delta < 0 ? "text-danger" : d.delta > 0 ? "text-success" : "text-muted")}>
                                {d.delta === 0 ? "No change" : `${d.delta > 0 ? "+" : ""}${d.delta.toFixed(1)}`}
                              </Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </CardBody>
                </Card>
              </div>
            ) : null)}
          {tab === "claims" && (
            <Card>
              <CardHeader title="Claim verification" description="Every statement in a tailored resume must trace back to your base resume or profile." />
              {v.claims.length === 0 ? (
                <CardBody className="text-sm text-muted">{isBase ? "Your base resume contains your own facts; there’s nothing to verify." : "No claims recorded."}</CardBody>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Statement</Th>
                      <Th>Verified</Th>
                      <Th>Source</Th>
                      <Th>Your original text</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.claims.map((c, i) => (
                      <tr key={i}>
                        <Td className="max-w-sm text-[13px]">
                          {c.claim}
                          {!c.verified && Array.isArray(c.reasons) && (
                            <ul className="mt-1 text-xs text-danger">
                              {(c.reasons as unknown[]).map((r, j) => (
                                <li key={j}>{String(r)}</li>
                              ))}
                            </ul>
                          )}
                        </Td>
                        <Td>
                          <YesNo value={c.verified} />
                        </Td>
                        <Td className="text-xs whitespace-nowrap">{humanize(c.source_type ?? c.section)}</Td>
                        <Td className="max-w-sm text-xs text-muted">{c.original ?? "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}
          {tab === "tests" && (
            <Card>
              <CardHeader title="Latest test results" description="Run on the generated DOCX/PDF: extraction, round-trip parsing, formatting and evidence checks." action={<ButtonLink href={`/resume-lab/${id}/test`} size="sm" variant="secondary">Re-run</ButtonLink>} />
              <CardBody>{tests.isLoading ? <PageSkeleton rows={1} /> : <TestsTable tests={tests.data?.tests ?? []} />}</CardBody>
            </Card>
          )}
        </div>

        {/* insights */}
        <aside className="space-y-4 lg:col-span-2 xl:col-span-1">
          <div className="space-y-4 xl:sticky xl:top-20">
            <Card className="p-5 text-center">
              <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">ATS readiness</div>
              <div className="mt-3 flex justify-center">
                <ScoreRing score={v.quality_index} size={112} stroke={8} label="quality" />
              </div>
              <div className="mt-5 space-y-3 text-left">
                <Meter label="Parser" value={v.parser_score} />
                <Meter label="Round-trip" value={v.round_trip_score} />
                <Meter label="Formatting" value={v.formatting_score} />
                <Meter label="Keywords" value={v.keyword_score} />
                <Meter label="Requirements" value={v.requirement_score} />
                <Meter label="Evidence" value={v.evidence_score} />
              </div>
            </Card>
            {!isBase && (
              <Card className="p-5">
                <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">AI changes</div>
                <dl className="mt-3 space-y-2 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-subtle">Bullets rewritten</dt>
                    <dd className="tabular font-mono">{rewritten}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-subtle">Claims verified</dt>
                    <dd className="tabular font-mono">
                      {v.claims.length - unverified.length}/{v.claims.length}
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-subtle">Summary</dt>
                    <dd>{v.content?.summary_source === "generated" ? "AI generated" : v.content?.summary_source === "original" ? "Your original" : "None"}</dd>
                  </div>
                </dl>
              </Card>
            )}
            {canReview && (
              <Card className="p-5">
                <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Your review</div>
                <p className="mt-2 text-[13px] text-subtle">Read the resume and the Changes tab. Approve only if every statement is accurate.</p>
                <Textarea className="mt-3" rows={2} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Review notes" />
                <div className="mt-3 flex gap-2">
                  <Button variant="success" className="flex-1" disabled={unverified.length > 0} onClick={() => doReview("approve")} loading={review.isPending && review.variables?.action === "approve"}>
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button variant="secondary" className="flex-1" onClick={() => doReview("reject")} loading={review.isPending && review.variables?.action === "reject"}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </Card>
            )}
            {isBase && (
              <Callout tone="info" title="Want to change something?">
                Edit your facts in{" "}
                <Link href="/profile" className="text-primary hover:underline">
                  Profile
                </Link>
                . That creates a new base version; this one is kept.
              </Callout>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
