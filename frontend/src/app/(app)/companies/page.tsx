"use client";

import { Building2, Search } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RequireProfile } from "@/components/layout/require-profile";
import { Card, EmptyState, ErrorState, Input, PageHeader, PageSkeleton, ScoreBadge, Table, Td, Th } from "@/components/ui";
import { useInsights } from "@/lib/hooks";
import { humanize } from "@/lib/utils";

export default function CompaniesPage() {
  const insights = useInsights();
  const [q, setQ] = useState("");
  const list = (insights.data?.companies ?? []).filter((c) => !q || c.company.toLowerCase().includes(q.toLowerCase()));
  return (
    <RequireProfile title="Companies">
      <PageHeader title="Companies" description="Employers in your job feed, with how many of their open roles match you. Counts come from the jobs JobPilot has found so far." />
      {insights.isLoading && <PageSkeleton rows={2} />}
      {insights.error && <ErrorState error={insights.error} onRetry={() => insights.refetch()} />}
      {insights.data &&
        (insights.data.companies.length ? (
          <>
            <div className="relative mb-4 max-w-sm">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="pl-9" aria-label="Search companies" />
            </div>
            <Card className="overflow-hidden">
              <Table>
                <thead>
                  <tr>
                    <Th>Company</Th>
                    <Th>Open roles</Th>
                    <Th>Your matching roles</Th>
                    <Th>Best match</Th>
                    <Th>Saved</Th>
                    <Th>Applications</Th>
                    <Th>Sources</Th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => (
                    <tr key={c.company} className="hover:bg-hover/40">
                      <Td>
                        <Link href={`/jobs?company=${encodeURIComponent(c.company)}&include_filtered=true`} className="flex items-center gap-2.5 font-medium hover:text-primary">
                          <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-hover text-xs font-semibold text-subtle" aria-hidden>
                            {c.company.slice(0, 1).toUpperCase()}
                          </span>
                          {c.company}
                        </Link>
                      </Td>
                      <Td className="tabular font-mono">{c.open_roles}</Td>
                      <Td className="tabular font-mono">{c.matching_roles ? <span className="text-success">{c.matching_roles}</span> : <span className="text-muted">0</span>}</Td>
                      <Td>
                        <ScoreBadge score={c.best_score} />
                      </Td>
                      <Td className="tabular font-mono">{c.saved}</Td>
                      <Td className="tabular font-mono">{c.applications}</Td>
                      <Td className="text-xs text-subtle">{c.sources.map(humanize).join(", ")}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          </>
        ) : (
          <EmptyState icon={<Building2 className="h-5 w-5" />} title="No companies yet">
            Run a job search, and the employers behind your matches will appear here.
          </EmptyState>
        ))}
    </RequireProfile>
  );
}
