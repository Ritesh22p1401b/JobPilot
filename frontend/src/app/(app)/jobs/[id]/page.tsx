"use client";

import { useQuery } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ExternalLink, Gauge, Send, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { StatusBadge } from "@/components/applications/tracker";
import { TIER_LABEL, strengthOf } from "@/components/jobs/evidence";
import { EvidenceMapping, HardFilters, MatchBreakdown, ResumeComparison, WhyYouMatch } from "@/components/jobs/fit";
import { jobMeta } from "@/components/jobs/job-card";
import { useJobActions } from "@/components/jobs/use-job-actions";
import { AIGenerated, Badge, Button, ButtonLink, Callout, Card, CardBody, CardHeader, Chip, ErrorState, PageSkeleton, ScoreRing, Tabs, scoreLabel } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApiMutation, useApplications } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDate, fmtSalary, humanize } from "@/lib/utils";

type Tab = "overview" | "evidence" | "compare" | "description";

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("overview");
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api(S.JobDetail, "GET", `/jobs/${id}`) });
  const apps = useApplications();
  const { save, apply, busy } = useJobActions();
  const toast = useToast();
  const explain = useApiMutation((matchId: string) => api(S.Match, "POST", `/matches/${matchId}/explain`), [["job", id]]);

  if (job.isLoading) return <PageSkeleton rows={3} />;
  if (job.error) return <ErrorState error={job.error} onRetry={() => job.refetch()} context="load this job" />;
  const j = job.data!;
  const m = j.match;
  const a = j.analysis;
  const salary = fmtSalary(j.salary_min, j.salary_max, j.currency);
  const application = apps.data?.applications.find((x) => x.job_id === j.id);
  const byTier = (tier: string) => j.requirement_matrix.filter((r) => r.tier === tier);

  return (
    <>
      <Link href="/jobs" className="text-[13px] text-muted hover:text-foreground">
        ← Job Search
      </Link>
      <div className="mt-3 grid gap-6 xl:grid-cols-[1fr_400px]">
        {/* ------------------------------------------------ job description */}
        <div className="min-w-0 space-y-5">
          <div className="animate-rise">
            <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{j.title}</h1>
            <p className="mt-1 text-[15px] text-subtle">{j.company}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Chip>{jobMeta(j).join(" · ")}</Chip>
              {j.seniority && <Chip>{humanize(j.seniority)}</Chip>}
              {salary && <Chip>{salary}{j.salary_is_predicted ? " · Adzuna estimate, not from the employer" : ""}</Chip>}
              <Chip>Posted {fmtDate(j.posted_at ?? j.first_seen_at)}</Chip>
              <Chip>via {humanize(j.source)}</Chip>
              {application && <StatusBadge status={application.status} />}
            </div>
          </div>

          {j.description_truncated && (
            <Callout tone="warning" title="Partial description">
              The source only provided a shortened description, so some requirements may be missing. Check the original posting.
            </Callout>
          )}

          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "overview", label: "Overview" },
              { id: "evidence", label: "Requirement map", count: j.requirement_matrix.length },
              { id: "compare", label: "Resume comparison" },
              { id: "description", label: "Full description" },
            ]}
          />

          {tab === "overview" && (
            <div className="space-y-5">
              {a.responsibilities.length > 0 && (
                <Card>
                  <CardHeader title="Responsibilities" />
                  <CardBody>
                    <ul className="list-disc space-y-1.5 pl-5 text-sm text-subtle">
                      {a.responsibilities.slice(0, 10).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </CardBody>
                </Card>
              )}
              <Card>
                <CardHeader title="Requirements" description="Extracted from the job description and classified by how strongly they’re required." />
                <CardBody className="space-y-4">
                  {(["REQUIRED", "PREFERRED", "NICE_TO_HAVE"] as const).map((tier) =>
                    byTier(tier).length ? (
                      <div key={tier}>
                        <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">{TIER_LABEL[tier]}</div>
                        <div className="flex flex-wrap gap-1.5">
                          {byTier(tier).map((r, i) => {
                            const st = strengthOf(r.status);
                            return (
                              <Chip key={`${r.requirement}-${i}`} tone={r.matched ? "success" : st.tone === "neutral" ? "neutral" : tier === "REQUIRED" ? "warning" : "neutral"} title={`${st.label}${r.source_span ? ` · “${r.source_span}”` : ""}`}>
                                <span aria-hidden>{st.symbol}</span> {r.skill ?? r.requirement}
                                <span className="sr-only">({st.label})</span>
                              </Chip>
                            );
                          })}
                        </div>
                      </div>
                    ) : null,
                  )}
                  <div className="grid gap-2 border-t border-border pt-4 text-[13px] sm:grid-cols-3">
                    <div>
                      <span className="text-muted">Experience: </span>
                      {a.min_years ? `${a.min_years}${a.max_years ? `–${a.max_years}` : "+"} years` : "Not stated"}
                    </div>
                    <div>
                      <span className="text-muted">Sponsorship: </span>
                      {a.sponsorship === "available" ? "Available" : a.sponsorship === "not_available" ? "Not available" : "Not stated"}
                    </div>
                    <div>
                      <span className="text-muted">Education: </span>
                      {a.education.length ? a.education.join(", ") : "Not stated"}
                    </div>
                  </div>
                </CardBody>
              </Card>
            </div>
          )}
          {tab === "evidence" && (
            <Card>
              <CardHeader title="Requirement → your evidence → strength" description="Every requirement found in this job, mapped to the resume line that supports it." />
              <CardBody>
                <EvidenceMapping items={j.requirement_matrix} />
              </CardBody>
            </Card>
          )}
          {tab === "compare" && (
            <Card>
              <CardHeader title="Job ↔ resume" description="How strongly the job asks for each skill, next to how strongly your resume evidences it." />
              <CardBody>
                <ResumeComparison items={j.requirement_matrix} />
              </CardBody>
            </Card>
          )}
          {tab === "description" && (
            <Card>
              <CardBody className="pt-5 text-sm leading-relaxed whitespace-pre-line text-subtle">{j.description}</CardBody>
            </Card>
          )}
        </div>

        {/* ------------------------------------------------ AI fit analysis */}
        <aside className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <Card className="overflow-hidden">
            <div className="ai-gradient border-b border-border px-5 py-5">
              <div className="flex items-center gap-5">
                <ScoreRing score={m?.overall_score} size={104} stroke={8} label="match" />
                <div>
                  <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">AI fit analysis</div>
                  <div className="mt-1 text-lg font-semibold">{m ? scoreLabel(m.overall_score) : "Not scored yet"}</div>
                  <p className="mt-0.5 text-xs text-muted">An estimate of fit from your evidence, not a guarantee.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <ButtonLink href={`/resume-lab/new?job=${j.id}`}>
                  <Wand2 className="h-4 w-4" /> Tailor resume
                </ButtonLink>
                {application ? (
                  <ButtonLink href={`/applications/${application.id}`} variant="secondary">
                    <Send className="h-4 w-4" /> Open application
                  </ButtonLink>
                ) : (
                  <Button variant="secondary" onClick={() => apply(j.id)} loading={busy === `apply:${j.id}`} disabled={!!m && !m.hard_filter_passed}>
                    <Send className="h-4 w-4" /> Apply
                  </Button>
                )}
                <ButtonLink href={`/jobs/${j.id}/resume-analysis`} variant="secondary">
                  <Gauge className="h-4 w-4" /> ATS analysis
                </ButtonLink>
                {m && (
                  <Button variant="secondary" onClick={() => save(j.id, !m.saved)} loading={busy === `save:${j.id}`}>
                    {m.saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />} {m.saved ? "Saved" : "Save"}
                  </Button>
                )}
              </div>
            </div>
            {m ? (
              <CardBody className="space-y-6 pt-5">
                <HardFilters match={m} />
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Explanation</span>
                    {m.explanation_source === "llm" ? (
                      <AIGenerated />
                    ) : (
                      <Button
                        variant="ai"
                        size="sm"
                        loading={explain.isPending}
                        onClick={() => explain.mutate(m.id, { onError: (e) => toast({ tone: "error", title: "Couldn’t generate an explanation", body: errorText(e) }) })}
                      >
                        <span aria-hidden>✦</span> Explain with AI
                      </Button>
                    )}
                  </div>
                  <p className="text-[13px] leading-relaxed whitespace-pre-line text-subtle">{m.explanation ?? "No explanation yet."}</p>
                </div>
                <WhyYouMatch match={m} compact />
                <div>
                  <div className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Score breakdown</div>
                  <MatchBreakdown match={m} />
                </div>
              </CardBody>
            ) : (
              <CardBody className="pt-5 text-sm text-muted">This job hasn’t been scored yet. Scoring runs automatically after each search.</CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Links" />
            <CardBody className="flex flex-wrap gap-2">
              {(j.application_url || j.url) && (
                <ButtonLink href={j.application_url ?? j.url ?? "#"} variant="secondary" size="sm">
                  Original posting <ExternalLink className="h-3.5 w-3.5" />
                </ButtonLink>
              )}
              {Object.entries(j.destination_links).map(([name, url]) => (
                <ButtonLink key={name} href={url} variant="ghost" size="sm">
                  Search on {humanize(name)} <ExternalLink className="h-3.5 w-3.5" />
                </ButtonLink>
              ))}
            </CardBody>
            {j.alternate_sources.length > 0 && <CardBody className="pt-0 text-xs text-muted">Also listed on {j.alternate_sources.length} other source(s); duplicates are merged.</CardBody>}
          </Card>
          {m && !m.hard_filter_passed && <Badge tone="danger">Apply is disabled because this job fails a hard requirement</Badge>}
        </aside>
      </div>
    </>
  );
}
