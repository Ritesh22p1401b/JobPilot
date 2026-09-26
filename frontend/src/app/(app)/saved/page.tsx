"use client";

import { Suspense } from "react";

import { JobSearch } from "@/components/jobs/job-search";
import { RequireProfile } from "@/components/layout/require-profile";
import { PageSkeleton } from "@/components/ui";

export default function SavedJobsPage() {
  return (
    <RequireProfile title="Saved Jobs">
      <Suspense fallback={<PageSkeleton />}>
        <JobSearch title="Saved Jobs" description="Jobs you’ve saved. Each one is also tracked in your Application Tracker." preset={{ saved: "true", include_filtered: "true" }} hideSearchActions />
      </Suspense>
    </RequireProfile>
  );
}
