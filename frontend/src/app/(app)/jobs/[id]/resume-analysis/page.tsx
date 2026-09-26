"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { ReportView } from "@/components/domain";
import { Alert, Button, Card, CardBody, Field, Loading, PageHeader, Select } from "@/components/ui";
import { api } from "@/lib/api";
import { useApiMutation, useTemplates, useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { humanize } from "@/lib/utils";

export default function ResumeAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api(S.JobDetail, "GET", `/jobs/${id}`) });
  const versions = useVersions();
  const templates = useTemplates();
  const [versionId, setVersionId] = useState("");
  const [profile, setProfile] = useState("generic");
  const analyze = useApiMutation(
    (body: { resume_version_id: string | null; job_id: string; ats_profile: string }) => api(S.Report, "POST", "/resume/analyze", body),
    [["versions"]],
  );

  // Prefer versions tailored for this job, then the rest (master first).
  const list = [...(versions.data?.versions ?? [])].sort(
    (a, b) => Number(b.job_id === id) - Number(a.job_id === id) || Number(b.version_type === "MASTER") - Number(a.version_type === "MASTER"),
  );

  return (
    <>
      <Link href={`/jobs/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← {job.data ? `${job.data.title} · ${job.data.company}` : "Job"}
      </Link>
      <PageHeader
        title="Resume analysis"
        description="Job-specific ATS compatibility assessment: parsing, formatting, requirement coverage, keyword alignment and evidence checks."
      />
      <Card className="mb-5">
        <CardBody className="grid items-end gap-4 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Resume version">
            <Select value={versionId} onChange={(e) => setVersionId(e.target.value)}>
              <option value="">Current master resume</option>
              {list.map((v) => (
                <option key={v.id} value={v.id}>
                  v{v.version_number} · {v.label ?? humanize(v.version_type)}
                  {v.job_id === id ? " (tailored for this job)" : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="ATS profile" hint="Weights reflect common parser behaviour; they are not vendor-certified.">
            <Select value={profile} onChange={(e) => setProfile(e.target.value)}>
              {(templates.data?.ats_profiles ?? [{ id: "generic", description: "" }])
                .filter((p) => p.id !== "custom")
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {humanize(p.id)}
                  </option>
                ))}
            </Select>
          </Field>
          <Button onClick={() => analyze.mutate({ resume_version_id: versionId || null, job_id: id, ats_profile: profile })} loading={analyze.isPending}>
            Run analysis
          </Button>
        </CardBody>
      </Card>

      {analyze.isPending && <Loading label="Running resume tests…" />}
      {analyze.error && <Alert tone="danger">{(analyze.error as Error).message}</Alert>}
      {analyze.data && <ReportView report={analyze.data} />}
      {!analyze.data && !analyze.isPending && (
        <Alert tone="neutral">
          No score here guarantees passing a real ATS or predicts interviews. It measures whether your resume parses cleanly and shows
          evidence for this job’s stated requirements.
        </Alert>
      )}
    </>
  );
}
