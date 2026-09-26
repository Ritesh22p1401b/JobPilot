"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { CompareView } from "@/components/resume/compare";
import { PageHeader, PageSkeleton } from "@/components/ui";

function FromQuery() {
  const ids = (useSearchParams().get("ids") ?? "").split(",").filter(Boolean).slice(0, 4);
  return <CompareView ids={ids} />;
}

export default function ComparePage() {
  return (
    <>
      <PageHeader back={{ href: "/resume-lab", label: "Resume Versions" }} title="Compare versions" description="Measurable document differences only. These numbers don’t predict which version will get more interviews." />
      <Suspense fallback={<PageSkeleton />}>
        <FromQuery />
      </Suspense>
    </>
  );
}
