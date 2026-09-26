"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";

import { AppStatusBadge, JobLink, NeedsResume } from "@/components/domain";
import { Card, Empty, ErrorState, LinkButton, Loading, PageHeader, ScoreBadge, Table, Td, Th } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import * as S from "@/lib/schemas";
import { cn, fmtDate, humanize } from "@/lib/utils";

export default function ApplicationsPage() {
  const apps = useQuery({ queryKey: ["applications"], queryFn: () => api(S.ApplicationList, "GET", "/applications") });
  const [status, setStatus] = useState<string>("ALL");

  if (apps.isLoading) return <Loading />;
  if (apps.error instanceof ApiError && apps.error.status === 409)
    return (
      <>
        <PageHeader title="Applications" />
        <NeedsResume />
      </>
    );
  if (apps.error) return <ErrorState error={apps.error} />;
  const all = apps.data?.applications ?? [];
  const counts = all.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.status]: (acc[a.status] ?? 0) + 1 }), {});
  const shown = status === "ALL" ? all : all.filter((a) => a.status === status);

  return (
    <>
      <PageHeader
        title="Applications"
        description="Every action is recorded in each application’s audit trail. Nothing is submitted without your approval unless you enabled authorized auto-apply."
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {["ALL", ...(apps.data?.statuses ?? [])].map((s) => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium",
              status === s ? "border-primary bg-info-soft text-primary" : "text-muted-foreground hover:bg-muted",
            )}
          >
            {s === "ALL" ? "All" : humanize(s)} <span className="tabular">({s === "ALL" ? all.length : (counts[s] ?? 0)})</span>
          </button>
        ))}
      </div>
      {shown.length === 0 ? (
        <Empty title="No applications here" action={<LinkButton href="/jobs">Browse jobs</LinkButton>}>
          Save a job or prepare an application from a job’s page.
        </Empty>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Match</Th>
                <Th>Status</Th>
                <Th>Mode</Th>
                <Th>Applied</Th>
                <Th>Updated</Th>
                <Th><span className="sr-only">Open</span></Th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <tr key={a.id}>
                  <Td className="max-w-sm">{a.job ? <JobLink id={a.job.id} title={a.job.title} company={a.job.company} /> : a.job_id}</Td>
                  <Td>
                    <ScoreBadge score={a.job?.match?.overall_score} />
                  </Td>
                  <Td>
                    <AppStatusBadge status={a.status} />
                  </Td>
                  <Td className="text-xs">{humanize(a.mode)}</Td>
                  <Td className="text-xs text-muted-foreground">{fmtDate(a.applied_at)}</Td>
                  <Td className="text-xs text-muted-foreground">{fmtDate(a.updated_at)}</Td>
                  <Td>
                    <Link href={`/applications/${a.id}`} className="text-sm text-primary">
                      Open
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
