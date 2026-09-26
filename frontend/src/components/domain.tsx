"use client";

import Link from "next/link";
import { useState } from "react";
import type { z } from "zod";

import { Alert, Badge, Card, CardBody, CardHeader, Empty, LinkButton, Meter, Table, Td, Th, YesNo, type Tone } from "@/components/ui";
import type { Match, Report, RequirementEvidence } from "@/lib/schemas";
import type * as S from "@/lib/schemas";
import { cn, fmtScore, humanize } from "@/lib/utils";

// ------------------------------------------------------------------ status badges
const EVIDENCE_TONE: Record<string, Tone> = {
  SUPPORTED: "success",
  PARTIALLY_SUPPORTED: "warning",
  SEMANTIC_MATCH: "info",
  RELATED_BUT_NOT_MATCH: "warning",
  MISSING: "danger",
  UNKNOWN: "neutral",
  CONFLICT: "danger",
};
const EVIDENCE_LABEL: Record<string, string> = {
  SUPPORTED: "Supported",
  PARTIALLY_SUPPORTED: "Partially supported",
  SEMANTIC_MATCH: "Semantic match",
  RELATED_BUT_NOT_MATCH: "Related, not a match",
  MISSING: "Missing",
  UNKNOWN: "Unknown",
  CONFLICT: "Conflict",
};

export function EvidenceBadge({ status }: { status: string }) {
  return <Badge tone={EVIDENCE_TONE[status] ?? "neutral"}>{EVIDENCE_LABEL[status] ?? humanize(status)}</Badge>;
}

