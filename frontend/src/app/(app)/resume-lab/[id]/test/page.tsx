"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";

import { ATSScanner } from "@/components/ats/scanner";
import { PageHeader, PageSkeleton } from "@/components/ui";
import { api } from "@/lib/api";
import * as S from "@/lib/schemas";

export default function VersionTestPage() {
  const { id } = useParams<{ id: string }>();
  const v = useQuery({ queryKey: ["version", id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${id}`) });
  if (v.isLoading) return <PageSkeleton />;
  const version = v.data;
  return (
    <>
      <PageHeader back={{ href: `/resume-lab/${id}`, label: version?.label ?? `Version ${version?.version_number ?? ""}` }} title="Test this resume" description="Runs the full ATS test suite on the generated document." />
      <ATSScanner versionId={version?.version_type === "MASTER" ? null : id} jobId={version?.job_id ?? version?.last_job_id ?? null} autoRun />
    </>
  );
}
