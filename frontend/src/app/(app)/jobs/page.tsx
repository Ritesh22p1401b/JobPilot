"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, ExternalLink, EyeOff, Plus, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { JobLink, NeedsResume } from "@/components/domain";
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
  Input,
  LinkButton,
  Loading,
  PageHeader,
  ScoreBadge,
  Select,
  Table,
  Td,
  Th,
  Toggle,
  Textarea,
} from "@/components/ui";
import { ApiError, api, qs } from "@/lib/api";
import { useApiMutation, useMe, useTaskTracker } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDate, fmtSalary, humanize } from "@/lib/utils";

const PAGE_SIZE = 25;

const ManualJob = z.object({
  title: z.string().trim().min(2, "Enter the job title"),
  company: z.string().trim().min(1, "Enter the company"),
  url: z.string().trim().url("Enter the job posting URL"),
  location: z.string().trim().optional(),
  description: z.string().trim().min(30, "Paste the full job description (at least 30 characters)"),
});

function ImportJob({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState({ title: "", company: "", url: "", location: "", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const imp = useApiMutation((body: z.infer<typeof ManualJob>) => api(S.ImportOut, "POST", "/jobs/import", body), [["jobs"]]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = ManualJob.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    const out = await imp.mutateAsync({ ...parsed.data, location: parsed.data.location || undefined });
    if (out.job_id) router.push(`/jobs/${out.job_id}`);
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <Card className="mb-5">
      <CardHeader
        title="Add a job you found yourself"
        description="For a posting you found on LinkedIn, Indeed or elsewhere. Paste the details; nothing is scraped."
        action={<Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>}
      />
      <CardBody>
        <form onSubmit={submit} className="grid gap-4 md:grid-cols-2" noValidate>
          <Field label="Job title" error={errors.title}><Input value={form.title} onChange={set("title")} /></Field>
          <Field label="Company" error={errors.company}><Input value={form.company} onChange={set("company")} /></Field>
          <Field label="Posting URL" error={errors.url}><Input value={form.url} onChange={set("url")} placeholder="https://…" /></Field>
          <Field label="Location (optional)"><Input value={form.location} onChange={set("location")} /></Field>
          <Field label="Job description" error={errors.description} className="md:col-span-2">
            <Textarea rows={8} value={form.description} onChange={set("description")} />
          </Field>
          {imp.error && <Alert tone="danger" className="md:col-span-2">{(imp.error as Error).message}</Alert>}
          <div className="md:col-span-2">
            <Button type="submit" loading={imp.isPending}>Add and analyze</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export default function JobsPage() {
  const me = useMe();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [source, setSource] = useState("");
  const [minScore, setMinScore] = useState("");
  const [remote, setRemote] = useState("");
  const [saved, setSaved] = useState(false);
  const [includeFiltered, setIncludeFiltered] = useState(false);
  const [sort, setSort] = useState<"score" | "recent">("score");
  const [page, setPage] = useState(1);
  const [importing, setImporting] = useState(false);
  const [links, setLinks] = useState<Record<string, string> | null>(null);
  const tracker = useTaskTracker([["jobs"], ["dashboard"]]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q);
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = {
    q: debounced,
    source,
    min_score: minScore,
    remote: remote === "" ? undefined : remote === "yes",
    saved: saved || undefined,
    include_filtered: includeFiltered || undefined,
    sort,
    page,
    page_size: PAGE_SIZE,
  };
  const jobs = useQuery({
    queryKey: ["jobs", params],
    queryFn: () => api(S.JobList, "GET", `/jobs${qs(params)}`),
    placeholderData: keepPreviousData,
    enabled: !!me.data?.has_profile,
  });

  const saveJob = useApiMutation(
    ({ id, value }: { id: string; value: boolean }) => api(S.Match, "POST", `/jobs/${id}/save?saved=${value}`),
    [["jobs"], ["applications"], ["dashboard"]],
  );
  const dismissJob = useApiMutation((id: string) => api(S.Match, "POST", `/jobs/${id}/dismiss?dismissed=true`), [["jobs"]]);

  if (me.isLoading) return <Loading />;
  if (me.data && !me.data.has_profile)
    return (
      <>
        <PageHeader title="Jobs" />
        <NeedsResume />
      </>
    );

  const search = async () => {
    const out = await api(S.SearchOut, "POST", "/jobs/search", {});
    setLinks(out.destination_links);
    tracker.start(out.task.id);
  };

  const total = jobs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const onFilter = <T,>(fn: (v: T) => void) => (v: T) => {
    fn(v);
    setPage(1);
  };

  return (
    <>
      <PageHeader
        title="Jobs"
        description="Jobs from public employer job boards (Greenhouse, Lever) and Adzuna, deduplicated and scored against your profile."
        action={
          <>
            <Button variant="outline" onClick={() => setImporting(true)}>
              <Plus className="h-4 w-4" /> Add job
            </Button>
            <Button onClick={search} loading={tracker.running}>
              <Search className="h-4 w-4" /> {tracker.running ? "Searching…" : "Search now"}
            </Button>
          </>
        }
      />

      {importing && <ImportJob onClose={() => setImporting(false)} />}

      {tracker.running && (
        <Alert tone="info" className="mb-4">
          Searching job sources and scoring matches. Results will appear here automatically.
        </Alert>
      )}
      {links && (
        <Alert tone="neutral" className="mb-4" title="Search LinkedIn and Indeed yourself">
          JobPilot never scrapes these sites. Open a search there, then use <em>Add job</em> for any posting you want analyzed.
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(links).map(([name, url]) => (
              <LinkButton key={name} href={url} target="_blank" rel="noreferrer" variant="outline" size="sm">
                {humanize(name)} <ExternalLink className="h-3.5 w-3.5" />
              </LinkButton>
            ))}
          </div>
        </Alert>
      )}

      <Card>
        <CardBody className="grid gap-3 border-b sm:grid-cols-2 lg:grid-cols-6">
          <div className="sm:col-span-2">
            <Input placeholder="Search title, company or location" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search jobs" />
          </div>
          <Select value={source} onChange={(e) => onFilter(setSource)(e.target.value)} aria-label="Source">
            <option value="">All sources</option>
            <option value="greenhouse">Greenhouse</option>
            <option value="lever">Lever</option>
            <option value="adzuna">Adzuna</option>
            <option value="manual">Added by me</option>
          </Select>
          <Select value={minScore} onChange={(e) => onFilter(setMinScore)(e.target.value)} aria-label="Minimum score">
            <option value="">Any score</option>
            <option value="50">50+</option>
            <option value="70">70+</option>
            <option value="85">85+</option>
          </Select>
          <Select value={remote} onChange={(e) => onFilter(setRemote)(e.target.value)} aria-label="Remote">
            <option value="">Remote: any</option>
            <option value="yes">Remote: Yes</option>
            <option value="no">Remote: No</option>
          </Select>
          <Select value={sort} onChange={(e) => onFilter(setSort)(e.target.value as "score" | "recent")} aria-label="Sort">
            <option value="score">Best match</option>
            <option value="recent">Most recent</option>
          </Select>
          <div className="flex flex-wrap gap-x-6 gap-y-2 sm:col-span-2 lg:col-span-6">
            <Toggle checked={saved} onChange={onFilter(setSaved)} label="Saved only" />
            <Toggle
              checked={includeFiltered}
              onChange={onFilter(setIncludeFiltered)}
              label="Show filtered-out jobs"
              description="Jobs that fail a hard requirement (location, seniority, sponsorship, role)."
            />
          </div>
        </CardBody>

        {jobs.isLoading && <Loading />}
        {jobs.error && (
          <CardBody>
            <ErrorState error={jobs.error} />
          </CardBody>
        )}
        {jobs.data && jobs.data.jobs.length === 0 && (
          <CardBody>
            <Empty title="No jobs match these filters">Try clearing filters, or run a new search.</Empty>
          </CardBody>
        )}
        {jobs.data && jobs.data.jobs.length > 0 && (
          <>
            <Table>
              <thead>
                <tr>
                  <Th className="w-16">Score</Th>
                  <Th>Job</Th>
                  <Th>Location</Th>
                  <Th>Remote</Th>
                  <Th>Missing required</Th>
                  <Th>Source</Th>
                  <Th className="w-20"><span className="sr-only">Actions</span></Th>
                </tr>
              </thead>
              <tbody>
                {jobs.data.jobs.map((j) => {
                  const m = j.match;
                  const salary = fmtSalary(j.salary_min, j.salary_max, j.currency);
                  const missing = m?.missing_skills.required ?? [];
                  return (
                    <tr key={j.id} className={m && !m.hard_filter_passed ? "opacity-60" : undefined}>
                      <Td>
                        <ScoreBadge score={m?.overall_score} />
                      </Td>
                      <Td className="min-w-56 max-w-sm">
                        <JobLink id={j.id} title={j.title} company={j.company} />
                        <div className="mt-1 flex flex-wrap gap-1">
                          {m && !m.hard_filter_passed && <Badge tone="danger">Filtered</Badge>}
                          {salary && <Badge>{salary}{j.salary_is_predicted ? " (estimate)" : ""}</Badge>}
                          {j.alternate_sources.length > 0 && <Badge>Also on {j.alternate_sources.length} other source(s)</Badge>}
                        </div>
                      </Td>
                      <Td className="max-w-48 text-muted-foreground">{j.location ?? "Not stated"}</Td>
                      <Td>
                        <Badge tone={j.remote ? "info" : "neutral"}>{j.remote ? "Yes" : "No"}</Badge>
                      </Td>
                      <Td className="max-w-56 text-xs">
                        {m ? (missing.length ? missing.slice(0, 4).join(", ") + (missing.length > 4 ? ` +${missing.length - 4}` : "") : <span className="text-muted-foreground">None</span>) : "—"}
                      </Td>
                      <Td className="text-xs text-muted-foreground">
                        {humanize(j.source)}
                        <div>{fmtDate(j.posted_at ?? j.first_seen_at)}</div>
                      </Td>
                      <Td>
                        {m && (
                          <div className="flex gap-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={m.saved ? "Unsave" : "Save"}
                              title={m.saved ? "Saved" : "Save (adds to Applications)"}
                              onClick={() => saveJob.mutate({ id: j.id, value: !m.saved })}
                            >
                              {m.saved ? <BookmarkCheck className="h-4 w-4 text-primary" /> : <Bookmark className="h-4 w-4" />}
                            </Button>
                            <Button variant="ghost" size="icon" aria-label="Dismiss" title="Not interested" onClick={() => dismissJob.mutate(j.id)}>
                              <EyeOff className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
            <div className="flex items-center justify-between px-5 py-3 text-sm text-muted-foreground">
              <span className="tabular">
                {total} job{total === 1 ? "" : "s"} · page {page} of {pages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button>
                <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
              </div>
            </div>
          </>
        )}
      </Card>
      {(saveJob.error || dismissJob.error) && (
        <Alert tone="danger" className="mt-3">
          {((saveJob.error ?? dismissJob.error) as ApiError).message}
        </Alert>
      )}
    </>
  );
}
