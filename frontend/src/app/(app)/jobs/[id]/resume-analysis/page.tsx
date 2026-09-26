"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { ATSScanner } from "@/components/ats/scanner";
import { PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import * as S from "@/lib/schemas";

export default function ResumeAnalysisPage() {
  const { id } = useParams<{ id: string }>();
  const job = useQuery({ queryKey: ["job", id], queryFn: () => api(S.JobDetail, "GET", `/jobs/${id}`) });
  const tailored = useQuery({ queryKey: ["versions", id], queryFn: () => api(S.VersionList, "GET", `/resume/versions?job_id=${id}`) });
  const best = tailored.data?.versions.find((v) => v.status === "APPROVED") ?? tailored.data?.versions[0];
  return (
    <>
      <PageHeader
        back={{ href: `/jobs/${id}`, label: job.data ? `${job.data.title} · ${job.data.company}` : "Job" }}
        title="Resume analysis"
        description="Job-specific ATS compatibility: parsing, formatting, requirement coverage, keywords and evidence checks for this role."
      />
      {tailored.isLoading ? null : <ATSScanner key={best?.id ?? "master"} jobId={id} versionId={best?.id ?? null} autoRun />}
    </>
  );
}
