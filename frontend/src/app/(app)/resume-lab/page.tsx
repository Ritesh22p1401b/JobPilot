"use client";

import { GitCompare, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { NeedsResume, VersionStatusBadge } from "@/components/domain";
import { Badge, Button, Card, CardBody, CardHeader, ErrorState, LinkButton, Loading, PageHeader, ScoreBadge, Table, Td, Th } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useTemplates, useVersions } from "@/lib/hooks";
import { fmtDate, humanize } from "@/lib/utils";

export default function ResumeLabPage() {
  const router = useRouter();
  const versions = useVersions();
  const templates = useTemplates();
  const [selected, setSelected] = useState<string[]>([]);

  if (versions.isLoading) return <Loading />;
  if (versions.error instanceof ApiError && versions.error.status === 409)
    return (
      <>
        <PageHeader title="Resume Lab" />
        <NeedsResume />
      </>
    );
  if (versions.error) return <ErrorState error={versions.error} />;
  const list = versions.data?.versions ?? [];

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));

  return (
    <>
      <PageHeader
        title="Resume Lab"
        description="Test, compare and review resume versions. Your master resume is never modified; every tailored resume is a new version."
        action={
          <>
            <Button variant="outline" disabled={selected.length < 2} onClick={() => router.push(`/resume-lab/compare?ids=${selected.join(",")}`)}>
              <GitCompare className="h-4 w-4" /> Compare {selected.length >= 2 ? `(${selected.length})` : ""}
            </Button>
            <LinkButton href="/resume-lab/new">
              <Plus className="h-4 w-4" /> New tailored resume
            </LinkButton>
          </>
        }
      />

      <Card className="mb-5">
        <CardHeader title="Versions" description="Select 2–4 versions to compare them side by side." />
        <Table>
          <thead>
            <tr>
              <Th className="w-10"><span className="sr-only">Select</span></Th>
              <Th>Version</Th>
              <Th>Type</Th>
              <Th>For job</Th>
              <Th>Template</Th>
              <Th>Status</Th>
              <Th>Quality</Th>
              <Th>Created</Th>
              <Th><span className="sr-only">Actions</span></Th>
            </tr>
          </thead>
          <tbody>
            {list.map((v) => (
              <tr key={v.id}>
                <Td>
                  <input
                    type="checkbox"
                    aria-label={`Select version ${v.version_number}`}
                    checked={selected.includes(v.id)}
                    onChange={() => toggle(v.id)}
                    className="h-4 w-4 accent-[var(--primary)]"
                  />
                </Td>
                <Td>
                  <Link href={`/resume-lab/${v.id}`} className="font-medium hover:text-primary">
                    v{v.version_number}
                  </Link>
                  <div className="max-w-56 truncate text-xs text-muted-foreground">{v.label}</div>
                </Td>
                <Td>
                  <Badge tone={v.version_type === "MASTER" ? "info" : "neutral"}>{humanize(v.version_type)}</Badge>
                </Td>
                <Td className="max-w-56 text-xs">
                  {v.job_id ? (
                    <Link href={`/jobs/${v.job_id}`} className="hover:text-primary">
                      {v.job_title} <span className="text-muted-foreground">· {v.company}</span>
                    </Link>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </Td>
                <Td className="text-xs">{humanize(v.template)}</Td>
                <Td>
                  <VersionStatusBadge status={v.status} />
                </Td>
                <Td>
                  <ScoreBadge score={v.quality_index} />
                </Td>
                <Td className="text-xs text-muted-foreground">{fmtDate(v.created_at)}</Td>
                <Td className="whitespace-nowrap text-sm">
                  <Link href={`/resume-lab/${v.id}/test`} className="text-primary">Test</Link>
                  <span className="px-1.5 text-muted-foreground">·</span>
                  <Link href={`/resume-lab/${v.id}/compare`} className="text-primary">Compare</Link>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {templates.data && (
        <Card className="mt-5">
          <CardHeader title="Templates" description="All templates are single-column with standard headings, so ATS parsers read them reliably." />
          <CardBody className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templates.data.templates.map((t) => (
              <div key={t.id} className="rounded-md border p-3">
                <div className="text-sm font-medium">{t.name}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{t.description}</div>
                <div className="mt-2 text-[11px] text-muted-foreground">{t.section_order.map(humanize).join(" → ")}</div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </>
  );
}
