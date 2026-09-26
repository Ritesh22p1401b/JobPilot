"use client";

import { Download, FileText, GitCompare, Gauge, Layers, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { z } from "zod";

import { RequireProfile } from "@/components/layout/require-profile";
import { VersionStatus } from "@/components/resume/version-status";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton, ScoreBadge, Segmented } from "@/components/ui";
import { download } from "@/lib/api";
import { useTemplateName, useVersions } from "@/lib/hooks";
import type * as S from "@/lib/schemas";
import { cn, fmtDate } from "@/lib/utils";

type V = z.infer<typeof S.VersionList>["versions"][number];

function VersionCard({ v, selected, onToggle }: { v: V; selected: boolean; onToggle: () => void }) {
  const base = v.version_type === "MASTER";
  const templateName = useTemplateName();
  return (
    <Card className={cn("flex min-w-0 flex-col p-4 transition-colors hover:border-border-strong", selected && "border-primary")}>
      <div className="flex items-start gap-3">
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${v.label ?? `version ${v.version_number}`} to compare`} className="mt-1 h-4 w-4 accent-[var(--primary)]" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge tone={base ? "primary" : "neutral"}>{base ? "Base resume" : "Tailored"}</Badge>
            <VersionStatus status={v.status} />
          </div>
          <Link href={`/resume-lab/${v.id}`} className="mt-2 block truncate font-semibold hover:text-primary">
            {base ? "Master resume" : v.label ?? `Version ${v.version_number}`}
          </Link>
          <div className="truncate text-[13px] text-subtle">
            {base ? "Your complete, verified resume. Never modified by AI." : v.job_title ? `Created for ${v.job_title} — ${v.company}` : "Tailored version"}
          </div>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ["ATS", v.quality_index],
          ["Coverage", v.requirement_score],
          ["Parser", v.parser_score],
        ].map(([label, val]) => (
          <div key={label as string} className="rounded-lg bg-elevated/60 py-2">
            <dt className="text-[10px] font-medium tracking-wider text-muted uppercase">{label}</dt>
            <dd className="mt-1">
              <ScoreBadge score={val as number | null} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 text-xs text-muted">
        v{v.version_number} · {templateName(v.template)} · {fmtDate(v.created_at)}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border pt-3">
        <ButtonLink href={`/resume-lab/${v.id}`} size="sm" variant="secondary">
          Open
        </ButtonLink>
        <ButtonLink href={`/resume-lab/${v.id}/test`} size="sm" variant="ghost">
          <Gauge className="h-3.5 w-3.5" /> Test
        </ButtonLink>
        <ButtonLink href={`/resume-lab/${v.id}/compare`} size="sm" variant="ghost">
          <GitCompare className="h-3.5 w-3.5" /> Compare
        </ButtonLink>
        <Button size="sm" variant="ghost" onClick={() => download(`/resume/${v.id}/download?format=pdf`, "resume.pdf")} aria-label="Download PDF">
          <Download className="h-3.5 w-3.5" /> PDF
        </Button>
      </div>
    </Card>
  );
}

export default function ResumeLabPage() {
  const router = useRouter();
  const versions = useVersions();
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState<"all" | "review" | "approved">("all");

  const all = versions.data?.versions ?? [];
  const master = all.find((v) => v.version_type === "MASTER");
  const olderMasters = all.filter((v) => v.version_type === "MASTER" && v.id !== master?.id);
  const tailored = all.filter((v) => v.version_type !== "MASTER").filter((v) => (filter === "review" ? ["DRAFT", "NEEDS_REVIEW"].includes(v.status) : filter === "approved" ? v.status === "APPROVED" : true));
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length >= 4 ? s : [...s, id]));

  return (
    <RequireProfile title="Resume Versions">
      <PageHeader
        title="Resume Versions"
        description="Your base resume stays untouched. Every tailored resume is a separate, independently accessible version."
        action={
          <>
            <Button variant="secondary" disabled={selected.length < 2} onClick={() => router.push(`/resume-lab/compare?ids=${selected.join(",")}`)}>
              <GitCompare className="h-4 w-4" /> Compare {selected.length >= 2 ? `(${selected.length})` : ""}
            </Button>
            <ButtonLink href="/resume-lab/new">
              <Plus className="h-4 w-4" /> Tailor for a job
            </ButtonLink>
          </>
        }
      />
      {versions.isLoading && <PageSkeleton rows={2} />}
      {versions.error && <ErrorState error={versions.error} onRetry={() => versions.refetch()} />}
      {master && (
        <section className="mb-8">
          <h2 className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Base resume</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <VersionCard v={master} selected={selected.includes(master.id)} onToggle={() => toggle(master.id)} />
          </div>
        </section>
      )}
      {versions.data && (
        <section>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-[11px] font-semibold tracking-wider text-muted uppercase">Job-tailored resumes</h2>
            <Segmented
              label="Filter"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { id: "all", label: "All" },
                { id: "review", label: "Needs review" },
                { id: "approved", label: "Approved" },
              ]}
            />
          </div>
          {tailored.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {tailored.map((v) => (
                <VersionCard key={v.id} v={v} selected={selected.includes(v.id)} onToggle={() => toggle(v.id)} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<Layers className="h-5 w-5" />} title={filter === "all" ? "No tailored resumes yet" : "Nothing here"} action={<ButtonLink href="/resume-lab/new">Tailor for a job</ButtonLink>}>
              Tailoring reorders and rephrases what your base resume already proves, for one specific job. Every claim is verified.
            </EmptyState>
          )}
        </section>
      )}
      {olderMasters.length > 0 && (
        <details className="mt-8">
          <summary className="cursor-pointer text-sm text-subtle">
            <FileText className="mr-1 inline h-4 w-4" aria-hidden /> Earlier base resume versions ({olderMasters.length})
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {olderMasters.map((v) => (
              <VersionCard key={v.id} v={v} selected={selected.includes(v.id)} onToggle={() => toggle(v.id)} />
            ))}
          </div>
        </details>
      )}
    </RequireProfile>
  );
}