const APP_TONE: Record<string, Tone> = {
  SAVED: "neutral",
  READY: "info",
  APPROVAL_REQUIRED: "warning",
  APPLIED: "info",
  ASSESSMENT: "info",
  INTERVIEW: "success",
  OFFER: "success",
  REJECTED: "danger",
  WITHDRAWN: "neutral",
};
export function AppStatusBadge({ status }: { status: string }) {
  return <Badge tone={APP_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

const VERSION_TONE: Record<string, Tone> = { APPROVED: "success", DRAFT: "neutral", NEEDS_REVIEW: "warning", REJECTED: "danger" };
export function VersionStatusBadge({ status }: { status: string }) {
  return <Badge tone={VERSION_TONE[status] ?? "neutral"}>{humanize(status)}</Badge>;
}

const TEST_TONE: Record<string, Tone> = { PASS: "success", WARN: "warning", FAIL: "danger", SKIP: "neutral" };
export function TestStatusBadge({ status }: { status: string }) {
  return <Badge tone={TEST_TONE[status] ?? "neutral"}>{status === "PASS" ? "Pass" : status === "WARN" ? "Warning" : humanize(status)}</Badge>;
}

const TIER_ORDER: Record<string, number> = { REQUIRED: 0, PREFERRED: 1, NICE_TO_HAVE: 2, UNSPECIFIED: 3 };

// ------------------------------------------------------------------ requirement matrix
export function RequirementMatrix({
  items,
  emptyText = "No explicit requirements were identified in this job description.",
}: {
  items: Partial<RequirementEvidence>[];
  emptyText?: string;
}) {
  const [filter, setFilter] = useState<"all" | "gaps">("all");
  const sorted = [...items].sort(
    (a, b) => (TIER_ORDER[a.tier ?? ""] ?? 9) - (TIER_ORDER[b.tier ?? ""] ?? 9) || (b.importance ?? 0) - (a.importance ?? 0),
  );
  const shown = filter === "gaps" ? sorted.filter((i) => !i.matched) : sorted;
  if (!items.length) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  const gaps = items.filter((i) => !i.matched).length;
  return (
    <div>
      <div className="mb-3 flex items-center gap-2 text-sm">
        <button className={cn("rounded-md px-2.5 py-1", filter === "all" ? "bg-muted font-medium" : "text-muted-foreground")} onClick={() => setFilter("all")}>
          All ({items.length})
        </button>
        <button className={cn("rounded-md px-2.5 py-1", filter === "gaps" ? "bg-muted font-medium" : "text-muted-foreground")} onClick={() => setFilter("gaps")}>
          Not matched ({gaps})
        </button>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Requirement</Th>
            <Th>Tier</Th>
            <Th>Status</Th>
            <Th>Matched</Th>
            <Th>Evidence in resume</Th>
          </tr>
        </thead>
        <tbody>
          {shown.map((it, i) => (
            <tr key={`${it.category}-${it.requirement}-${i}`}>
              <Td className="min-w-40">
                <div className="font-medium">{it.skill ?? it.requirement}</div>
                <div className="text-xs text-muted-foreground">{humanize(it.category)}</div>
                {it.source_span && it.source_span !== (it.skill ?? it.requirement) && (
                  <div className="mt-1 line-clamp-2 text-xs italic text-muted-foreground" title="Text from the job description">
                    “{it.source_span}”
                  </div>
                )}
              </Td>
              <Td>
                <Badge tone={it.tier === "REQUIRED" ? "danger" : it.tier === "PREFERRED" ? "warning" : "neutral"}>{humanize(it.tier)}</Badge>
              </Td>
              <Td>{it.status && <EvidenceBadge status={it.status} />}</Td>
              <Td>
                <YesNo value={it.matched} />
              </Td>
              <Td className="min-w-56 max-w-md">
                {it.evidence && it.evidence.length > 0 ? (
                  <ul className="space-y-1">
                    {it.evidence.slice(0, 2).map((e, j) => (
                      <li key={j} className="text-xs">
                        <span className="font-medium">{humanize(e.section)}:</span> <span className="text-muted-foreground">{e.text}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-xs text-muted-foreground">No evidence found</span>
                )}
                {it.note && <div className="mt-1 text-xs text-muted-foreground">{it.note}</div>}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}

// ------------------------------------------------------------------ match breakdown
const COMPONENT_LABEL: Record<string, string> = {
  skill: "Skills",
  role: "Role fit",
  experience: "Experience",
  location: "Location",
  education: "Education",
  preference: "Preferences",
  seniority: "Seniority",
};

export function MatchBreakdown({ match }: { match: Match }) {
  const entries = Object.entries(match.breakdown);
  return (
    <div className="space-y-4">
      {!match.hard_filter_passed && (
        <Alert tone="danger" title="Filtered out by your hard requirements">
          <ul className="list-disc pl-4">
            {match.hard_filter_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {entries.map(([k, c]) => (
          <div key={k}>
            <Meter value={c.score} label={`${COMPONENT_LABEL[k] ?? humanize(k)} · weight ${Math.round(c.weight * 100)}%`} />
            <p className="mt-1 text-xs text-muted-foreground">{c.reason}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Overall = weighted sum of the components above ({fmtScore(match.overall_score, 1)}). Scores are computed deterministically from
        your resume and the job description; they estimate fit, and do not predict interviews.
      </p>
    </div>
  );
}

export function SkillGaps({ missing }: { missing: Record<string, string[]> }) {
  const groups: [string, string, Tone][] = [
    ["required", "Missing required", "danger"],
    ["preferred", "Missing preferred", "warning"],
    ["nice_to_have", "Missing nice-to-have", "neutral"],
    ["related_not_matched", "Related, not a match", "warning"],
    ["weak_evidence", "Weak evidence", "warning"],
  ];
  const any = groups.some(([k]) => (missing[k] ?? []).length > 0);
  if (!any) return <p className="text-sm text-muted-foreground">No skill gaps against explicit requirements.</p>;
  return (
    <div className="space-y-3">
      {groups.map(([k, label, tone]) =>
        (missing[k] ?? []).length ? (
          <div key={k}>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</div>
            <div className="flex flex-wrap gap-1.5">
              {(missing[k] ?? []).map((s) => (
                <Badge key={s} tone={tone}>
                  {s}
                </Badge>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

// ------------------------------------------------------------------ ATS report
const ASSESSMENT_TONE: Record<string, Tone> = { STRONG: "success", GOOD: "info", FAIR: "warning", WEAK: "danger", NEEDS_REVIEW: "warning" };
const KEYWORD_TONE: Record<string, Tone> = { EXACT_MATCH: "success", SEMANTIC_MATCH: "info", RELATED_TERM: "warning", MISSING: "danger", CONFLICT: "danger" };

type ReportTab = "tests" | "requirements" | "keywords" | "evidence" | "formatting" | "text";
const EVIDENCE_TESTS = ["evidence_integrity", "hallucination_check", "achievement_quality", "experience_relevance"];
const FORMATTING_TESTS = ["formatting_compatibility", "round_trip_parsing", "round_trip_parsing_pdf", "text_extraction", "section_extraction", "contact_extraction", "length"];

export function ReportView({ report }: { report: Report }) {
  const [tab, setTab] = useState<ReportTab>("tests");
  const metrics: [string, number | null | undefined, string][] = [
    ["Parser compatibility", report.parser_compatibility, "parser_compatibility"],
    ["Round-trip fidelity", report.round_trip_fidelity, "round_trip_fidelity"],
    ["Formatting", report.formatting_compatibility, "formatting_compatibility"],
    ["Requirement coverage", report.requirement_coverage, "requirement_coverage"],
    ["Keyword alignment", report.keyword_alignment, "keyword_alignment"],
    ["Experience evidence", report.experience_evidence, "experience_evidence"],
    ["Experience relevance", report.experience_relevance, "experience_relevance"],
  ];
  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="grid gap-6 md:grid-cols-[200px_1fr]">
          <div>
            <div className="text-xs font-medium text-muted-foreground">Resume Quality Index</div>
            <div className="tabular mt-1 text-4xl font-semibold">{Math.round(report.quality_index)}</div>
            <Badge tone={ASSESSMENT_TONE[report.assessment] ?? "neutral"} className="mt-2">
              {humanize(report.assessment)}
            </Badge>
            <div className="mt-3 text-xs text-muted-foreground">
              Profile: {humanize(report.ats_profile)}
              <br />
              Unsupported claims: <span className={cn("font-medium", report.unsupported_claims > 0 && "text-danger")}>{report.unsupported_claims}</span>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {metrics.map(([label, v, key]) => (
              <div key={key}>
                <Meter value={v} label={label} hint={report.score_explanations[key]} />
                {report.component_weights[key] !== undefined && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">Weight {Math.round((report.component_weights[key] ?? 0) * 100)}%</div>
                )}
              </div>
            ))}
          </div>
        </CardBody>
      </Card>

      {report.critical_failures.length > 0 && (
        <Alert tone="danger" title="Critical issues">
          <ul className="list-disc pl-4">
            {report.critical_failures.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </Alert>
      )}

      {report.recommendations.length > 0 && (
        <Card>
          <CardHeader title="Recommendations" description="Truthful fixes only. Never add a skill or claim you can’t back up." />
          <CardBody>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {report.recommendations.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}

      <Card>
        <div className="px-5 pt-3">
          <ReportTabs value={tab} onChange={setTab} hasJob={!!report.job_id} />
        </div>
        <CardBody>
          {tab === "tests" && <TestTable tests={report.tests} />}
          {tab === "requirements" && <RequirementMatrix items={report.requirement_matrix} />}
          {tab === "keywords" && <KeywordTable keywords={report.keywords} />}
          {tab === "evidence" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">
                Whether each claim and achievement is backed by your master resume, and how specific it is.
              </p>
              <TestTable tests={report.tests.filter((t) => EVIDENCE_TESTS.includes(t.name))} />
            </div>
          )}
          {tab === "formatting" && (
            <div className="space-y-4">
              <p className="text-xs text-muted-foreground">Layout risks for text-based parsers: columns, tables, icons, headers/footers, length.</p>
              <TestTable tests={report.tests.filter((t) => FORMATTING_TESTS.includes(t.name))} />
              {report.issues.length > 0 && (
                <ul className="space-y-1 text-sm">
                  {report.issues.map((i, j) => (
                    <li key={j}>
                      <Badge tone={i.severity === "error" ? "danger" : i.severity === "warning" ? "warning" : "neutral"}>{humanize(i.severity)}</Badge>{" "}
                      {i.message}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {tab === "text" && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">What a text-based parser extracts from the document.</p>
              <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{report.extracted_text_preview || "—"}</pre>
            </div>
          )}
        </CardBody>
      </Card>

      {report.disclaimer && <p className="text-xs text-muted-foreground">{report.disclaimer}</p>}
    </div>
  );
}

function ReportTabs({ value, onChange, hasJob }: { value: ReportTab; onChange: (v: ReportTab) => void; hasJob: boolean }) {
  const tabs: { id: ReportTab; label: string }[] = [{ id: "tests", label: "Tests" }];
  if (hasJob) tabs.push({ id: "requirements", label: "Requirements" }, { id: "keywords", label: "Keywords" });
  tabs.push({ id: "evidence", label: "Evidence" }, { id: "formatting", label: "Formatting" }, { id: "text", label: "Parsed text" });
  return (
    <div className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={cn("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", value === t.id ? "border-primary" : "border-transparent text-muted-foreground")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function TestTable({ tests }: { tests: z.infer<typeof S.TestResult>[] }) {
  if (!tests.length) return <Empty title="No test results yet" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Test</Th>
          <Th>Result</Th>
          <Th>Score</Th>
          <Th>Critical</Th>
          <Th>Findings</Th>
        </tr>
      </thead>
      <tbody>
        {tests.map((t) => (
          <tr key={t.name}>
            <Td className="font-medium">{humanize(t.name)}</Td>
            <Td>
              <TestStatusBadge status={t.status} />
            </Td>
            <Td className="tabular">{fmtScore(t.score)}</Td>
            <Td>
              <YesNo value={t.critical} />
            </Td>
            <Td className="max-w-md text-xs text-muted-foreground">
              {t.issues.length ? (
                <ul className="space-y-0.5">
                  {t.issues.slice(0, 4).map((i, j) => (
                    <li key={j}>
                      <span className={cn(i.severity === "error" && "text-danger", i.severity === "warning" && "text-warning")}>●</span> {i.message}
                    </li>
                  ))}
                </ul>
              ) : (
                "No issues"
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function KeywordTable({ keywords }: { keywords: z.infer<typeof S.KeywordResult>[] }) {
  if (!keywords.length) return <p className="text-sm text-muted-foreground">No keywords extracted.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>Keyword</Th>
          <Th>Classification</Th>
          <Th>In resume</Th>
          <Th>Where</Th>
          <Th>Importance</Th>
        </tr>
      </thead>
      <tbody>
        {keywords.map((k) => (
          <tr key={k.keyword}>
            <Td className="font-medium">
              {k.keyword}
              {k.related_to && <div className="text-xs font-normal text-muted-foreground">related: {k.related_to}</div>}
            </Td>
            <Td>
              <Badge tone={KEYWORD_TONE[k.classification] ?? "neutral"}>{humanize(k.classification)}</Badge>
            </Td>
            <Td>
              <YesNo value={k.resume_present} />
            </Td>
            <Td className="text-xs text-muted-foreground">{k.evidence_sections.map(humanize).join(", ") || "—"}</Td>
            <Td className="tabular">{k.importance.toFixed(2)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ------------------------------------------------------------------ misc
export function NeedsResume() {
  return (
    <Empty title="Upload your resume to get started" action={<LinkButton href="/resume">Upload resume</LinkButton>}>
      JobPilot builds your profile from your resume, then finds and scores jobs against it.
    </Empty>
  );
}

export function JobLink({ id, title, company }: { id: string; title: string; company: string }) {
  return (
    <Link href={`/jobs/${id}`} className="group block min-w-0">
      <div className="truncate font-medium group-hover:text-primary">{title}</div>
      <div className="truncate text-xs text-muted-foreground">{company}</div>
    </Link>
  );
}
