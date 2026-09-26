"use client";

import { Check, CircleDashed, Circle, CircleDot } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";

import { EvidenceMapping } from "@/components/jobs/fit";
import { Badge, ButtonLink, Card, CardBody, CardHeader, Chip, EmptyState, Meter, ScoreRing, Table, Tabs, Td, Th, YesNo, scoreLabel } from "@/components/ui";
import type * as S from "@/lib/schemas";
import type { Report } from "@/lib/schemas";
import { cn, fmtScore, humanize } from "@/lib/utils";

type Issue = z.infer<typeof S.Issue>;
type TestResult = z.infer<typeof S.TestResult>;

const METRICS: [keyof Report, string, string][] = [
  ["parser_compatibility", "Parser compatibility", "parser_compatibility"],
  ["requirement_coverage", "Requirement coverage", "requirement_coverage"],
  ["keyword_alignment", "Keyword match", "keyword_alignment"],
  ["experience_evidence", "Evidence strength", "experience_evidence"],
  ["experience_relevance", "Experience relevance", "experience_relevance"],
  ["formatting_compatibility", "Formatting", "formatting_compatibility"],
  ["round_trip_fidelity", "Round-trip fidelity", "round_trip_fidelity"],
];

// ------------------------------------------------------------------ issue prioritization (spec §26)
interface IssueGroup {
  type: string;
  priority: "high" | "medium" | "low";
  title: string;
  why: string;
  issues: Issue[];
  action?: { label: string; href: string; ai?: boolean };
}

const ISSUE_COPY: Record<string, { title: string; why: string }> = {
  MISSING_KEYWORD: { title: "Required skills with no evidence", why: "The job requires these and your resume shows no evidence. Only add them if you genuinely have the experience." },
  MISSING_EVIDENCE: { title: "Skills listed without supporting experience", why: "These appear only in a skills list. Parsers and recruiters look for them in real bullets." },
  UNSURFACED_REQUIREMENT: { title: "Requirements you meet that this resume doesn’t show", why: "Your base resume has evidence for these, but this version doesn’t surface it." },
  FEW_METRICS: { title: "Few measurable results", why: "Bullets without outcomes are weaker. Add numbers only where you have them." },
  WEAK_BULLET: { title: "Bullets could be stronger", why: "Action + technology + outcome reads better than a list of duties." },
  WEAK_EVIDENCE: { title: "Weak evidence", why: "Some matched requirements are only partially supported." },
  RELATED_ONLY: { title: "Related skills only", why: "You have a related skill, which is not the same as the one requested." },
  ROUND_TRIP: { title: "Parsers misread part of this resume", why: "Re-parsing the document didn’t reproduce your verified profile exactly." },
  CONTACT_EXTRACTION: { title: "Contact details not found", why: "A parser couldn’t read your name, email or phone." },
  DATE_EXTRACTION: { title: "Dates not read correctly", why: "Use a consistent format like “Jan 2023 – Present”." },
  SECTION_EXTRACTION: { title: "Sections not recognised", why: "Use standard headings (Experience, Education, Skills)." },
  EXPERIENCE_EXTRACTION: { title: "Experience entries unclear", why: "Each role should have a title, company and dates on their own lines." },
  SKILL_EXTRACTION: { title: "Skills not extracted", why: "Parsers found few recognised skills." },
  TEXT_EXTRACTION: { title: "Text couldn’t be extracted", why: "The document may be scanned or image-based." },
  KEYWORD_STUFFING: { title: "Repeated keywords", why: "Repetition without new evidence reads as keyword stuffing." },
  LENGTH: { title: "Length", why: "Keep the resume focused on relevant evidence." },
  UNSUPPORTED_SKILL: { title: "Skill not supported by your base resume", why: "Tailored versions may only claim what your base resume proves." },
  UNSUPPORTED_NUMBER: { title: "Number not supported by your base resume", why: "Metrics can’t be invented." },
  UNSUPPORTED_EMPLOYER: { title: "Employer not in your base resume", why: "Only real employers may appear." },
  UNVERIFIED_CLAIM: { title: "Unverified claim", why: "This statement couldn’t be traced to your base resume." },
};

