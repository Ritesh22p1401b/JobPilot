"use client";

import { Check, LineChart, X } from "lucide-react";
import Link from "next/link";

import { RequireProfile } from "@/components/layout/require-profile";
import { ButtonLink, Card, CardHeader, EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useInsights } from "@/lib/hooks";

function Content() {
  const insights = useInsights();
  if (insights.isPending) return <PageSkeleton />;
  if (insights.error) return <ErrorState error={insights.error} onRetry={() => insights.refetch()} />;
  const m = insights.data!.market_skills;
  return (
    <>
      <PageHeader title="Market Insights" description={`What employers ask for across the ${m.based_on_postings} posting${m.based_on_postings === 1 ? "" : "s"} that match your targets, and whether your profile covers it.`} />
      {!m.skills.length ? (
        <EmptyState icon={<LineChart className="h-5 w-5" />} title="Not enough data yet" action={<ButtonLink href="/jobs">Search for jobs</ButtonLink>}>
          Market insights are built from the jobs JobPilot finds for you.
        </EmptyState>
      ) : (
        <Card>
          <CardHeader title="Most requested skills" description="Share of your target postings that list each skill. “In your profile” means you’ve listed or demonstrated it." />
          <ul className="px-5 pb-5">
            {m.skills.map((s) => (
              <li key={s.skill} className="grid grid-cols-[92px_minmax(0,1fr)_auto] items-center gap-3 border-b border-border py-2.5 text-[13px] last:border-0 sm:grid-cols-[180px_1fr_150px] sm:gap-4">
                <Link href={`/jobs?skill=${encodeURIComponent(s.skill)}`} className="truncate font-medium hover:text-primary">
                  {s.skill}
                </Link>
                <div className="flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-hover" aria-hidden>
                    <div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(s.share * 100)}%` }} />
                  </div>
                  <span className="tabular w-16 shrink-0 font-mono text-xs text-subtle sm:w-20">
                    {Math.round(s.share * 100)}% · {s.postings}
                  </span>
                </div>
                <span className={s.you_have ? "flex items-center gap-1 text-success" : "flex items-center gap-1 text-muted"}>
                  {s.you_have ? <Check className="h-3.5 w-3.5" aria-hidden /> : <X className="h-3.5 w-3.5" aria-hidden />}
                  <span className="sr-only sm:not-sr-only">{s.you_have ? "In your profile" : "Not in profile"}</span>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

export default function MarketPage() {
  return (
    <RequireProfile title="Market Insights">
      <Content />
    </RequireProfile>
  );
}
