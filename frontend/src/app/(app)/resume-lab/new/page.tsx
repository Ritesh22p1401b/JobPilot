"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { AIThinking, PIPELINES } from "@/components/ai/thinking";
import { RequireProfile } from "@/components/layout/require-profile";
import { Button, Callout, Card, CardBody, CardHeader, Field, Input, PageHeader, PageSkeleton, Select, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useLlmStatus, useTaskTracker, useTemplates } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, fmtScore, humanize } from "@/lib/utils";

function NewTailored() {
  const router = useRouter();
  const preset = useSearchParams().get("job") ?? "";
  const jobs = useQuery({ queryKey: ["jobs", "for-tailor"], queryFn: () => api(S.JobList, "GET", "/jobs?page_size=60&sort=score") });
  const presetJob = useQuery({ queryKey: ["job", preset], queryFn: () => api(S.JobDetail, "GET", `/jobs/${preset}`), enabled: !!preset });
  const templates = useTemplates();
  const llm = useLlmStatus();
  const [jobId, setJobId] = useState(preset);
  const [template, setTemplate] = useState("");
  const [label, setLabel] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tracker = useTaskTracker([["versions"]]);

  useEffect(() => {
    if (!tracker.done || tracker.failed) return;
    void api(S.VersionList, "GET", `/resume/versions?job_id=${jobId}`).then((out) => {
      const newest = out.versions[0];
      if (newest) router.push(`/resume-lab/${newest.id}`);
    });
  }, [tracker.done, tracker.failed, jobId, router]);

  const options = [...(jobs.data?.jobs ?? [])];
  if (presetJob.data && !options.some((j) => j.id === preset)) options.unshift(presetJob.data);
  const selected = options.find((j) => j.id === jobId);

  const start = async () => {
    if (!jobId) return setError("Choose the job to tailor for.");
    setError(null);
    try {
      const out = await api(S.TaskEnvelope, "POST", "/resume/tailor", { job_id: jobId, template: template || null, label: label || null, use_llm: useLlm });
      tracker.start(out.task.id);
    } catch (e) {
      setError(errorText(e));
    }
  };

  if (tracker.running || (tracker.done && !tracker.failed))
    return (
      <div className="mx-auto max-w-lg py-10">
        <AIThinking tracker={tracker} steps={PIPELINES.tailor} title={`Tailoring your resume for ${selected ? `${selected.title} — ${selected.company}` : "this job"}…`} />
        <p className="mt-3 text-center text-xs text-muted">{tracker.done ? "Opening your new version…" : "Your base resume is not changed."}</p>
      </div>
    );

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="1. Target job" />
          <CardBody>
            <Field label="Job" htmlFor="t-job">
              <Select id="t-job" value={jobId} onChange={(e) => setJobId(e.target.value)}>
                <option value="">Choose a job…</option>
                {options.map((j) => (
                  <option key={j.id} value={j.id}>
                    {j.title} · {j.company}
                    {j.match ? ` (${fmtScore(j.match.overall_score)}% match)` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            {selected?.match && (
              <p className="mt-2 text-xs text-muted">
                {selected.match.matched_skills.length} requirements evidenced · {(selected.match.missing_skills.required ?? []).length} required gaps. Gaps stay gaps: tailoring never adds skills you haven’t shown.
              </p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="2. Template" description="All templates are single-column with standard headings, so ATS parsers read them reliably." />
          <CardBody>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Template">
              {[{ id: "", name: "Choose automatically", description: "Picks the best fit for the role.", section_order: [] as string[] }, ...(templates.data?.templates ?? [])].map((t) => (
                <button
                  key={t.id || "auto"}
                  type="button"
                  role="radio"
                  aria-checked={template === t.id}
                  onClick={() => setTemplate(t.id)}
                  className={cn("rounded-xl border p-3.5 text-left transition-colors", template === t.id ? "border-primary bg-hover" : "border-border hover:border-border-strong")}
                >
                  <div className="flex items-center justify-between text-sm font-medium">
                    {t.name}
                    {template === t.id && <Check className="h-4 w-4 text-primary" aria-hidden />}
                  </div>
                  <div className="mt-0.5 text-xs text-subtle">{t.description}</div>
                  {t.section_order.length > 0 && <div className="mt-1.5 text-[11px] text-muted">{t.section_order.map(humanize).join(" → ")}</div>}
                </button>
              ))}
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="3. Options" />
          <CardBody className="space-y-4">
            <Field label="Label (optional)" htmlFor="t-label">
              <Input id="t-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder={selected ? `${selected.title} — ${selected.company}` : "e.g. AI Engineer — Company X"} />
            </Field>
            <Toggle
              label="Use the LLM to rephrase bullets"
              description={llm.data?.reachable ? "Every rewrite is checked; any new skill, number or claim is rejected and your original is kept." : "The LLM isn’t connected, so bullets are selected and reordered but kept in your words."}
              checked={useLlm && !!llm.data?.reachable}
              disabled={!llm.data?.reachable}
              onChange={setUseLlm}
            />
          </CardBody>
        </Card>
        {error && <Callout tone="danger">{error}</Callout>}
        {tracker.failed && <Callout tone="danger" title="Tailoring failed">{tracker.task?.error}</Callout>}
        <Button size="lg" onClick={start} disabled={!jobId}>
          <Wand2 className="h-4 w-4" /> Create tailored resume
        </Button>
      </div>
      <aside>
        <Card className="p-5 lg:sticky lg:top-20">
          <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">What tailoring does</div>
          <ul className="mt-3 space-y-2.5 text-[13px] text-subtle">
            {[
              "Selects and reorders the evidence most relevant to this job",
              "Aligns wording with the job’s terminology, only where it’s true",
              "Verifies every statement against your base resume",
              "Renders ATS-safe DOCX and PDF, then re-parses them to test",
              "Creates a new version for your review; nothing is overwritten",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden /> {t}
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted">
            To change facts, edit your{" "}
            <Link href="/profile" className="text-primary hover:underline">
              profile
            </Link>
            .
          </p>
        </Card>
      </aside>
    </div>
  );
}

export default function NewResumePage() {
  return (
    <RequireProfile title="Tailor for a job">
      <PageHeader back={{ href: "/resume-lab", label: "Resume Versions" }} title="Tailor for a job" description="Create a job-specific version of your resume. Your base resume is never changed." />
      <Suspense fallback={<PageSkeleton />}>
        <NewTailored />
      </Suspense>
    </RequireProfile>
  );
}
