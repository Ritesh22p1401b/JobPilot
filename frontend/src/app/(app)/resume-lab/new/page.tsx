"use client";

import { useQuery } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Loading, PageHeader, Select, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useTaskTracker, useTemplates } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtScore } from "@/lib/utils";

function NewTailored() {
  const router = useRouter();
  const preset = useSearchParams().get("job") ?? "";
  const jobs = useQuery({ queryKey: ["jobs", "for-tailor"], queryFn: () => api(S.JobList, "GET", "/jobs?page_size=50&sort=score") });
  const templates = useTemplates();
  const [jobId, setJobId] = useState(preset);
  const [template, setTemplate] = useState("");
  const [label, setLabel] = useState("");
  const [useLlm, setUseLlm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tracker = useTaskTracker([["versions"]]);

  useEffect(() => {
    if (!tracker.done || tracker.failed) return;
    // Open the newest version created for this job.
    void api(S.VersionList, "GET", `/resume/versions?job_id=${jobId}`).then((out) => {
      const newest = out.versions[0];
      if (newest) router.push(`/resume-lab/${newest.id}`);
    });
  }, [tracker.done, tracker.failed, jobId, router]);

  const start = async () => {
    if (!jobId) return setError("Choose a job to tailor for.");
    setError(null);
    try {
      const out = await api(S.TaskEnvelope, "POST", "/resume/tailor", { job_id: jobId, template: template || null, label: label || null, use_llm: useLlm });
      tracker.start(out.task.id);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Tailor for a job"
        description="Creates a new version from your master resume: relevant evidence is reordered and phrasing aligned to the job. Nothing is invented, every claim is verified, and the master stays unchanged."
      />
      <CardBody className="space-y-4">
        <Field label="Job">
          <Select value={jobId} onChange={(e) => setJobId(e.target.value)}>
            <option value="">Choose a job…</option>
            {jobs.data?.jobs.map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.company} {j.match ? `(match ${fmtScore(j.match.overall_score)})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Template">
            <Select value={template} onChange={(e) => setTemplate(e.target.value)}>
              <option value="">Choose automatically for the role</option>
              {templates.data?.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Label (optional)">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. GitLab AI Engineer" />
          </Field>
        </div>
        <Toggle
          label="Use the LLM for phrasing"
          description="If the LLM is unavailable or a rewrite fails verification, the original bullet is kept."
          checked={useLlm}
          onChange={setUseLlm}
        />
        {error && <Alert tone="danger">{error}</Alert>}
        {tracker.failed && <Alert tone="danger">{tracker.task?.error}</Alert>}
        <Button onClick={start} loading={tracker.running}>
          <Wand2 className="h-4 w-4" /> {tracker.running ? "Tailoring and testing…" : "Create tailored resume"}
        </Button>
      </CardBody>
    </Card>
  );
}

export default function NewResumePage() {
  return (
    <>
      <Link href="/resume-lab" className="text-sm text-muted-foreground hover:text-foreground">
        ← Resume Lab
      </Link>
      <PageHeader
        title="New resume version"
        description={
          <>
            To replace your master resume, <Link href="/resume" className="text-primary">upload a new file</Link>. To change facts, edit your{" "}
            <Link href="/profile" className="text-primary">profile</Link>.
          </>
        }
      />
      <Suspense fallback={<Loading />}>
        <NewTailored />
      </Suspense>
    </>
  );
}
