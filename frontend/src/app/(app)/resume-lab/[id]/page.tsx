"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Download, X } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { TestTable, VersionStatusBadge } from "@/components/domain";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  ErrorState,
  Field,
  LinkButton,
  Loading,
  Meter,
  Table,
  Tabs,
  Td,
  Textarea,
  Th,
  YesNo,
  type Tone,
} from "@/components/ui";
import { ApiError, api, download } from "@/lib/api";
import { useApiMutation } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDateTime, humanize } from "@/lib/utils";

const CHANGE_TONE: Record<string, Tone> = { ADDED: "success", REMOVED: "danger", REWRITTEN: "info", REORDERED: "neutral" };

type Tab = "content" | "changes" | "claims" | "tests";

export default function VersionPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>("content");
  const [notes, setNotes] = useState("");
  const version = useQuery({ queryKey: ["version", id], queryFn: () => api(S.VersionDetail, "GET", `/resume/${id}`) });
  const v = version.data;
  const diff = useQuery({
    queryKey: ["version", id, "diff"],
    queryFn: () => api(S.DiffOut, "GET", `/resume/${id}/diff`),
    enabled: !!v?.parent_version_id,
    retry: false,
  });
  const tests = useQuery({ queryKey: ["version", id, "tests"], queryFn: () => api(S.TestResults, "GET", `/resume/${id}/test-results`) });
  const review = useApiMutation(
    ({ action }: { action: "approve" | "reject" }) => api(S.Version, "POST", `/resume/${id}/${action}`, { notes: notes || null }),
    [["version", id], ["versions"], ["dashboard"]],
  );

  if (version.isLoading) return <Loading />;
  if (version.error) return <ErrorState error={version.error} />;
  if (!v) return null;

  const unverified = v.claims.filter((c) => !c.verified);
  const isMaster = v.version_type === "MASTER";
  const canReview = !isMaster && v.status !== "APPROVED";

  return (
    <>
      <Link href="/resume-lab" className="text-sm text-muted-foreground hover:text-foreground">
        ← Resume Lab
      </Link>
      <div className="mt-3 mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            Version {v.version_number} <span className="font-normal text-muted-foreground">· {v.label ?? humanize(v.version_type)}</span>
          </h1>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge tone={isMaster ? "info" : "neutral"}>{humanize(v.version_type)}</Badge>
            <VersionStatusBadge status={v.status} />
            <Badge>Template: {humanize(v.template)}</Badge>
            <Badge>{fmtDateTime(v.created_at)}</Badge>
            {v.job_id && (
              <Link href={`/jobs/${v.job_id}`}>
                <Badge tone="info">View job →</Badge>
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LinkButton href={`/resume-lab/${id}/test`} size="sm">Run tests</LinkButton>
          <LinkButton href={`/resume-lab/${id}/compare`} variant="outline" size="sm">Compare</LinkButton>
          {(["docx", "pdf", "txt"] as const).map((f) => (
            <Button key={f} variant="outline" size="sm" onClick={() => download(`/resume/${id}/download?format=${f}`, `resume.${f}`)}>
              <Download className="h-3.5 w-3.5" /> {f.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {unverified.length > 0 && (
        <Alert tone="danger" className="mb-5" title={`${unverified.length} claim(s) could not be verified against your master resume`}>
          They must be removed before this version can be approved. See the Claims tab.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="min-w-0 space-y-5">
          <Tabs<Tab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: "content", label: "Content" },
              { id: "changes", label: "Changes" },
              { id: "claims", label: `Claims (${v.claims.length})` },
              { id: "tests", label: "Tests" },
            ]}
          />

          {tab === "content" && (
            <Card>
              <CardBody>
                <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{v.text_preview || "—"}</pre>
              </CardBody>
            </Card>
          )}

          {tab === "changes" && (
            <>
              {!v.parent_version_id && <Empty title="No parent version">This version has nothing to compare against.</Empty>}
              {diff.isLoading && v.parent_version_id && <Loading />}
              {diff.error && <ErrorState error={diff.error} />}
              {diff.data && (
                <>
                  <Card>
                    <CardHeader
                      title={`Changes from v${diff.data.from.version_number}`}
                      description={Object.entries(diff.data.diff.counts)
                        .map(([k, n]) => `${n} ${humanize(k).toLowerCase()}`)
                        .join(" · ")}
                    />
                    <Table>
                      <thead>
                        <tr>
                          <Th>Change</Th>
                          <Th>Section</Th>
                          <Th>Before</Th>
                          <Th>After</Th>
                          <Th>Verified</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {diff.data.diff.changes.map((c, i) => (
                          <tr key={i}>
                            <Td>
                              <Badge tone={CHANGE_TONE[c.type] ?? "neutral"}>{humanize(c.type)}</Badge>
                            </Td>
                            <Td className="text-xs">{humanize(c.section)}</Td>
                            <Td className="max-w-xs text-xs text-muted-foreground">{c.original ?? "—"}</Td>
                            <Td className="max-w-xs text-xs">
                              {c.new ?? "—"}
                              {c.detail && <div className="mt-1 text-muted-foreground">{c.detail}</div>}
                            </Td>
                            <Td>{c.type === "REMOVED" || c.type === "REORDERED" ? <span className="text-xs text-muted-foreground">n/a</span> : <YesNo value={c.verified} />}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  </Card>
                  <Card>
                    <CardHeader title="Regression check" />
                    <CardBody className="space-y-2 text-sm">
                      {diff.data.regression.warnings.map((w) => (
                        <Alert key={w} tone="warning">{w}</Alert>
                      ))}
                      <div>Skills removed: {diff.data.regression.skills_lost.join(", ") || "None"}</div>
                      <div>Skills added: {diff.data.regression.skills_added.join(", ") || "None"}</div>
                      <div className="text-muted-foreground">
                        {diff.data.regression.bullets_changed} bullets rewritten · {diff.data.regression.bullets_added} added ·{" "}
                        {diff.data.regression.bullets_removed} removed
                      </div>
                      {Object.keys(diff.data.regression.score_deltas).length > 0 && (
                        <Table>
                          <thead>
                            <tr>
                              <Th>Score</Th>
                              <Th>Before</Th>
                              <Th>After</Th>
                              <Th>Change</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(diff.data.regression.score_deltas).map(([k, d]) => (
                              <tr key={k}>
                                <Td>{humanize(k)}</Td>
                                <Td className="tabular">{d.old.toFixed(0)}</Td>
                                <Td className="tabular">{d.new.toFixed(0)}</Td>
                                <Td className={d.delta < 0 ? "tabular text-danger" : "tabular text-success"}>
                                  {d.delta > 0 ? "+" : ""}
                                  {d.delta.toFixed(1)}
                                </Td>
                              </tr>
                            ))}
                          </tbody>
                        </Table>
                      )}
                    </CardBody>
                  </Card>
                </>
              )}
            </>
          )}

          {tab === "claims" && (
            <Card>
              <CardHeader title="Claim verification" description="Every statement in a tailored resume must trace back to your master resume or profile." />
              {v.claims.length === 0 ? (
                <CardBody>
                  <p className="text-sm text-muted-foreground">
                    {isMaster ? "Master versions are your own facts; there is nothing to verify." : "No claims recorded."}
                  </p>
                </CardBody>
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Claim</Th>
                      <Th>Verified</Th>
                      <Th>Source</Th>
                      <Th>Original text</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {v.claims.map((c, i) => (
                      <tr key={i}>
                        <Td className="max-w-sm">
                          {c.claim}
                          {!c.verified && Array.isArray(c.reasons) && (
                            <ul className="mt-1 text-xs text-danger">
                              {(c.reasons as unknown[]).map((r, j) => (
                                <li key={j}>{String(r)}</li>
                              ))}
                            </ul>
                          )}
                        </Td>
                        <Td>
                          <YesNo value={c.verified} />
                        </Td>
                        <Td className="text-xs">{humanize(c.source_type ?? c.section)}</Td>
                        <Td className="max-w-sm text-xs text-muted-foreground">{c.original ?? "—"}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              )}
            </Card>
          )}

          {tab === "tests" && (
            <Card>
              <CardHeader title="Latest test results" />
              <CardBody>{tests.isLoading ? <Loading /> : <TestTable tests={tests.data?.tests ?? []} />}</CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Scores" />
            <CardBody className="space-y-3">
              <Meter label="Quality index" value={v.quality_index} />
              <Meter label="Parser" value={v.parser_score} />
              <Meter label="Round-trip" value={v.round_trip_score} />
              <Meter label="Formatting" value={v.formatting_score} />
              <Meter label="Keywords" value={v.keyword_score} />
              <Meter label="Requirements" value={v.requirement_score} />
              <Meter label="Evidence" value={v.evidence_score} />
            </CardBody>
          </Card>

          {canReview && (
            <Card>
              <CardHeader title="Review" description="Approve only if everything is accurate. Approved versions can be used in applications." />
              <CardBody className="space-y-3">
                <Field label="Notes (optional)">
                  <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </Field>
                {review.error && <Alert tone="danger">{(review.error as ApiError).message}</Alert>}
                <div className="flex gap-2">
                  <Button variant="success" className="flex-1" disabled={unverified.length > 0} onClick={() => review.mutate({ action: "approve" })} loading={review.isPending && review.variables?.action === "approve"}>
                    <Check className="h-4 w-4" /> Approve
                  </Button>
                  <Button variant="outline" className="flex-1" onClick={() => review.mutate({ action: "reject" })} loading={review.isPending && review.variables?.action === "reject"}>
                    <X className="h-4 w-4" /> Reject
                  </Button>
                </div>
              </CardBody>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
