"use client";

import { AlertTriangle, Bookmark, BookmarkCheck, Check, EyeOff, Gauge, MapPin, Send, Wand2 } from "lucide-react";
import Link from "next/link";

import { Badge, Button, ButtonLink, Chip, ScoreBadge, ScoreRing } from "@/components/ui";
import type { Job } from "@/lib/schemas";
import { cn, fmtRelative, fmtSalary, humanize } from "@/lib/utils";

import { COMPONENT_LABEL } from "./evidence";
import { useJobActions } from "./use-job-actions";

export function jobMeta(j: Job): string[] {
  return [
    j.location ?? "Location not stated",
    j.remote ? "Remote" : j.work_mode ? humanize(j.work_mode) : null,
    j.employment_type ? humanize(j.employment_type) : null,
  ].filter((x): x is string => !!x);
}

export function SkillChips({ job, max = 5 }: { job: Job; max?: number }) {
  const matched = new Set((job.match?.matched_skills ?? []).map((s) => s.toLowerCase()));
  const missingReq = new Set((job.match?.missing_skills.required ?? []).map((s) => s.toLowerCase()));
  if (!job.skills.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {job.skills.slice(0, max).map((s) => {
        const k = s.toLowerCase();
        return matched.has(k) ? (
          <Chip key={s} tone="success" icon={<Check className="h-3 w-3" aria-hidden />} title="You have evidence for this">
            {s}
          </Chip>
        ) : missingReq.has(k) ? (
          <Chip key={s} tone="warning" icon={<AlertTriangle className="h-3 w-3" aria-hidden />} title="Required, and not evidenced in your resume">
            {s}
          </Chip>
        ) : (
          <Chip key={s}>{s}</Chip>
        );
      })}
      {job.skills.length > max && <Chip>+{job.skills.length - max}</Chip>}
    </div>
  );
}

/** Compact explanation shown on hover / focus (spec §16). */
function HoverExplanation({ job }: { job: Job }) {
  const m = job.match;
  if (!m) return null;
  const comps = Object.entries(m.breakdown).sort((a, b) => b[1].score - a[1].score);
  const best = comps[0];
  const worst = comps[comps.length - 1];
  const gaps = [...(m.missing_skills.required ?? []), ...(m.missing_skills.preferred ?? [])].slice(0, 3);
  return (
    <div className="pointer-events-none absolute top-full right-0 left-0 z-20 mt-2 hidden rounded-xl border border-border bg-elevated p-3.5 text-[13px] shadow-float group-hover:block group-focus-within:block">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-primary">
        <span aria-hidden>✦</span> Why this score
      </div>
      {m.matched_skills.length > 0 && (
        <p>
          <span className="text-success">✓</span> Evidence for {m.matched_skills.slice(0, 4).join(", ")}
          {m.matched_skills.length > 4 ? ` +${m.matched_skills.length - 4}` : ""}
        </p>
      )}
      {gaps.length > 0 && (
        <p className="mt-1">
          <span className="text-warning">⚠</span> Gaps: {gaps.join(", ")}
        </p>
      )}
      {best && worst && best !== worst && (
        <p className="mt-1 text-muted">
          Strongest: {COMPONENT_LABEL[best[0]] ?? best[0]} ({Math.round(best[1].score)}) · Weakest: {COMPONENT_LABEL[worst[0]] ?? worst[0]} ({Math.round(worst[1].score)})
        </p>
      )}
    </div>
  );
}

