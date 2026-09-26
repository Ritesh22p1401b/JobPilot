"use client";

import { useQuery } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button, Callout, Card, CardBody, EmptyState, ErrorState, Field, Select, Skeleton } from "@/components/ui";
import { api } from "@/lib/api";
import { useApiMutation, useTemplates, useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { humanize } from "@/lib/utils";

import { ATSReport } from "./report";

const PROFILE_HELP: Record<string, string> = {
  generic: "Balanced weights for most applicant tracking systems.",
  greenhouse_style: "Emphasizes clean parsing and round-trip fidelity.",
  workday_style: "Emphasizes structured sections, dates and requirement coverage.",
  lever_style: "Emphasizes requirement coverage and evidence strength.",
};

export function ATSScanner({ versionId, jobId, autoRun }: { versionId?: string | null; jobId?: string | null; autoRun?: boolean }) {
  const versions = useVersions();
  const templates = useTemplates();
  const jobs = useQuery({ queryKey: ["jobs", "ats-options"], queryFn: () => api(S.JobList, "GET", "/jobs?page_size=50&sort=score&include_filtered=true") });
  const [version, setVersion] = useState(versionId ?? "");
  const [job, setJob] = useState(jobId ?? "");
  const [profile, setProfile] = useState("generic");
  const run = useApiMutation(
    (body: { resume_version_id: string | null; job_id: string | null; ats_profile: string }) => api(S.Report, "POST", "/resume/analyze", body),
    [["versions"], ["version"]],
  );
  const started = useRef(false);
  const go = () => run.mutate({ resume_version_id: version || null, job_id: job || null, ats_profile: profile });
  useEffect(() => {
    if (autoRun && !started.current && versions.data) {
      started.current = true;
      go();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once when options are ready
  }, [autoRun, versions.data]);

  const jobOptions = [...(jobs.data?.jobs ?? [])];
  const list = versions.data?.versions ?? [];

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="grid items-end gap-4 pt-5 md:grid-cols-[1.1fr_1.3fr_1fr_auto]">
          <Field label="Resume" htmlFor="ats-v">
            <Select id="ats-v" value={version} onChange={(e) => setVersion(e.target.value)}>
              <option value="">Base resume (current)</option>
              {list
                .filter((v) => v.version_type !== "MASTER")
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label ?? `Tailored v${v.version_number}`}
                    {v.company ? ` · ${v.company}` : ""}
                  </option>
                ))}
            </Select>
          </Field>
          <Field label="Target job" htmlFor="ats-j" hint={job ? undefined : "Without a job, only document quality is tested."}>
            <Select id="ats-j" value={job} onChange={(e) => setJob(e.target.value)}>
              <option value="">No job — document quality only</option>
              {jobId && !jobOptions.some((j) => j.id === jobId) && <option value={jobId}>Current job</option>}
              {jobOptions.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title} · {j.company}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ATS profile" htmlFor="ats-p" hint={PROFILE_HELP[profile]}>
            <Select id="ats-p" value={profile} onChange={(e) => setProfile(e.target.value)}>
              {(templates.data?.ats_profiles ?? [{ id: "generic", description: "" }])
                .filter((p) => p.id !== "custom")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {humanize(p.id)}
                  </option>
                ))}
            </Select>
          </Field>
          <Button onClick={go} loading={run.isPending} className="md:mb-[22px]">
            <Gauge className="h-4 w-4" /> {run.data ? "Re-scan" : "Scan resume"}
          </Button>
        </CardBody>
      </Card>

      {run.isPending && (
        <div className="space-y-4" aria-busy>
          <Callout tone="primary" icon={<span aria-hidden>✦</span>} title="Analyzing your resume">
            Rendering the document, re-parsing it the way an ATS would, and checking requirements and evidence…
          </Callout>
          <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        </div>
      )}
      {run.error && <ErrorState error={run.error} onRetry={go} context="analyze this resume" />}
      {run.data && !run.isPending && <ATSReport report={run.data} versionId={version || list.find((v) => v.version_type === "MASTER")?.id} />}
      {!run.data && !run.isPending && !run.error && (
        <EmptyState icon={<Gauge className="h-5 w-5" />} title="Scan a resume" action={<Button onClick={go}>Scan resume</Button>}>
          Choose a resume and, ideally, a target job. You’ll get an ATS readiness score, prioritized issues and keyword analysis. No score guarantees an interview.
        </EmptyState>
      )}
    </div>
  );
}
