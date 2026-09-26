"use client";

import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import Link from "next/link";

import { AppStatusBadge, JobLink, NeedsResume, VersionStatusBadge } from "@/components/domain";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, LinkButton, Loading, PageHeader, ScoreBadge, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { useDashboard, useTaskTracker } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDateTime, humanize } from "@/lib/utils";

export default function DashboardPage() {
  const dash = useDashboard();
  const top = useQuery({
    queryKey: ["matches", "top"],
    queryFn: () => api(S.JobList, "GET", "/jobs?page_size=6&sort=score"),
    enabled: !!dash.data?.has_profile,
  });
  const apps = useQuery({
    queryKey: ["applications"],
    queryFn: () => api(S.ApplicationList, "GET", "/applications"),
    enabled: !!dash.data?.has_profile,
  });
  const tracker = useTaskTracker([["dashboard"], ["matches"], ["jobs"]]);

  if (dash.isLoading) return <Loading />;
  if (dash.error) return <ErrorState error={dash.error} />;
  const d = dash.data;
  if (!d?.has_profile)
    return (
      <>
        <PageHeader title="Dashboard" />
        <NeedsResume />
      </>
    );

  const search = async () => {
    const out = await api(S.SearchOut, "POST", "/jobs/search", {});
    tracker.start(out.task.id);
  };

  const matched = top.data?.jobs.filter((j) => j.match) ?? [];

  return (
    <>
      <PageHeader
        title="Dashboard"
        description={`Last search ${d.last_discovery_at ? fmtDateTime(d.last_discovery_at) : "never"} · automatic search: ${humanize(d.search_frequency)}`}
        action={
          <Button onClick={search} loading={tracker.running}>
            <Search className="h-4 w-4" /> {tracker.running ? "Searching…" : "Find jobs now"}
          </Button>
        }
      />

      {tracker.done && !tracker.failed && (
        <Alert tone="success" className="mb-5">
          Search finished. Jobs have been fetched, deduplicated and scored against your profile.
        </Alert>
      )}
      {tracker.failed && (
        <Alert tone="danger" className="mb-5" title="Search failed">
          {tracker.task?.error}
        </Alert>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="New matches (24h)" value={d.jobs_found_today ?? 0} />
        <Stat label="High matches" value={d.high_match_jobs ?? 0} sub={`of ${d.total_matches ?? 0} passing your filters`} />
        <Stat label="Applications" value={d.applications ?? 0} sub={`${d.interviews ?? 0} interviews · ${d.offers ?? 0} offers`} />
        <Stat label="Needs your action" value={d.pending_actions ?? 0} sub={`${d.pending_resume_reviews ?? 0} resume reviews`} />
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader title="Top matches" action={<LinkButton href="/jobs" variant="outline" size="sm">All jobs</LinkButton>} />
          <CardBody className="p-0">
            {top.isLoading && <Loading />}
            {!top.isLoading && matched.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">No matches yet. Run a search to discover jobs.</p>
            )}
            <ul>
              {matched.map((j) => (
                <li key={j.id} className="flex items-center gap-3 border-b px-5 py-3 last:border-0">
                  <ScoreBadge score={j.match?.overall_score} />
                  <div className="min-w-0 flex-1">
                    <JobLink id={j.id} title={j.title} company={`${j.company} · ${j.location ?? "Location not stated"}`} />
                  </div>
                  {(j.match?.missing_skills.required ?? []).length > 0 && (
                    <span className="hidden text-xs text-muted-foreground md:inline">
                      {j.match?.missing_skills.required?.length} required gap{j.match?.missing_skills.required?.length === 1 ? "" : "s"}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Master resume" />
            <CardBody className="space-y-2 text-sm">
              {d.master_resume ? (
                <>
                  <div className="flex items-center justify-between">
                    <span className="truncate">{d.master_resume.label ?? `Version ${d.master_resume.version_number}`}</span>
                    <VersionStatusBadge status={d.master_resume.status} />
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Quality index</span>
                    <ScoreBadge score={d.master_resume.quality_index} />
                  </div>
                  <div className="flex gap-2 pt-1">
                    <LinkButton href="/resume" variant="outline" size="sm">View</LinkButton>
                    <LinkButton href="/resume-lab" variant="outline" size="sm">Resume Lab</LinkButton>
                  </div>
                </>
              ) : (
                <span className="text-muted-foreground">No resume yet.</span>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Automation" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Application mode</span>
                <Badge tone="info">{humanize(d.application_mode)}</Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auto-apply</span>
                <Badge tone={d.auto_apply ? "warning" : "neutral"}>{d.auto_apply ? "On" : "Off"}</Badge>
              </div>
              <Link href="/preferences" className="block pt-1 text-xs text-primary">
                Change in Preferences →
              </Link>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent applications" />
            <CardBody className="p-0">
              {!apps.data?.applications.length && <p className="px-5 py-5 text-sm text-muted-foreground">No applications yet.</p>}
              <ul>
                {apps.data?.applications.slice(0, 5).map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 border-b px-5 py-2.5 last:border-0">
                    <Link href={`/applications/${a.id}`} className="min-w-0 truncate text-sm hover:text-primary">
                      {a.job?.title} <span className="text-muted-foreground">· {a.job?.company}</span>
                    </Link>
                    <AppStatusBadge status={a.status} />
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