function groupIssues(report: Report, versionId?: string | null): IssueGroup[] {
  const job = report.job_id;
  const byType = new Map<string, Issue[]>();
  for (const i of report.issues) byType.set(i.type, [...(byType.get(i.type) ?? []), i]);
  const tailor = job ? { label: "Fix with AI", href: `/resume-lab/new?job=${job}`, ai: true } : undefined;
  const actionFor = (type: string): IssueGroup["action"] => {
    if (["UNSURFACED_REQUIREMENT", "FEW_METRICS", "WEAK_BULLET"].includes(type)) return tailor ?? { label: "Edit bullets in Profile", href: "/profile" };
    if (["MISSING_KEYWORD", "MISSING_EVIDENCE", "WEAK_EVIDENCE"].includes(type)) return { label: "Review in Profile", href: "/profile" };
    if (type.startsWith("UNSUPPORTED") || type === "UNVERIFIED_CLAIM") return versionId ? { label: "Review claims", href: `/resume-lab/${versionId}` } : undefined;
    if (type.endsWith("_EXTRACTION") || type === "ROUND_TRIP") return { label: "Use an ATS-safe template", href: job ? `/resume-lab/new?job=${job}` : "/resume-lab/new" };
    return undefined;
  };
  const groups: IssueGroup[] = [];
  for (const [type, issues] of byType) {
    const worst = issues.some((i) => i.severity === "error") ? "error" : issues.some((i) => i.severity === "warning") ? "warning" : "info";
    const priority = worst === "error" || type === "MISSING_KEYWORD" ? "high" : worst === "warning" ? "medium" : "low";
    const copy = ISSUE_COPY[type] ?? { title: humanize(type), why: "" };
    groups.push({ type, priority, ...copy, issues, action: actionFor(type) });
  }
  const rank = { high: 0, medium: 1, low: 2 };
  return groups.sort((a, b) => rank[a.priority] - rank[b.priority] || b.issues.length - a.issues.length);
}

const PRIORITY = {
  high: { label: "High priority", symbol: "●", cls: "text-danger", tone: "danger" as const },
  medium: { label: "Medium", symbol: "●", cls: "text-warning", tone: "warning" as const },
  low: { label: "Low", symbol: "●", cls: "text-info", tone: "info" as const },
};

