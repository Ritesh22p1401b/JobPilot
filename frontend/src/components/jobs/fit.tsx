"use client";

import { ArrowDown, ArrowRight, Check } from "lucide-react";
import { useState } from "react";

import { Badge, Callout, Meter, Segmented, Table, Td, Th, YesNo } from "@/components/ui";
import type { Match, RequirementEvidence } from "@/lib/schemas";
import { cn, humanize } from "@/lib/utils";

import { COMPONENT_LABEL, COMPONENT_ORDER, TIER_LABEL, TIER_ORDER, strengthOf } from "./evidence";

export function MatchBreakdown({ match, showReasons = true }: { match: Match; showReasons?: boolean }) {
  const entries = COMPONENT_ORDER.filter((k) => match.breakdown[k]).map((k) => [k, match.breakdown[k]!] as const);
  return (
    <div className="space-y-3.5">
      {entries.map(([k, c]) => (
        <Meter key={k} value={c.score} label={COMPONENT_LABEL[k] ?? humanize(k)} weight={c.weight} hint={showReasons ? c.reason : undefined} />
      ))}
    </div>
  );
}

export function HardFilters({ match }: { match: Match }) {
  if (match.hard_filter_passed) return null;
  return (
    <Callout tone="danger" title="Doesn’t meet one of your hard requirements">
      <ul className="list-disc space-y-0.5 pl-4">
        {match.hard_filter_reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
    </Callout>
  );
}

/** Spec §14: strengths and potential gaps, all derived from the evidence matrix. */
export function WhyYouMatch({ match, compact }: { match: Match; compact?: boolean }) {
  const req = match.missing_skills.required ?? [];
  const pref = match.missing_skills.preferred ?? [];
  const related = match.missing_skills.related_not_matched ?? [];
  const weak = match.missing_skills.weak_evidence ?? [];
  const max = compact ? 6 : 12;
  return (
    <div className={cn("grid gap-5", !compact && "sm:grid-cols-2")}>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Why you match</div>
        {match.matched_skills.length ? (
          <ul className="space-y-1.5 text-[13px]">
            {match.matched_skills.slice(0, max).map((s) => (
              <li key={s} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden />
                <span>
                  {s}
                  {weak.includes(s) && <span className="ml-1.5 text-xs text-warning">(weak evidence)</span>}
                </span>
              </li>
            ))}
            {match.matched_skills.length > max && <li className="text-xs text-muted">+{match.matched_skills.length - max} more</li>}
          </ul>
        ) : (
          <p className="text-[13px] text-muted">No skill requirements matched with evidence.</p>
        )}
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted">Potential gaps</div>
        {req.length + pref.length + related.length === 0 ? (
          <p className="text-[13px] text-muted">No gaps against the explicit requirements.</p>
        ) : (
          <ul className="space-y-1.5 text-[13px]">
            {req.slice(0, max).map((s) => (
              <li key={`r-${s}`} className="flex items-center gap-2">
                <span className="w-3.5 text-center text-warning" aria-hidden>
                  ⚠
                </span>
                {s} <Badge tone="danger">Required</Badge>
              </li>
            ))}
            {pref.slice(0, Math.max(0, max - req.length)).map((s) => (
              <li key={`p-${s}`} className="flex items-center gap-2">
                <span className="w-3.5 text-center text-warning" aria-hidden>
                  ⚠
                </span>
                {s} <Badge tone="warning">Preferred</Badge>
              </li>
            ))}
            {related.slice(0, 3).map((s) => (
              <li key={`x-${s}`} className="flex items-start gap-2 text-subtle">
                <span className="w-3.5 shrink-0 text-center" aria-hidden>
                  ≈
                </span>
                <span>
                  {s} <span className="text-xs text-muted">· related skill, not the same</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function sortReqs(items: Partial<RequirementEvidence>[]) {
  return [...items].sort((a, b) => (TIER_ORDER[a.tier ?? ""] ?? 9) - (TIER_ORDER[b.tier ?? ""] ?? 9) || (b.importance ?? 0) - (a.importance ?? 0));
}

/** Spec §15: requirement → your evidence → evidence strength. */
export function EvidenceMapping({ items, emptyText = "No explicit requirements were identified in this job description." }: { items: Partial<RequirementEvidence>[]; emptyText?: string }) {
  const [filter, setFilter] = useState<"all" | "gaps">("all");
  const [view, setView] = useState<"map" | "table">("map");
  if (!items.length) return <p className="text-sm text-muted">{emptyText}</p>;
  const gaps = items.filter((i) => !i.matched);
  const shown = sortReqs(filter === "gaps" ? gaps : items);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Filter requirements"
          size="sm"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: `All (${items.length})` },
            { id: "gaps", label: `Not matched (${gaps.length})` },
          ]}
        />
        <Segmented
          label="View"
          size="sm"
          value={view}
          onChange={setView}
          options={[
            { id: "map", label: "Evidence map" },
            { id: "table", label: "Table" },
          ]}
        />
      </div>
      {view === "map" ? (
        <ul className="space-y-2.5">
          {shown.map((it, i) => {
            const st = strengthOf(it.status);
            const ev = it.evidence?.[0];
            return (
              <li key={`${it.category}-${it.requirement}-${i}`} className="grid gap-2 rounded-xl border border-border bg-elevated/40 p-3.5 md:grid-cols-[1fr_auto_1.3fr_auto_auto] md:items-center md:gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{it.skill ?? it.requirement}</span>
                    <Badge tone={it.tier === "REQUIRED" ? "danger" : it.tier === "PREFERRED" ? "warning" : "neutral"}>{TIER_LABEL[it.tier ?? ""] ?? humanize(it.tier)}</Badge>
                  </div>
                  {it.source_span && it.source_span !== (it.skill ?? it.requirement) && <p className="mt-1 line-clamp-2 text-xs text-muted italic">“{it.source_span}”</p>}
                </div>
                <ArrowRight className="hidden h-4 w-4 text-muted md:block" aria-hidden />
                <ArrowDown className="h-4 w-4 text-muted md:hidden" aria-hidden />
                <div className="min-w-0 text-[13px]">
                  {ev ? (
                    <>
                      <span className="text-xs text-muted">{humanize(ev.section)}: </span>
                      <span className="text-subtle">{ev.text}</span>
                      {(it.evidence?.length ?? 0) > 1 && <span className="text-xs text-muted"> (+{(it.evidence?.length ?? 1) - 1} more)</span>}
                    </>
                  ) : (
                    <span className="text-muted">{it.matched ? it.note || "Matched from your profile and preferences" : `No evidence in your resume${it.note ? ` · ${it.note}` : ""}`}</span>
                  )}
                </div>
                <ArrowRight className="hidden h-4 w-4 text-muted md:block" aria-hidden />
                <Badge tone={st.tone} className="justify-self-start">
                  <span aria-hidden>{st.symbol}</span> {st.label}
                </Badge>
              </li>
            );
          })}
        </ul>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Requirement</Th>
              <Th>Tier</Th>
              <Th>Evidence strength</Th>
              <Th>Matched</Th>
              <Th>Evidence in your resume</Th>
            </tr>
          </thead>
          <tbody>
            {shown.map((it, i) => {
              const st = strengthOf(it.status);
              return (
                <tr key={`${it.requirement}-${i}`}>
                  <Td className="min-w-40">
                    <div className="font-medium">{it.skill ?? it.requirement}</div>
                    <div className="text-xs text-muted">{humanize(it.category)}</div>
                  </Td>
                  <Td>{TIER_LABEL[it.tier ?? ""] ?? humanize(it.tier)}</Td>
                  <Td>
                    <Badge tone={st.tone}>
                      <span aria-hidden>{st.symbol}</span> {st.label}
                    </Badge>
                  </Td>
                  <Td>
                    <YesNo value={it.matched} />
                  </Td>
                  <Td className="max-w-md text-xs text-subtle">{it.evidence?.[0]?.text ?? <span className="text-muted">None found</span>}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      <p className="mt-3 text-xs text-muted">
        Evidence comes only from your resume and profile. Related skills (e.g. Docker vs Kubernetes) are shown as “Related only” and never counted as a match.
      </p>
    </div>
  );
}

/** Spec §28: how strongly the job asks for each skill vs how strongly your resume evidences it. */
export function ResumeComparison({ items }: { items: Partial<RequirementEvidence>[] }) {
  const skills = sortReqs(items.filter((i) => i.skill)).slice(0, 14);
  if (!skills.length) return <p className="text-sm text-muted">No skill requirements to compare.</p>;
  return (
    <div>
      <div className="mb-3 flex items-center gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-accent" aria-hidden /> Job importance
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-4 rounded-sm bg-primary" aria-hidden /> Resume evidence
        </span>
      </div>
      <ul className="space-y-3">
        {skills.map((it) => {
          const st = strengthOf(it.status);
          const importance = Math.round((it.importance ?? 0) * 100);
          return (
            <li key={it.skill} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-[13px] sm:grid-cols-[150px_1fr_110px]">
              <span className="truncate font-medium" title={it.skill ?? ""}>
                {it.skill}
              </span>
              <div className="space-y-1" aria-hidden>
                <div className="h-1.5 rounded-full bg-hover">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${importance}%` }} />
                </div>
                <div className="h-1.5 rounded-full bg-hover">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${st.level}%` }} />
                </div>
              </div>
              <span className="text-xs text-subtle">
                <span className="sr-only">
                  {it.skill}: importance {importance} of 100, evidence{" "}
                </span>
                {st.symbol} {st.label}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
