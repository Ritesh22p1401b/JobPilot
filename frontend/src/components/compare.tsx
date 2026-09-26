"use client";

import Link from "next/link";
import { useState } from "react";

import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Loading, Select, Table, Td, Th } from "@/components/ui";
import { api } from "@/lib/api";
import { useApiMutation, useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtScore, humanize } from "@/lib/utils";

const METRICS: [key: string, label: string, higherIsBetter: boolean][] = [
  ["quality_index", "Quality index", true],
  ["required_coverage", "Required requirements covered (%)", true],
  ["requirement_coverage", "Requirement coverage", true],
  ["keyword_alignment", "Keyword alignment", true],
  ["semantic_relevance", "Experience relevance", true],
  ["parser_fidelity", "Parser round-trip fidelity", true],
  ["achievement_strength", "Achievement strength", true],
  ["unsupported_claims", "Unsupported claims", false],
  ["words", "Word count", true],
];

/** Side-by-side A/B comparison of 2–4 resume versions (measurable document differences only). */
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
      <Alert tone="warning">
        Select at least two versions in the <Link href="/resume-lab" className="underline">Resume Lab</Link> to compare.
      </Alert>
    );

  const rows = compare.data?.rows ?? [];
  const best = (key: string, higher: boolean) => {
    const vals = rows.map((r) => (r as Record<string, unknown>)[key]).filter((x): x is number => typeof x === "number");
    return vals.length > 1 ? (higher ? Math.max(...vals) : Math.min(...vals)) : null;
  };

  return (
    <>
      <Card className="mb-5">
        <CardBody className="grid items-end gap-4 md:grid-cols-[1fr_auto]">
          <Field label="Compare against job" hint="Job-specific metrics (coverage, keywords) need a job.">
            <Select value={effectiveJob} onChange={(e) => setJobId(e.target.value)}>
              <option value="">No job (document quality only)</option>
              {[...jobOptions].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Button onClick={() => compare.mutate({ version_ids: ids, job_id: effectiveJob || null })} loading={compare.isPending}>
            Run comparison
          </Button>
        </CardBody>
      </Card>

      {compare.isPending && <Loading label="Testing each version…" />}
      {compare.error && <Alert tone="danger">{(compare.error as Error).message}</Alert>}
      {compare.data && (
        <div className="space-y-5">
          <Card>
            <CardHeader title="Side by side" description="Best value in each row is highlighted." />
            <Table>
              <thead>
                <tr>
                  <Th>Metric</Th>
                  {rows.map((r) => (
                    <Th key={r.version.id}>
                      <Link href={`/resume-lab/${r.version.id}`} className="hover:text-primary">
                        v{r.version.version_number}
                      </Link>
                      <div className="font-normal">{r.version.label ?? humanize(r.version.version_type)}</div>
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
                        return (
                          <Td key={r.version.id} className="tabular">
                            {val !== null && val !== undefined && val === b && key !== "words" ? (
                              <Badge tone="success" className="tabular">{fmtScore(val, key === "unsupported_claims" ? 0 : 1)}</Badge>
                            ) : (
                              fmtScore(val, key === "unsupported_claims" || key === "words" ? 0 : 1)
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
            <Card>
              <CardHeader title="Summary" />
              <CardBody>
                <ul className="list-disc space-y-1 pl-5 text-sm">
                  {compare.data.summary.map((s) => (
                    <li key={s}>{s}</li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          )}
          {compare.data.diffs_vs_first.map((d, i) => (
            <Card key={i}>
              <CardHeader
                title={`v${rows[i + 1]?.version.version_number} vs v${rows[0]?.version.version_number}`}
                description={Object.entries(d.counts).map(([k, n]) => `${n} ${humanize(k).toLowerCase()}`).join(" · ") || "No differences"}
              />
              {d.unsupported_additions > 0 && (
                <CardBody>
                  <Alert tone="danger">{d.unsupported_additions} added statement(s) are not supported by your master resume.</Alert>
                </CardBody>
              )}
            </Card>
          ))}
          <p className="text-xs text-muted-foreground">{compare.data.note}</p>
        </div>
      )}
    </>
  );
}
