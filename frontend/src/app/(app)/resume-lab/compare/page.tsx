"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { CompareView } from "@/components/compare";
import { Loading, PageHeader } from "@/components/ui";

function FromQuery() {
  const ids = (useSearchParams().get("ids") ?? "").split(",").filter(Boolean).slice(0, 4);
  return <CompareView ids={ids} />;
}

export default function ComparePage() {
  return (
    <>
      <Link href="/resume-lab" className="text-sm text-muted-foreground hover:text-foreground">
        ← Resume Lab
      </Link>
      <PageHeader title="Compare versions" description="Measurable document differences only. These numbers don’t predict which version will get more interviews." />
      <Suspense fallback={<Loading />}>
        <FromQuery />
      </Suspense>
    </>
  );
}
