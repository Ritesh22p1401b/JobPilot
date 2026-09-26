"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { ATSScanner } from "@/components/ats/scanner";
import { RequireProfile } from "@/components/layout/require-profile";
import { PageHeader, PageSkeleton } from "@/components/ui";

function Scanner() {
  const p = useSearchParams();
  const version = p.get("version");
  const job = p.get("job");
  return <ATSScanner versionId={version} jobId={job} autoRun={!!(version || job)} />;
}

export default function ATSPage() {
  return (
    <RequireProfile title="ATS Scanner">
      <PageHeader title="ATS Scanner" description="How reliably applicant tracking systems read your resume, and how well it evidences a specific job. Tested on the real DOCX/PDF, not just the data." />
      <Suspense fallback={<PageSkeleton />}>
        <Scanner />
      </Suspense>
    </RequireProfile>
  );
}
