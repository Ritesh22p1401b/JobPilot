"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, FileSearch, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { MatchBreakdown, RequirementMatrix, SkillGaps, VersionStatusBadge } from "@/components/domain";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  LinkButton,
  Loading,
  ScoreBadge,
  Select,
  Tabs,
} from "@/components/ui";
import { api } from "@/lib/api";
import { useApiMutation, useTaskTracker, useTemplates, useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDate, fmtSalary, humanize } from "@/lib/utils";

function Chips({ label, items, tone }: { label: string; items: string[]; tone?: "danger" | "warning" | "neutral" | "info" }) {
  if (!items.length) return null;
  return (
    <div>
      <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <Badge key={s} tone={tone}>
            {s}
          </Badge>
        ))}
      </div>
    </div>
  );
}

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [tab, setTab] = useState<"match" | "requirements" | "description">("match");
  const [template, setTemplate] = useState("");
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api(S.JobDetail, "GET", `/jobs/${id}`) });
  const versions = useVersions(id);
  const templates = useTemplates();
  const tailor = useTaskTracker([["versions"], ["job", id]]);
  const prepare = useTaskTracker([["applications"], ["dashboard"]]);
  const [appId, setAppId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const explain = useApiMutation((matchId: string) => api(S.Match, "POST", `/matches/${matchId}/explain`), [["job", id]]);
  const save = useApiMutation((value: boolean) => api(S.Match, "POST", `/jobs/${id}/save?saved=${value}`), [["job", id], ["jobs"], ["applications"]]);

  if (job.isLoading) return <Loading />;
  if (job.error) return <ErrorState error={job.error} />;
  const j = job.data!;
  const m = j.match;
  const a = j.analysis;
  const salary = fmtSalary(j.salary_min, j.salary_max, j.currency);
  const tailored = versions.data?.versions ?? [];

  const startTailor = async () => {
    setActionError(null);
    try {
      const out = await api(S.TaskEnvelope, "POST", "/resume/tailor", { job_id: id, template: template || null, use_llm: true });
      tailor.start(out.task.id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };
  const startPrepare = async () => {
    setActionError(null);
    try {
      const out = await api(S.PrepareOut, "POST", `/applications/${id}/prepare`);
      setAppId(out.application_id);
      prepare.start(out.task.id);
    } catch (e) {
      setActionError((e as Error).message);
    }
  };

  return (
    <>
      <Link href="/jobs" className="text-sm text-muted-foreground hover:text-foreground">
        ← Jobs
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight">{j.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {j.company} · {j.location ?? "Location not stated"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge>{humanize(j.source)}</Badge>
            <Badge tone={j.remote ? "info" : "neutral"}>Remote: {j.remote ? "Yes" : "No"}</Badge>
            {j.work_mode && <Badge>{humanize(j.work_mode)}</Badge>}
            {j.employment_type && <Badge>{humanize(j.employment_type)}</Badge>}
            {j.seniority && <Badge>{humanize(j.seniority)}</Badge>}
            {salary && <Badge>{salary}{j.salary_is_predicted ? " (Adzuna estimate, not from employer)" : ""}</Badge>}
            <Badge>Posted {fmtDate(j.posted_at ?? j.first_seen_at)}</Badge>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {m && <ScoreBadge score={m.overall_score} className="px-3 py-1 text-base" />}
          {m && (
            <Button variant="outline" onClick={() => save.mutate(!m.saved)} loading={save.isPending}>
              {m.saved ? "Saved" : "Save"}
            </Button>
          )}
          {(j.application_url || j.url) && (
            <LinkButton href={j.application_url ?? j.url ?? "#"} target="_blank" rel="noreferrer" variant="outline">
              Open posting <ExternalLink className="h-3.5 w-3.5" />
            </LinkButton>
          )}
        </div>
      </div>

      {j.description_truncated && (
        <Alert tone="warning" className="mb-4">
          The source only provided a truncated description, so some requirements may be missing. Check the original posting.
        </Alert>
      )}
      {actionError && <Alert tone="danger" className="mb-4">{actionError}</Alert>}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "match", label: "Match" },
              { id: "requirements", label: `Requirements (${j.requirement_matrix.length})` },
              { id: "description", label: "Description" },
            ]}
          />

          {tab === "match" && (
            <>
              {!m && <Alert tone="info">This job hasn’t been scored yet. Scoring runs automatically after each search.</Alert>}
              {m && (
                <>
                  <Card>
                    <CardHeader
                      title="Why this score"
                      description={m.explanation_source === "llm" ? "Explanation written by the LLM from the computed result." : "Rule-based explanation."}
                      action={
                        <Button variant="outline" size="sm" onClick={() => explain.mutate(m.id)} loading={explain.isPending}>
                          <Sparkles className="h-3.5 w-3.5" /> Explain with AI
                        </Button>
                      }
                    />
                    <CardBody className="space-y-4">
                      {m.explanation && <p className="whitespace-pre-line text-sm">{m.explanation}</p>}
                      {explain.error && <Alert tone="warning">{(explain.error as Error).message}. The rule-based explanation above still applies.</Alert>}
                      <MatchBreakdown match={m} />
                    </CardBody>
                  </Card>
                  <Card>
                    <CardHeader title="Skills" />
                    <CardBody className="space-y-4">
                      <Chips label="Matched with evidence" items={m.matched_skills} tone="info" />
                      <SkillGaps missing={m.missing_skills} />
                    </CardBody>
                  </Card>
                </>
              )}
            </>
          )}

          {tab === "requirements" && (
            <Card>
              <CardHeader
                title="Requirement matrix"
                description="Each requirement found in the job description, with the resume evidence that supports it. Related skills are never counted as exact matches."
              />
              <CardBody>
                <RequirementMatrix items={j.requirement_matrix} />
              </CardBody>
            </Card>
          )}

          {tab === "description" && (
            <Card>
              <CardBody className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <Chips label="Required skills" items={a.required_skills} tone="danger" />
                  <Chips label="Preferred skills" items={a.preferred_skills} tone="warning" />
                  <Chips label="Nice to have" items={a.nice_to_have_skills} />
                  <div className="text-sm">
                    <div className="mb-1.5 text-xs font-medium text-muted-foreground">Details</div>
                    Experience: {a.min_years ? `${a.min_years}${a.max_years ? `–${a.max_years}` : "+"} years` : "Not stated"}
                    <br />
                    Sponsorship: {a.sponsorship === "available" ? "Available" : a.sponsorship === "not_available" ? "Not available" : "Not stated"}
                    <br />
                    Analyzer: {a.analyzer_version}
                  </div>
                </div>
                <div className="whitespace-pre-line border-t pt-4 text-sm leading-relaxed">{j.description}</div>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Resume for this job" />
            <CardBody className="space-y-3 text-sm">
              <LinkButton href={`/jobs/${id}/resume-analysis`} variant="outline" className="w-full">
                <FileSearch className="h-4 w-4" /> ATS resume analysis
              </LinkButton>
              <div className="space-y-2 border-t pt-3">
                <p className="text-xs text-muted-foreground">
                  Tailoring reorders and rephrases only what your master resume already proves. Every claim is verified; your master
                  resume is never modified.
                </p>
                <Select value={template} onChange={(e) => setTemplate(e.target.value)} aria-label="Template">
                  <option value="">Template: choose automatically</option>
                  {templates.data?.templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
                <Button className="w-full" onClick={startTailor} loading={tailor.running}>
                  <Wand2 className="h-4 w-4" /> {tailor.running ? "Tailoring…" : "Create tailored resume"}
                </Button>
                {tailor.failed && <Alert tone="danger">{tailor.task?.error}</Alert>}
              </div>
              {tailored.length > 0 && (
                <ul className="space-y-1.5 border-t pt-3">
                  {tailored.map((v) => (
                    <li key={v.id} className="flex items-center justify-between gap-2">
                      <Link href={`/resume-lab/${v.id}`} className="truncate hover:text-primary">
                        v{v.version_number} · {v.label ?? humanize(v.template)}
                      </Link>
                      <VersionStatusBadge status={v.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Apply" />
            <CardBody className="space-y-3 text-sm">
              <p className="text-xs text-muted-foreground">
                Prepares a tailored resume, cover letter and draft answers for your review. Nothing is submitted without your approval.
              </p>
              <Button className="w-full" variant="outline" onClick={startPrepare} loading={prepare.running}>
                {prepare.running ? "Preparing…" : "Prepare application"}
              </Button>
              {prepare.done && !prepare.failed && appId && (
                <Button className="w-full" onClick={() => router.push(`/applications/${appId}`)}>
                  Review application
                </Button>
              )}
              {prepare.failed && <Alert tone="danger">{prepare.task?.error}</Alert>}
            </CardBody>
          </Card>

          {Object.keys(j.destination_links).length > 0 && (
            <Card>
              <CardHeader title="Search elsewhere" description="Opens a search on the site. Nothing is scraped." />
              <CardBody className="flex flex-wrap gap-2">
                {Object.entries(j.destination_links).map(([name, url]) => (
                  <LinkButton key={name} href={url} target="_blank" rel="noreferrer" variant="outline" size="sm">
                    {humanize(name)} <ExternalLink className="h-3.5 w-3.5" />
                  </LinkButton>
                ))}
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
