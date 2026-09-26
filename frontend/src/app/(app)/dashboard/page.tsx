"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Bookmark, BriefcaseBusiness, MessagesSquare, Search, Sparkles, Target, Upload } from "lucide-react";
import Link from "next/link";

import { AIThinking, PIPELINES } from "@/components/ai/thinking";
import { StatusBadge } from "@/components/applications/tracker";
import { JobCard } from "@/components/jobs/job-card";
import { Button, ButtonLink, Card, CardBody, CardHeader, Chip, EmptyState, ErrorState, KPI, PageSkeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApplications, useInsights, useMe, useTaskTracker } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, fmtRelative } from "@/lib/utils";

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const BRIEF_TONE: Record<string, string> = { primary: "bg-primary", warning: "bg-warning", info: "bg-info" };

export default function DashboardPage() {
  const me = useMe();
  const hasProfile = !!me.data?.has_profile;
  const insights = useInsights(hasProfile);
  const top = useQuery({ queryKey: ["jobs", "dashboard-top"], queryFn: () => api(S.JobList, "GET", "/jobs?page_size=4&sort=score"), enabled: hasProfile });
  const apps = useApplications();
  const tracker = useTaskTracker([["insights"], ["jobs"], ["dashboard"]]);
  const toast = useToast();

  if (me.isLoading) return <PageSkeleton />;
  if (me.data && !hasProfile)
    return (
      <>
        <PageHeader />
        <EmptyState
          icon={<Upload className="h-5 w-5" />}
          title="No resume uploaded yet"
          action={
            <ButtonLink href="/onboarding" size="lg">
              Set up my workspace <ArrowRight className="h-4 w-4" />
            </ButtonLink>
          }
        >
          Upload your resume and JobPilot will find jobs, explain your fit for each one, and help you build strong applications.
        </EmptyState>
      </>
    );
  if (insights.isPending) return <PageSkeleton />;
  if (insights.error) return <ErrorState error={insights.error} onRetry={() => insights.refetch()} context="load your dashboard" />;
  const d = insights.data!;

  const search = async () => {
    try {
      const out = await api(S.SearchOut, "POST", "/jobs/search", {});
      tracker.start(out.task.id);
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t start the search", body: errorText(e) });
    }
  };

  const matched = top.data?.jobs.filter((j) => j.match) ?? [];
  const recent = (apps.data?.applications ?? []).slice(0, 6);

  return (
    <>
      <PageHeader
        action={
          <Button onClick={search} loading={tracker.running}>
            <Search className="h-4 w-4" /> {tracker.running ? "Searching…" : "Find new jobs"}
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KPI label="High matches" value={d.kpis.high_matches} sub={`Score ≥ ${d.kpis.high_threshold}`} icon={<Sparkles className="h-4 w-4" />} href={`/jobs?min_score=${d.kpis.high_threshold}`} />
        <KPI label="Saved jobs" value={d.kpis.saved} icon={<Bookmark className="h-4 w-4" />} href="/saved" />
        <KPI label="Applications" value={d.kpis.applications} sub={d.kpis.follow_ups_due ? `${d.kpis.follow_ups_due} follow-up${d.kpis.follow_ups_due === 1 ? "" : "s"} due` : "Submitted so far"} icon={<BriefcaseBusiness className="h-4 w-4" />} href="/applications" />
        <KPI label="Interviews" value={d.kpis.interviews} icon={<MessagesSquare className="h-4 w-4" />} href="/applications/interviews" />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
        <div className="min-w-0 space-y-5">
          {tracker.running || tracker.done ? (
            <AIThinking tracker={tracker} steps={PIPELINES.search} title={tracker.done ? "Search complete. Your matches and brief are up to date." : "Finding and scoring new jobs for you…"} />
          ) : null}

          <section className="rounded-xl border ai-border ai-gradient bg-surface p-5" aria-labelledby="brief">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 id="brief" className="flex items-center gap-2 text-[13px] font-semibold tracking-wider uppercase">
                <span className="text-primary" aria-hidden>
                  ✦
                </span>
                Today’s brief
              </h2>
              <span className="text-xs text-muted">From your matches and applications · updated {fmtRelative(d.generated_at)}</span>
            </div>
            {d.brief.length ? (
              <ul className="mt-4 space-y-3">
                {d.brief.map((b) => (
                  <li key={b.kind} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="flex items-start gap-3 text-[15px]">
                      <span className={cn("mt-2 h-1.5 w-1.5 shrink-0 rounded-full", BRIEF_TONE[b.tone] ?? "bg-primary")} aria-hidden />
                      {b.text}
                    </span>
                    <ButtonLink href={b.action.href} variant="secondary" size="sm" className="self-start sm:self-auto">
                      {b.action.label}
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-[15px] text-subtle">Nothing needs your attention right now. Run a search to find new matches.</p>
            )}
          </section>

          <Card>
            <CardHeader
              title="Top matches"
              icon={<Sparkles className="h-4 w-4" />}
              description="Highest-scoring jobs that pass your filters."
              action={
                <ButtonLink href="/matches" variant="ghost" size="sm">
                  View all <ArrowRight className="h-3.5 w-3.5" />
                </ButtonLink>
              }
            />
            <CardBody className="grid gap-3 md:grid-cols-2">
              {top.isLoading && <PageSkeleton rows={1} />}
              {!top.isLoading && !matched.length && (
                <div className="md:col-span-2">
                  <EmptyState title="No matches yet" action={<Button onClick={search}>Find jobs</Button>}>
                    Run a search to discover and score jobs.
                  </EmptyState>
                </div>
              )}
              {matched.map((j) => (
                <JobCard key={j.id} job={j} />
              ))}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Application activity"
              action={
                <ButtonLink href="/applications" variant="ghost" size="sm">
                  Tracker
                </ButtonLink>
              }
            />
            <CardBody>
              {!recent.length ? (
                <p className="text-sm text-muted">No applications yet. Save a job or prepare an application to start tracking.</p>
              ) : (
                <ol className="relative space-y-4 border-l border-border pl-4">
                  {recent.map((a) => (
                    <li key={a.id} className="relative">
                      <span className="absolute top-1.5 -left-[21px] h-2 w-2 rounded-full bg-primary ring-4 ring-surface" aria-hidden />
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/applications/${a.id}`} className="min-w-0 text-[13px] hover:text-primary">
                          <div className="truncate font-medium">{a.job?.title}</div>
                          <div className="truncate text-xs text-subtle">{a.job?.company}</div>
                        </Link>
                        <StatusBadge status={a.status} />
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted">Updated {fmtRelative(a.updated_at)}</div>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Skill insights"
              icon={<Target className="h-4 w-4" />}
              description={`Based on ${d.skill_gaps.based_on_postings} job${d.skill_gaps.based_on_postings === 1 ? "" : "s"} that pass your filters.`}
              action={
                <ButtonLink href="/skills" variant="ghost" size="sm">
                  Details
                </ButtonLink>
              }
            />
            <CardBody className="space-y-4">
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Your strongest skills</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.skill_gaps.strengths.slice(0, 8).map((s) => (
                    <Chip key={s.skill} tone="success">
                      ✓ {s.skill} <span className="opacity-70">· {s.postings}</span>
                    </Chip>
                  ))}
                  {!d.skill_gaps.strengths.length && <span className="text-sm text-muted">Not enough data yet.</span>}
                </div>
              </div>
              <div>
                <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Most common gaps</div>
                <div className="flex flex-wrap gap-1.5">
                  {d.skill_gaps.gaps.slice(0, 6).map((g) => (
                    <Chip key={g.skill} tone="warning">
                      ⚠ {g.skill} <span className="opacity-70">· {g.required_in + g.preferred_in}</span>
                    </Chip>
                  ))}
                  {!d.skill_gaps.gaps.length && <span className="text-sm text-muted">No gaps found.</span>}
                </div>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}

function PageHeader({ action }: { action?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-rise">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">
          {greeting()} <span aria-hidden>👋</span>
        </h1>
        <p className="mt-1 text-sm text-subtle">Here’s what needs your attention in your job search.</p>
      </div>
      {action}
    </div>
  );
}