export function JobCard({
  job,
  variant = "card",
  selected,
  onSelect,
  showActions = true,
}: {
  job: Job;
  variant?: "card" | "row" | "compact";
  selected?: boolean;
  onSelect?: () => void;
  showActions?: boolean;
}) {
  const { save, dismiss, apply, busy } = useJobActions();
  const m = job.match;
  const salary = fmtSalary(job.salary_min, job.salary_max, job.currency);
  const missingReq = m?.missing_skills.required?.length ?? 0;
  const filtered = m && !m.hard_filter_passed;
  const titleEl = onSelect ? (
    <button onClick={onSelect} className="text-left font-semibold tracking-tight hover:text-primary focus-visible:text-primary" aria-pressed={selected}>
      {job.title}
    </button>
  ) : (
    <Link href={`/jobs/${job.id}`} className="font-semibold tracking-tight hover:text-primary">
      {job.title}
    </Link>
  );

  if (variant === "compact")
    return (
      <div
        className={cn(
          "group relative cursor-pointer border-b border-border px-4 py-3.5 transition-colors last:border-0",
          selected ? "bg-hover shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-hover/60",
          filtered && "opacity-60",
        )}
        onClick={onSelect}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-[14px]">{titleEl}</div>
            <div className="truncate text-[13px] text-subtle">{job.company}</div>
            <div className="mt-0.5 truncate text-xs text-muted">{jobMeta(job).join(" · ")}</div>
          </div>
          <ScoreBadge score={m?.overall_score} suffix="%" />
        </div>
      </div>
    );

  const actions = showActions && (
    <div className="flex flex-wrap items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {m && (
        <Button variant="ghost" size="sm" className="px-2" onClick={() => save(job.id, !m.saved)} loading={busy === `save:${job.id}`} aria-pressed={m.saved}>
          {m.saved ? <BookmarkCheck className="h-3.5 w-3.5 text-primary" /> : <Bookmark className="h-3.5 w-3.5" />}
          {m.saved ? "Saved" : "Save"}
        </Button>
      )}
      <ButtonLink href={`/jobs/${job.id}/resume-analysis`} variant="ghost" size="sm" className="px-2">
        <Gauge className="h-3.5 w-3.5" /> Analyze
      </ButtonLink>
      <ButtonLink href={`/resume-lab/new?job=${job.id}`} variant="ghost" size="sm" className="px-2">
        <Wand2 className="h-3.5 w-3.5" /> Tailor
      </ButtonLink>
      <Button variant="primary" size="sm" className="ml-auto px-3" onClick={() => apply(job.id)} loading={busy === `apply:${job.id}`} disabled={!!filtered} title={filtered ? "This job fails one of your hard requirements" : "Prepare an application for your review"}>
        <Send className="h-3.5 w-3.5" /> Apply
      </Button>
      {m && !m.saved && variant === "row" && (
        <Button variant="ghost" size="icon-sm" aria-label="Not interested" title="Not interested" onClick={() => dismiss(job.id)} loading={busy === `dismiss:${job.id}`}>
          <EyeOff className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );

  const body = (
    <>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", m?.saved ? "bg-primary" : "bg-transparent")} aria-hidden />
            <h3 className="truncate text-[15px]">{titleEl}</h3>
          </div>
          <div className="mt-0.5 text-[13px] text-subtle">{job.company}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3 w-3" aria-hidden />
              {jobMeta(job).join(" · ")}
            </span>
            {salary && (
              <span className="text-subtle">
                {salary}
                {job.salary_is_predicted && <span className="text-muted"> (estimate)</span>}
              </span>
            )}
            <span>{fmtRelative(job.posted_at ?? job.first_seen_at)}</span>
          </div>
        </div>
        {m ? <ScoreRing score={m.overall_score} size={variant === "row" ? 52 : 58} stroke={5} label="match" /> : <Badge>Not scored</Badge>}
      </div>
      <div className="mt-3.5">
        <SkillChips job={job} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        {m && (
          <span className="text-subtle">
            Required gaps: <span className={cn("font-medium", missingReq ? "text-warning" : "text-success")}>{missingReq ? `${missingReq}` : "None"}</span>
          </span>
        )}
        {filtered && (
          <Badge tone="danger" title={m.hard_filter_reasons.join("\n")}>
            Filtered: {m.hard_filter_reasons[0]}
          </Badge>
        )}
        {job.alternate_sources.length > 0 && <span className="text-muted">Also on {job.alternate_sources.length} other source(s)</span>}
        <span className="text-muted">via {humanize(job.source)}</span>
      </div>
    </>
  );

  return (
    <article
      className={cn(
        "group relative min-w-0 rounded-xl border bg-surface p-4 transition-[border-color,background,transform]",
        selected ? "border-primary" : "border-border hover:border-border-strong hover:bg-elevated",
        variant === "card" && "flex flex-col",
        filtered && "opacity-70",
      )}
    >
      {variant === "row" ? (
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">{body}</div>
          {actions}
        </div>
      ) : (
        <>
          <div className="flex-1">{body}</div>
          {actions && <div className="mt-3.5 border-t border-border pt-3">{actions}</div>}
        </>
      )}
      <HoverExplanation job={job} />
    </article>
  );
}
