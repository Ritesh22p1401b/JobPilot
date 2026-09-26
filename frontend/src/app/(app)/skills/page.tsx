"use client";

import { useQuery } from "@tanstack/react-query";
import { Target } from "lucide-react";
import Link from "next/link";

import { RequireProfile } from "@/components/layout/require-profile";
import { Badge, ButtonLink, Card, CardBody, CardHeader, Chip, EmptyState, ErrorState, PageHeader, PageSkeleton, Table, Td, Th, type Tone } from "@/components/ui";
import { api } from "@/lib/api";
import { useInsights } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { humanize } from "@/lib/utils";

const DEMAND: Record<string, { tone: Tone; symbol: string }> = { High: { tone: "danger", symbol: "▲" }, Medium: { tone: "warning", symbol: "◆" }, Low: { tone: "neutral", symbol: "▽" } };

function Content() {
  const insights = useInsights();
  const profile = useQuery({ queryKey: ["profile"], queryFn: () => api(S.ProfileOut, "GET", "/profile") });
  if (insights.isPending) return <PageSkeleton />;
  if (insights.error) return <ErrorState error={insights.error} onRetry={() => insights.refetch()} />;
  const g = insights.data!.skill_gaps;
  const byCat = new Map<string, S.Profile["skills"]>();
  for (const s of profile.data?.profile.skills ?? []) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);

  return (
    <>
      <PageHeader title="Skill Gap" description={`Based on ${g.based_on_postings} analyzed posting${g.based_on_postings === 1 ? "" : "s"} that pass your filters. A gap is a requirement with no evidence in your resume.`} />
      {g.based_on_postings === 0 ? (
        <EmptyState icon={<Target className="h-5 w-5" />} title="Not enough data yet" action={<ButtonLink href="/jobs">Search for jobs</ButtonLink>}>
          Skill gaps are calculated from the jobs you target. Run a search first.
        </EmptyState>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[1fr_380px] [&>*]:min-w-0">
          <Card>
            <CardHeader title="High-demand skill gaps" description="How often each missing skill is required or preferred in your target postings. Build real experience before adding any of these to your resume." />
            {g.gaps.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Skill</Th>
                    <Th>Demand</Th>
                    <Th>Required in</Th>
                    <Th>Preferred in</Th>
                    <Th>
                      <span className="sr-only">Jobs</span>
                    </Th>
                  </tr>
                </thead>
                <tbody>
                  {g.gaps.map((x) => {
                    const d = DEMAND[x.demand] ?? DEMAND.Low!;
                    return (
                      <tr key={x.skill}>
                        <Td className="font-medium">{x.skill}</Td>
                        <Td>
                          <Badge tone={d.tone}>
                            <span aria-hidden>{d.symbol}</span> {x.demand}
                          </Badge>
                        </Td>
                        <Td className="tabular font-mono">
                          {x.required_in} <span className="text-xs text-muted">({Math.round((100 * x.required_in) / g.based_on_postings)}%)</span>
                        </Td>
                        <Td className="tabular font-mono">{x.preferred_in}</Td>
                        <Td>
                          <Link href={`/jobs?skill=${encodeURIComponent(x.skill)}`} className="text-xs text-primary hover:underline">
                            See jobs
                          </Link>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <CardBody className="text-sm text-muted">No gaps against the explicit requirements of your matches.</CardBody>
            )}
          </Card>
          <div className="space-y-5">
            <Card>
              <CardHeader title="Your strongest evidence" description="Requirements you meet most often across these postings." />
              <CardBody className="flex flex-wrap gap-1.5">
                {g.strengths.map((s) => (
                  <Chip key={s.skill} tone="success">
                    ✓ {s.skill} <span className="opacity-70">· {s.postings}</span>
                  </Chip>
                ))}
                {!g.strengths.length && <span className="text-sm text-muted">None yet.</span>}
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Your skill graph" description="Your skills grouped by area. Green ones are shown in your experience or projects." />
              <CardBody className="space-y-4">
                {[...byCat].map(([cat, skills]) => (
                  <div key={cat}>
                    <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">{humanize(cat)}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {skills.map((s) => (
                        <Chip key={s.name} tone={s.sections.some((x) => x !== "skills" && x !== "certifications") ? "success" : "neutral"}>
                          {s.name}
                        </Chip>
                      ))}
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}

export default function SkillGapPage() {
  return (
    <RequireProfile title="Skill Gap">
      <Content />
    </RequireProfile>
  );
}
