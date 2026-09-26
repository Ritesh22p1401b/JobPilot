"use client";

import { BarChart3, Info } from "lucide-react";

import { statusOf } from "@/components/applications/model";
import { RequireProfile } from "@/components/layout/require-profile";
import { ButtonLink, Callout, Card, CardBody, CardHeader, EmptyState, ErrorState, KPI, PageHeader, PageSkeleton, Table, Td, Th } from "@/components/ui";
import { useApplications, useInsights } from "@/lib/hooks";

function pct(v: number | null | undefined) {
  return v === null || v === undefined ? "—" : `${v.toFixed(0)}%`;
}

/** Applications created per week for the last 8 weeks (from your own data). */
function weekly(dates: string[]) {
  const weeks = Array.from({ length: 8 }, (_, i) => {
    const end = new Date();
    end.setHours(23, 59, 59, 999);
    end.setDate(end.getDate() - 7 * (7 - i));
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end, n: 0 };
  });
  for (const d of dates) {
    const t = new Date(d).getTime();
    const w = weeks.find((x) => t >= x.start.getTime() && t <= x.end.getTime());
    if (w) w.n += 1;
  }
  return weeks;
}

function Content() {
  const insights = useInsights();
  const apps = useApplications();
  if (insights.isPending) return <PageSkeleton />;
  if (insights.error) return <ErrorState error={insights.error} onRetry={() => insights.refetch()} />;
  const d = insights.data!;
  const f = d.funnel;
  const stages = [
    { label: "Saved or prepared", n: f.saved },
    { label: "Applied", n: f.applied },
    { label: "Responses", n: f.responses },
    { label: "Interviews", n: f.interviews },
    { label: "Offers", n: f.offers },
  ];
  const max = Math.max(1, ...stages.map((s) => s.n));
  const byStatus = new Map<string, number>();
  for (const a of apps.data?.applications ?? []) byStatus.set(a.status, (byStatus.get(a.status) ?? 0) + 1);
  const weeks = weekly((apps.data?.applications ?? []).map((a) => a.created_at ?? "").filter(Boolean));
  const wmax = Math.max(1, ...weeks.map((w) => w.n));

  return (
    <>
      <PageHeader title="Analytics" description="How your search is going, computed from your own applications. Small numbers swing a lot, so treat rates as signals, not verdicts." />
      {f.saved === 0 ? (
        <EmptyState icon={<BarChart3 className="h-5 w-5" />} title="No data yet" action={<ButtonLink href="/matches">Find jobs to apply to</ButtonLink>}>
          Analytics appear once you start saving and applying to jobs.
        </EmptyState>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KPI label="Applications" value={f.applied} />
            <KPI label="Response rate" value={pct(f.response_rate)} sub={`${f.responses} of ${f.applied} responded`} />
            <KPI label="Interview rate" value={pct(f.interview_rate)} sub={`${f.interviews} interview${f.interviews === 1 ? "" : "s"}`} />
            <KPI label="Offers" value={f.offers} />
          </div>

          <div className="grid gap-5 xl:grid-cols-2">
            <Card>
              <CardHeader title="Application funnel" description="A response is any reply: an assessment, interview, offer or rejection." />
              <CardBody className="space-y-3">
                {stages.map((s, i) => (
                  <div key={s.label}>
                    <div className="flex items-baseline justify-between text-[13px]">
                      <span className="text-subtle">{s.label}</span>
                      <span className="tabular font-mono font-medium">
                        {s.n}
                        {i > 1 && stages[1]!.n > 0 && <span className="ml-2 text-xs text-muted">{Math.round((100 * s.n) / stages[1]!.n)}% of applied</span>}
                      </span>
                    </div>
                    <div className="mt-1.5 h-7 overflow-hidden rounded-md bg-hover" aria-hidden>
                      <div className="h-full rounded-md bg-gradient-to-r from-primary to-accent transition-[width] duration-700" style={{ width: `${(100 * s.n) / max}%`, opacity: 1 - i * 0.12 }} />
                    </div>
                  </div>
                ))}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Activity" description="Applications started per week, last 8 weeks." />
              <CardBody>
                <div className="flex h-44 items-end gap-2" role="img" aria-label={`Applications per week: ${weeks.map((w) => w.n).join(", ")}`}>
                  {weeks.map((w, i) => (
                    <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                      <span className="tabular font-mono text-[11px] text-subtle">{w.n || ""}</span>
                      <div className="flex w-full flex-1 items-end"><div className="w-full rounded-t-md bg-primary/80" style={{ height: `${(100 * w.n) / wmax}%`, minHeight: w.n ? 4 : 1 }} /></div>
                      <span className="text-[10px] text-muted">{w.start.toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-4 text-xs">
                  {[...byStatus].map(([s, n]) => (
                    <span key={s} className="text-subtle">
                      {statusOf(s).symbol} {statusOf(s).label}: <span className="tabular font-mono text-foreground">{n}</span>
                    </span>
                  ))}
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Resume performance" description="Outcomes by the resume version you applied with. Versions aren’t ranked; compare them yourself, keeping sample sizes in mind." />
            {d.resume_performance.length ? (
              <Table>
                <thead>
                  <tr>
                    <Th>Resume version</Th>
                    <Th>Applications</Th>
                    <Th>Responses</Th>
                    <Th>Interviews</Th>
                    <Th>Response rate</Th>
                    <Th>Interview rate</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.resume_performance.map((r) => (
                    <tr key={r.resume_version_id}>
                      <Td className="font-medium">
                        <a href={`/resume-lab/${r.resume_version_id}`} className="hover:text-primary">
                          {r.label}
                        </a>
                      </Td>
                      <Td className="tabular font-mono">{r.applications}</Td>
                      <Td className="tabular font-mono">{r.responses}</Td>
                      <Td className="tabular font-mono">{r.interviews}</Td>
                      <Td className="tabular font-mono">{pct(r.response_rate)}</Td>
                      <Td className="tabular font-mono">{pct(r.interview_rate)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : (
              <CardBody className="text-sm text-muted">Appears once you’ve applied with at least one resume version.</CardBody>
            )}
          </Card>
          {f.applied > 0 && f.applied < 10 && (
            <Callout tone="info" icon={<Info className="h-4 w-4" />}>
              With fewer than 10 applications, rates can change a lot from a single reply.
            </Callout>
          )}
        </div>
      )}
    </>
  );
}

export default function AnalyticsPage() {
  return (
    <RequireProfile title="Analytics">
      <Content />
    </RequireProfile>
  );
}
