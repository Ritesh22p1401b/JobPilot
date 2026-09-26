"use client";

import { GitCompare } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Badge, Button, Callout, Card, CardBody, CardHeader, EmptyState, ErrorState, Field, Select, Skeleton, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useApiMutation, useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtScore, humanize } from "@/lib/utils";

import { ResumeDiff } from "./diff";

const METRICS: [key: string, label: string, higherIsBetter: boolean | null][] = [
  ["quality_index", "ATS readiness", true],
  ["required_coverage", "Required requirements covered (%)", true],
  ["requirement_coverage", "Requirement coverage", true],
  ["keyword_alignment", "Keyword match", true],
  ["semantic_relevance", "Experience relevance", true],
  ["parser_fidelity", "Parser round-trip fidelity", true],
  ["achievement_strength", "Achievement strength", true],
  ["unsupported_claims", "Unsupported claims", false],
  ["words", "Word count", null],
];

/** Side-by-side comparison of 2–4 resume versions: measurable differences only, no “winner”. */
export function CompareView({ ids }: { ids: string[] }) {
  const versions = useVersions();
  const jobOptions = new Map<string, string>();
  for (const v of versions.data?.versions ?? []) if (v.job_id) jobOptions.set(v.job_id, `${v.job_title} · ${v.company}`);
  const defaultJob = versions.data?.versions.find((v) => ids.includes(v.id) && v.job_id)?.job_id ?? "";
  const [jobId, setJobId] = useState<string | null>(null);
  const effectiveJob = jobId ?? defaultJob;
  const compare = useApiMutation((body: { version_ids: string[]; job_id: string | null }) => api(S.CompareOut, "POST", "/resume/compare", body));

  if (ids.length < 2)
    return (
      <EmptyState icon={<GitCompare className="h-5 w-5" />} title="Pick at least two versions">
        Select versions in{" "}
        <Link href="/resume-lab" className="text-primary hover:underline">
          Resume Versions
        </Link>{" "}
        to compare them.
      </EmptyState>
    );

  const rows = compare.data?.rows ?? [];
  const best = (key: string, higher: boolean | null) => {
    if (higher === null) return null;
    const vals = rows.map((r) => (r as Record<string, unknown>)[key]).filter((x): x is number => typeof x === "number");
    return vals.length > 1 && new Set(vals).size > 1 ? (higher ? Math.max(...vals) : Math.min(...vals)) : null;
  };
  const name = (v: S.Version) => (v.version_type === "MASTER" ? "Base resume" : v.label ?? `v${v.version_number}`);

  return (
    <div className="space-y-5">
      <Card>
        <CardBody className="grid items-end gap-4 pt-5 md:grid-cols-[1fr_auto]">
          <Field label="Compare for job" htmlFor="cmp-job" hint="Coverage and keyword metrics need a target job.">
            <Select id="cmp-job" value={effectiveJob} onChange={(e) => setJobId(e.target.value)}>
              <option value="">No job — document quality only</option>
              {[...jobOptions].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => compare.mutate({ version_ids: ids, job_id: effectiveJob || null })} loading={compare.isPending} className="md:mb-[22px]">
            <GitCompare className="h-4 w-4" /> {compare.data ? "Re-run" : "Compare"}
          </Button>
        </CardBody>
      </Card>

      {compare.isPending && <Skeleton className="h-72" />}
      {compare.error && <ErrorState error={compare.error} onRetry={() => compare.mutate({ version_ids: ids, job_id: effectiveJob || null })} />}
      {compare.data && (
        <>
          <Card>
            <CardHeader title="Side by side" description="The better value in each row is marked. No single version is declared “best”; that depends on the job and on you." />
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  {rows.map((r) => (
                    <Th key={r.version.id}>
                      <Link href={`/resume-lab/${r.version.id}`} className="text-foreground hover:text-primary">
                        {name(r.version)}
                      </Link>
                      <div className="font-normal">v{r.version.version_number}</div>
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRICS.map(([key, label, higher]) => {
                  const b = best(key, higher);
                  return (
                    <tr key={key}>
                      <Td className="font-medium">{label}</Td>
                      {rows.map((r) => {
                        const val = (r as Record<string, unknown>)[key] as number | null | undefined;
                        const digits = key === "unsupported_claims" || key === "words" ? 0 : 1;
                        return (
                          <Td key={r.version.id} className="tabular font-mono">
                            {val !== null && val !== undefined && val === b ? (
                              <Badge tone="success" className="font-mono">
                                ▲ {fmtScore(val, digits)}
                              </Badge>
                            ) : (
                              fmtScore(val, digits)
                            )}
                          </Td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Card>
          {compare.data.summary.length > 0 && (
            <Callout tone="info" title="Summary">
              <ul className="list-disc pl-4">
                {compare.data.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Callout>
          )}
          {compare.data.diffs_vs_first.map((d, i) => {
            const a = rows[0]?.version;
            const b = rows[i + 1]?.version;
            return (
              <Card key={i}>
                <CardHeader title={`${b ? name(b) : "?"} vs ${a ? name(a) : "?"}`} description={Object.entries(d.counts).map(([k, n]) => `${n} ${humanize(k).toLowerCase()}`).join(" · ") || "No differences"} />
                <CardBody>
                  {d.unsupported_additions > 0 && (
                    <Callout tone="danger" className="mb-4">
                      {d.unsupported_additions} added statement(s) aren’t supported by your base resume.
                    </Callout>
                  )}
                  <ResumeDiff changes={d.changes} counts={d.counts} />
                </CardBody>
              </Card>
            );
          })}
          <p className="text-xs text-muted">{compare.data.note}</p>
        </>
      )}
    </div>
  );
}
