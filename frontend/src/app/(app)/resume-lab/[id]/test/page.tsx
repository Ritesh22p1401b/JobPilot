"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { ReportView } from "@/components/domain";
import { Alert, Button, Card, CardBody, CardHeader, Field, Loading, Meter, PageHeader, Select } from "@/components/ui";
import { api, blobUrl } from "@/lib/api";
import { useApiMutation, useTemplates } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { humanize } from "@/lib/utils";

function PdfPreview({ versionId, fallback }: { versionId: string; fallback: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current: string | null = null;
    blobUrl(`/resume/${versionId}/download?format=pdf`)
      .then((u) => {
        current = u;
        setUrl(u);
      })
      .catch(() => setFailed(true));
    return () => {
      if (current) URL.revokeObjectURL(current);
    };
  }, [versionId]);
  if (failed || !url)
    return failed ? <pre className="h-[640px] overflow-auto whitespace-pre-wrap p-4 text-xs">{fallback}</pre> : <Loading label="Rendering PDF…" />;
  return <iframe src={url} title="Resume preview" className="h-[640px] w-full rounded-b-lg" />;
}

export default function VersionTestPage() {
  const { id } = useParams<{ id: string }>();
  const version = useQuery({ queryKey: ["version", id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${id}`) });
  const jobs = useQuery({ queryKey: ["jobs", "for-test"], queryFn: () => api(S.JobList, "GET", "/jobs?page_size=50&sort=score") });
  const templates = useTemplates();
  const [jobId, setJobId] = useState<string | null>(null);
  const [profile, setProfile] = useState("generic");
  const run = useApiMutation(
    (body: { resume_version_id: string; job_id: string | null; ats_profile: string }) => api(S.Report, "POST", "/resume/test", body),
    [["version", id], ["versions"]],
  );

  if (version.isLoading) return <Loading />;
  const v = version.data;
  if (!v) return null;
  const selectedJob = jobId ?? v.job_id ?? "";
  const r = run.data;

  return (
    <>
      <Link href={`/resume-lab/${id}`} className="text-sm text-muted-foreground hover:text-foreground">
        ← Version {v.version_number}
      </Link>
      <PageHeader title="Resume test" description="Runs the full resume test suite on the generated document itself (DOCX/PDF extraction), not just the source data." />

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <Card className="min-w-0 overflow-hidden">
          <CardHeader title="Resume preview" description={`v${v.version_number} · ${v.label ?? humanize(v.version_type)} · ${humanize(v.template)}`} />
          <PdfPreview versionId={id} fallback={v.text_preview} />
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="ATS analysis" />
            <CardBody className="space-y-4">
              <Field label="Target job" hint="Needed for requirement coverage and keyword alignment.">
                <Select value={selectedJob} onChange={(e) => setJobId(e.target.value)}>
                  <option value="">No job (document quality only)</option>
                  {jobs.data?.jobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title} · {j.company}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="ATS profile">
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
              <Button className="w-full" onClick={() => run.mutate({ resume_version_id: id, job_id: selectedJob || null, ats_profile: profile })} loading={run.isPending}>
                Run tests
              </Button>
              {run.error && <Alert tone="danger">{(run.error as Error).message}</Alert>}
            </CardBody>
          </Card>

          {r && (
            <Card>
              <CardHeader title={`Quality index ${Math.round(r.quality_index)}`} description={humanize(r.assessment)} />
              <CardBody className="space-y-3">
                <Meter label="Parser" value={r.parser_compatibility} />
                <Meter label="Keywords" value={r.keyword_alignment} />
                <Meter label="Requirements" value={r.requirement_coverage} />
                <Meter label="Evidence" value={r.experience_evidence} />
                {r.issues.length > 0 && (
                  <div className="border-t pt-3">
                    <div className="mb-1 text-xs font-medium text-muted-foreground">Issues</div>
                    <ul className="list-disc space-y-0.5 pl-4 text-sm">
                      {r.issues.slice(0, 6).map((i, j) => (
                        <li key={j}>{i.message}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardBody>
            </Card>
          )}
        </div>
      </div>

      {r && (
        <div className="mt-5">
          <ReportView report={r} />
        </div>
      )}
    </>
  );
}
