"use client";

import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Gauge, Send, Wand2 } from "lucide-react";

import { Badge, Button, ButtonLink, ErrorState, ScoreRing, Skeleton, Tabs } from "@/components/ui";
import { api } from "@/lib/api";
import * as S from "@/lib/schemas";
import { fmtRelative, fmtSalary } from "@/lib/utils";
import { useState } from "react";

import { EvidenceMapping, HardFilters, MatchBreakdown, WhyYouMatch } from "./fit";
import { SkillChips, jobMeta } from "./job-card";
import { useJobActions } from "./use-job-actions";

/** Right-hand panel of the split view (spec §18): match analysis without leaving the list. */
export function JobPreview({ jobId }: { jobId: string }) {
  const q = useQuery({ queryKey: ["job", jobId], queryFn: () => api(S.JobDetail, "GET", `/jobs/${jobId}`) });
  const [tab, setTab] = useState<"fit" | "evidence" | "description">("fit");
  const { save, apply, busy } = useJobActions();
  if (q.isLoading)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-6 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    );
  if (q.error)
    return (
      <div className="p-6">
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </div>
    );
  const j = q.data!;
  const m = j.match;
  const salary = fmtSalary(j.salary_min, j.salary_max, j.currency);
  return (
    <div className="p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{j.title}</h2>
          <div className="text-sm text-subtle">{j.company}</div>
          <div className="mt-1 text-xs text-muted">
            {jobMeta(j).join(" · ")}
            {salary ? ` · ${salary}${j.salary_is_predicted ? " (estimate)" : ""}` : ""} · {fmtRelative(j.posted_at ?? j.first_seen_at)}
          </div>
        </div>
        {m && <ScoreRing score={m.overall_score} size={76} label="match" />}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <ButtonLink href={`/resume-lab/new?job=${j.id}`} size="sm">
          <Wand2 className="h-3.5 w-3.5" /> Tailor resume
        </ButtonLink>
        <Button size="sm" variant="secondary" onClick={() => apply(j.id)} loading={busy === `apply:${j.id}`} disabled={!!m && !m.hard_filter_passed}>
          <Send className="h-3.5 w-3.5" /> Apply
        </Button>
        <ButtonLink href={`/jobs/${j.id}/resume-analysis`} size="sm" variant="secondary">
          <Gauge className="h-3.5 w-3.5" /> ATS analysis
        </ButtonLink>
        {m && (
          <Button size="sm" variant="ghost" onClick={() => save(j.id, !m.saved)} loading={busy === `save:${j.id}`}>
            {m.saved ? "Saved" : "Save"}
          </Button>
        )}
        <ButtonLink href={`/jobs/${j.id}`} size="sm" variant="ghost">
          Full details <ExternalLink className="h-3 w-3" />
        </ButtonLink>
      </div>
      <div className="mt-4">
        <SkillChips job={j} max={8} />
      </div>
      <Tabs
        className="mt-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: "fit", label: "Match analysis" },
          { id: "evidence", label: "Evidence", count: j.requirement_matrix.length },
          { id: "description", label: "Description" },
        ]}
      />
      <div className="pt-5">
        {tab === "fit" &&
          (m ? (
            <div className="space-y-6">
              <HardFilters match={m} />
              {m.explanation && (
                <p className="text-[13px] leading-relaxed text-subtle">
                  {m.explanation_source === "llm" && <Badge tone="primary" className="mr-1.5">✦ AI</Badge>}
                  {m.explanation}
                </p>
              )}
              <WhyYouMatch match={m} compact />
              <MatchBreakdown match={m} showReasons={false} />
            </div>
          ) : (
            <p className="text-sm text-muted">Not scored yet.</p>
          ))}
        {tab === "evidence" && <EvidenceMapping items={j.requirement_matrix} />}
        {tab === "description" && <div className="text-[13px] leading-relaxed whitespace-pre-line text-subtle">{j.description}</div>}
      </div>
    </div>
  );
}
