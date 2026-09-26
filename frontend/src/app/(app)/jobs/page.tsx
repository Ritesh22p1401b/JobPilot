"use client";

import { Suspense } from "react";

import { JobSearch } from "@/components/jobs/job-search";
import { RequireProfile } from "@/components/layout/require-profile";
import { PageSkeleton } from "@/components/ui";

export default function JobsPage() {
  return (
    <RequireProfile title="Job Search">
      <Suspense fallback={<PageSkeleton />}>
        <JobSearch title="Job Search" description="Jobs from public employer job boards and Adzuna, deduplicated and scored against your resume." />
      </Suspense>
    </RequireProfile>
  );
}
