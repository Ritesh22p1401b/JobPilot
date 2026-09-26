/**
 * End-to-end contract check: drives the real backend through the Next.js proxy and validates every
 * response with the same Zod schemas the UI uses. Run with the API and `next start` up:
 *
 *   node --no-warnings scripts/contract-check.mts [baseUrl] [resumePath]
 *
 * Creates a throwaway user and runs a live job search (public job-board APIs), so it takes a few minutes.
 */
import { readFileSync } from "node:fs";
import type { z } from "zod";

import * as S from "../src/lib/schemas.ts";

const BASE = `${process.argv[2] ?? "http://127.0.0.1:3000"}/api/v1`;
const RESUME = process.argv[3] ?? "../backend/tests/fixtures/sample_resume.txt";
let token = "";
let failures = 0;

async function call<T extends z.ZodTypeAny>(schema: T, method: string, path: string, body?: unknown): Promise<z.output<T>> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    failures++;
    console.error(`✗ ${method} ${path}: schema mismatch`, JSON.stringify(parsed.error.issues.slice(0, 5), null, 1));
    return data as z.output<T>;
  }
  console.log(`✓ ${method} ${path}`);
  return parsed.data;
}

async function waitForTasks(label: string, timeoutS = 600) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutS * 1000) {
    const { tasks } = await call(S.TaskList, "GET", "/tasks?active_only=true");
    if (!tasks.length) {
      console.log(`  … ${label} finished in ${Math.round((Date.now() - t0) / 1000)}s`);
      return;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`${label} did not finish in ${timeoutS}s`);
}

const email = `contract${Date.now()}@example.com`;
token = (await call(S.TokenOut, "POST", "/auth/register", { email, password: "Contract123!" })).access_token;
await call(S.Me, "GET", "/auth/me");
await call(S.Dashboard, "GET", "/dashboard"); // no-profile shape

const fd = new FormData();
fd.append("file", new Blob([readFileSync(RESUME)], { type: "text/plain" }), "resume.txt");
await call(S.UploadOut, "POST", "/resume/upload", fd);
const resume = await call(S.ResumeOut, "GET", "/resume");
await call(S.ProfileOut, "GET", "/profile");
await call(S.Templates, "GET", "/resume/templates");

const prefs = await call(S.Preferences, "GET", "/preferences");
await call(S.Preferences, "PUT", "/preferences", {
  ...prefs,
  target_titles: ["AI Engineer", "Machine Learning Engineer", "Backend Engineer"],
  locations: ["Bengaluru", "Remote"],
  experience_level: "entry",
  minimum_match_score: 55,
  application_mode: "ASSISTED_APPLICATION",
});
await waitForTasks("initial matching");

await call(S.SearchOut, "POST", "/jobs/search", {});
await waitForTasks("discovery + matching");

const jobs = await call(S.JobList, "GET", "/jobs?page_size=5&sort=score");
await call(S.JobList, "GET", "/jobs?include_filtered=true&remote=true&source=greenhouse&min_score=50&page=2");
await call(S.Dashboard, "GET", "/dashboard");
await call(S.NotificationList, "GET", "/notifications");
await call(S.Ready, "GET", "/health/ready");
await call(S.SourceList, "GET", "/sources");
await call(S.LlmHealth, "GET", "/system/llm");
await call(S.AgentRuns, "GET", "/agents/runs?limit=25");
await call(S.Insights, "GET", "/insights");
await call(S.JobList, "GET", "/jobs?location=bengaluru&posted_within_days=30&sort=salary&employment_type=full_time");

const imported = await call(S.ImportOut, "POST", "/jobs/import", {
  title: "LLM Engineer",
  company: "Contract Test Co",
  url: `https://example.com/jobs/${Date.now()}`,
  location: "Bengaluru, India",
  description: readFileSync("../backend/tests/fixtures/sample_jd.txt", "utf-8"),
});
const jobId = imported.job_id ?? jobs.jobs[0]?.id;
if (!jobId) throw new Error("no job to continue with");
await call(S.TaskEnvelope, "POST", "/agents/match", {});
await waitForTasks("matching imported job");

const job = await call(S.JobDetail, "GET", `/jobs/${jobId}`);
console.log(`  … job "${job.title}" score=${job.match?.overall_score} requirements=${job.requirement_matrix.length}`);
if (job.match) {
  await call(S.Match, "POST", `/jobs/${jobId}/save?saved=true`);
  await call(S.Match, "GET", `/matches/${job.match.id}`);
}

const report = await call(S.Report, "POST", "/resume/analyze", { job_id: jobId, ats_profile: "greenhouse_style" });
console.log(`  … ATS report quality_index=${report.quality_index} tests=${report.tests.length} keywords=${report.keywords.length}`);
await call(S.Report, "POST", "/resume/test", { ats_profile: "generic" });

await call(S.TaskEnvelope, "POST", "/resume/tailor", { job_id: jobId, template: null, use_llm: true });
await waitForTasks("tailoring");
const versions = await call(S.VersionList, "GET", "/resume/versions");
const tailored = versions.versions.find((v) => v.job_id === jobId);
const master = resume.master_version;
if (tailored && master) {
  const detail = await call(S.VersionDetail, "GET", `/resume/${tailored.id}`);
  console.log(`  … tailored v${detail.version_number}: ${detail.claims.length} claims, ${detail.claims.filter((c) => !c.verified).length} unverified`);
  await call(S.DiffOut, "GET", `/resume/${tailored.id}/diff`);
  await call(S.TestResults, "GET", `/resume/${tailored.id}/test-results`);
  await call(S.CompareOut, "POST", "/resume/compare", { version_ids: [master.id, tailored.id], job_id: jobId });
} else {
  failures++;
  console.error("✗ no tailored version was created");
}

const prep = await call(S.PrepareOut, "POST", `/applications/${jobId}/prepare`);
await waitForTasks("application prep");
const app = await call(S.Application, "GET", `/applications/${prep.application_id}`);
console.log(`  … application ${app.status}: ${app.answers.length} answers, cover letter ${app.cover_letter ? "yes" : "no"}, ${app.events?.length} events`);
await call(S.ApplicationList, "GET", "/applications");
const approved = await call(S.Application, "POST", `/applications/${jobId}/approve`, {
  answers: Object.fromEntries(app.answers.map((a) => [a.question, a.answer ?? "Prefer not to say"])),
  approve_resume: true,
  cover_letter: null,
  notes: "contract check",
});
if (approved.status === "READY") await call(S.SubmitOut, "POST", `/applications/${jobId}/submit`);
await call(S.Application, "PATCH", `/applications/${prep.application_id}`, { status: "APPLIED", notes: "applied on employer site" });
const after = await call(S.Insights, "GET", "/insights");
if (after.funnel.applied < 1) {
  failures++;
  console.error("✗ insights funnel did not count the application");
}

const profile = (await call(S.ProfileOut, "GET", "/profile")).profile;
await call(S.ProfileUpdateOut, "PATCH", "/profile", { languages: [...profile.languages, "English"] });

console.log(failures ? `\n${failures} contract failure(s)` : "\nAll responses match the UI schemas.");
process.exit(failures ? 1 : 0);