export function ATSIssues({ report, versionId }: { report: Report; versionId?: string | null }) {
  const groups = groupIssues(report, versionId);
  const passing = report.tests.filter((t) => t.status === "PASS");
  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const p = PRIORITY[g.priority];
        return (
          <div key={g.type} className="rounded-xl border border-border bg-elevated/40 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className={cn("text-[11px] font-semibold tracking-wider uppercase", p.cls)}>
                  <span aria-hidden>{p.symbol}</span> {p.label}
                </div>
                <div className="mt-1 font-medium">
                  {g.title} {g.issues.length > 1 && <span className="text-sm font-normal text-muted">· {g.issues.length}</span>}
                </div>
                {g.why && <p className="mt-0.5 text-[13px] text-subtle">{g.why}</p>}
              </div>
              {g.action && (
                <ButtonLink href={g.action.href} size="sm" variant={g.action.ai ? "ai" : "secondary"}>
                  {g.action.ai && <span aria-hidden>✦</span>} {g.action.label}
                </ButtonLink>
              )}
            </div>
            <ul className="mt-2.5 space-y-1 text-[13px] text-subtle">
              {g.issues.slice(0, 4).map((i, j) => (
                <li key={j} className="flex gap-2">
                  <span className="text-muted" aria-hidden>
                    –
                  </span>
                  {i.message}
                </li>
              ))}
              {g.issues.length > 4 && <li className="text-xs text-muted">+{g.issues.length - 4} more</li>}
            </ul>
          </div>
        );
      })}
      {passing.length > 0 && (
        <div className="rounded-xl border border-border bg-elevated/40 p-4">
          <div className="text-[11px] font-semibold tracking-wider text-success uppercase">
            <span aria-hidden>●</span> Good
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {passing.map((t) => (
              <Chip key={t.name} tone="success" icon={<Check className="h-3 w-3" aria-hidden />}>
                {humanize(t.name)}
              </Chip>
            ))}
          </div>
        </div>
      )}
      {!groups.length && !passing.length && <p className="text-sm text-muted">No issues found.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ keyword analysis (spec §27)
export function KeywordAnalysis({ keywords }: { keywords: z.infer<typeof S.KeywordResult>[] }) {
  if (!keywords.length) return <p className="text-sm text-muted">Choose a target job to analyze keywords.</p>;
  const groups = [
    { label: "Matched", icon: <Check className="h-3.5 w-3.5" aria-hidden />, tone: "success" as const, items: keywords.filter((k) => k.classification === "EXACT_MATCH") },
    { label: "Partial", icon: <CircleDot className="h-3.5 w-3.5" aria-hidden />, tone: "primary" as const, items: keywords.filter((k) => k.classification === "SEMANTIC_MATCH" || k.classification === "RELATED_TERM") },
    { label: "Missing", icon: <Circle className="h-3.5 w-3.5" aria-hidden />, tone: "warning" as const, items: keywords.filter((k) => k.classification === "MISSING" || k.classification === "CONFLICT") },
  ];
  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {groups.map((g) => (
          <div key={g.label} className="rounded-xl border border-border bg-elevated/40 p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">{g.label}</span>
              <span className="tabular font-mono text-sm">{g.items.length}</span>
            </div>
            {g.items.length ? (
              <ul className="space-y-1.5 text-[13px]">
                {g.items.map((k) => (
                  <li key={k.keyword} className="flex items-start gap-2">
                    <span className={cn("mt-0.5", g.tone === "success" ? "text-success" : g.tone === "primary" ? "text-primary" : "text-warning")}>{g.icon}</span>
                    <span className="min-w-0">
                      {k.keyword}
                      {k.related_to && <span className="text-xs text-muted"> ≈ {k.related_to}</span>}
                      {k.evidence_sections.length > 0 && <span className="block text-[11px] text-muted">in {k.evidence_sections.map(humanize).join(", ")}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted">None</p>
            )}
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted">
        Don’t add missing keywords unless you have real experience with them. Repeating keywords without evidence (keyword stuffing) is flagged.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ tests / formatting
export function TestsTable({ tests }: { tests: TestResult[] }) {
  if (!tests.length) return <EmptyState title="No tests in this view" />;
  const statusBadge = (s: string) =>
    s === "PASS" ? (
      <Badge tone="success">
        <Check className="h-3 w-3" aria-hidden /> Pass
      </Badge>
    ) : s === "WARN" ? (
      <Badge tone="warning">⚠ Warning</Badge>
    ) : s === "FAIL" ? (
      <Badge tone="danger">✕ Fail</Badge>
    ) : (
      <Badge>
        <CircleDashed className="h-3 w-3" aria-hidden /> Skipped
      </Badge>
    );
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
            <Td className="font-medium whitespace-nowrap">{humanize(t.name)}</Td>
            <Td>{statusBadge(t.status)}</Td>
            <Td className="tabular font-mono">{fmtScore(t.score)}</Td>
            <Td>
              <YesNo value={t.critical} />
            </Td>
            <Td className="max-w-md text-xs text-subtle">
              {t.issues.length ? (
                <ul className="space-y-0.5">
                  {t.issues.slice(0, 3).map((i, j) => (
                    <li key={j}>{i.message}</li>
                  ))}
                </ul>
              ) : (
                <span className="text-muted">No issues</span>
              )}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

const FORMATTING_TESTS = ["formatting_compatibility", "round_trip_parsing", "round_trip_parsing_pdf", "text_extraction", "section_extraction", "contact_extraction", "date_extraction", "length"];
const EVIDENCE_TESTS = ["evidence_integrity", "hallucination_check", "achievement_quality", "experience_relevance", "requirement_coverage", "keyword_coverage"];

// ------------------------------------------------------------------ full report
export function ATSReport({ report, versionId }: { report: Report; versionId?: string | null }) {
  type Tab = "issues" | "keywords" | "requirements" | "formatting" | "evidence" | "text";
  const [tab, setTab] = useState<Tab>("issues");
  const hasJob = !!report.job_id;
  const tabs: { id: Tab; label: string; count?: number }[] = [{ id: "issues", label: "Prioritized issues", count: report.issues.length }];
  if (hasJob) tabs.push({ id: "keywords", label: "Keywords", count: report.keywords.length }, { id: "requirements", label: "Requirements", count: report.requirement_matrix.length });
  tabs.push({ id: "formatting", label: "Formatting" }, { id: "evidence", label: "Evidence & claims" }, { id: "text", label: "Parsed text" });

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-[300px_1fr]">
        <Card className="flex flex-col items-center justify-center px-6 py-7 text-center">
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">ATS readiness</div>
          <div className="mt-3">
            <ScoreRing score={report.quality_index} size={132} stroke={9} label={scoreLabel(report.quality_index)} />
          </div>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            <Badge tone="primary">Profile: {humanize(report.ats_profile)}</Badge>
            <Badge tone={report.unsupported_claims ? "danger" : "success"}>
              {report.unsupported_claims ? `${report.unsupported_claims} unsupported claim(s)` : "No unsupported claims"}
            </Badge>
          </div>
          <p className="mt-4 text-xs text-muted">Measures how reliably parsers read this document and how well it evidences the job. It doesn’t predict interviews.</p>
        </Card>
        <Card>
          <CardHeader title="Breakdown" description="Each part is measured independently; weights depend on the ATS profile." />
          <CardBody className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {METRICS.map(([key, label, wkey]) => (
              <Meter key={String(key)} value={report[key] as number | null | undefined} label={label} weight={report.component_weights[wkey]} hint={report.score_explanations[wkey]} />
            ))}
          </CardBody>
        </Card>
      </div>

      <Card>
        <div className="px-5 pt-2">
          <Tabs value={tab} onChange={setTab} tabs={tabs} />
        </div>
        <CardBody className="pt-5">
          {tab === "issues" && <ATSIssues report={report} versionId={versionId} />}
          {tab === "keywords" && <KeywordAnalysis keywords={report.keywords} />}
          {tab === "requirements" && <EvidenceMapping items={report.requirement_matrix} />}
          {tab === "formatting" && <TestsTable tests={report.tests.filter((t) => FORMATTING_TESTS.includes(t.name))} />}
          {tab === "evidence" && <TestsTable tests={report.tests.filter((t) => EVIDENCE_TESTS.includes(t.name))} />}
          {tab === "text" && (
            <div>
              <p className="mb-2 text-xs text-muted">What a text-based parser extracts from this document.</p>
              <pre className="scrollbar-thin max-h-[480px] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs whitespace-pre-wrap text-subtle">{report.extracted_text_preview || "—"}</pre>
            </div>
          )}
        </CardBody>
      </Card>
      {report.disclaimer && <p className="text-xs text-muted">{report.disclaimer}</p>}
    </div>
  );
}
