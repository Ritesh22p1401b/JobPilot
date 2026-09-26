"use client";

import { Suspense } from "react";

import { JobSearch } from "@/components/jobs/job-search";
import { RequireProfile } from "@/components/layout/require-profile";
import { PageSkeleton } from "@/components/ui";

export default function MatchesPage() {
  return (
    <RequireProfile title="AI Job Match">
      <Suspense fallback={<PageSkeleton />}>
        <JobSearch
          title="AI Job Match"
          description="Your strongest matches, explained. Hover a card for the reasons, or open split view to compare fit without leaving the list."
          preset={{ min_score: "60" }}
          defaultView="split"
        />
      </Suspense>
    </RequireProfile>
  );
}
