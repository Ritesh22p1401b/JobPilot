"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Columns2, ExternalLink, LayoutGrid, List, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { AIThinking, PIPELINES } from "@/components/ai/thinking";
import { Button, ButtonLink, Callout, EmptyState, ErrorState, Field, Input, PageHeader, Segmented, Select, Skeleton, Textarea, Toggle } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api, qs } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useLocalPref, useTaskTracker } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, humanize } from "@/lib/utils";

import { JobCard } from "./job-card";
import { JobPreview } from "./job-preview";

const PAGE_SIZE = 24;
type View = "list" | "grid" | "split";

const FILTER_KEYS = ["q", "location", "remote", "min_salary", "seniority", "employment_type", "company", "skill", "posted_within_days", "min_score", "source", "include_filtered", "saved", "sort"] as const;

const ManualJob = z.object({
  title: z.string().trim().min(2, "Enter the job title"),
  company: z.string().trim().min(1, "Enter the company"),
  url: z.string().trim().url("Enter the posting URL (https://…)"),
  location: z.string().trim().optional(),
  description: z.string().trim().min(30, "Paste the full job description (at least 30 characters)"),
});

function AddJobDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState({ title: "", company: "", url: "", location: "", description: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const submit = async () => {
    const p = ManualJob.safeParse(form);
    if (!p.success) return setErrors(Object.fromEntries(p.error.issues.map((i) => [String(i.path[0]), i.message])));
    setErrors({});
    setBusy(true);
    try {
      const out = await api(S.ImportOut, "POST", "/jobs/import", { ...p.data, location: p.data.location || undefined });
      onClose();
      toast({ tone: "success", title: "Job added and analyzed" });
      if (out.job_id) router.push(`/jobs/${out.job_id}`);
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t add this job", body: errorText(e) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Add a job you found yourself"
      description="For postings from LinkedIn, Indeed or a company site. Paste the details; JobPilot never fetches or scrapes the page."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={busy}>
            Add and analyze
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="mj-title" error={errors.title}>
          <Input id="mj-title" value={form.title} onChange={set("title")} />
        </Field>
        <Field label="Company" htmlFor="mj-company" error={errors.company}>
          <Input id="mj-company" value={form.company} onChange={set("company")} />
        </Field>
        <Field label="Posting URL" htmlFor="mj-url" error={errors.url}>
          <Input id="mj-url" value={form.url} onChange={set("url")} placeholder="https://" />
        </Field>
        <Field label="Location (optional)" htmlFor="mj-loc">
          <Input id="mj-loc" value={form.location} onChange={set("location")} />
        </Field>
        <Field label="Job description" htmlFor="mj-desc" error={errors.description} className="sm:col-span-2">
          <Textarea id="mj-desc" rows={8} value={form.description} onChange={set("description")} />
        </Field>
      </div>
    </Dialog>
  );
}

export function JobSearch({
  title,
  description,
  preset = {},
  defaultView = "list",
  hideSearchActions,
}: {
  title: string;
  description: React.ReactNode;
  preset?: Partial<Record<(typeof FILTER_KEYS)[number], string>>;
  defaultView?: View;
  hideSearchActions?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [view, setView] = useLocalPref<View>(`jobs-view-${pathname}`, defaultView);
  const [showFilters, setShowFilters] = useState(false);
  const [adding, setAdding] = useState(false);
  const [links, setLinks] = useState<Record<string, string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const tracker = useTaskTracker([["jobs"], ["insights"]]);

  const get = (k: (typeof FILTER_KEYS)[number]) => params.get(k) ?? preset[k] ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [q, setQ] = useState(get("q"));
  useEffect(() => setQ(get("q")), [params]); // eslint-disable-line react-hooks/exhaustive-deps

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === preset[k as (typeof FILTER_KEYS)[number]]) p.delete(k);
      else p.set(k, v);
    }
    if (!("page" in patch)) p.delete("page");
    router.replace(`${pathname}${p.toString() ? `?${p}` : ""}`, { scroll: false });
  };
  useEffect(() => {
    const t = setTimeout(() => q !== get("q") && setParams({ q }), 350);
    return () => clearTimeout(t);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  const apiParams = useMemo(() => {
    const out: Record<string, string | number | boolean | undefined> = { page, page_size: PAGE_SIZE };
    for (const k of FILTER_KEYS) {
      const v = get(k);
      if (!v) continue;
      out[k] = k === "remote" || k === "saved" || k === "include_filtered" ? v === "true" || v === "1" : v;
    }
    return out;
  }, [params, page]); // eslint-disable-line react-hooks/exhaustive-deps

  const jobs = useQuery({
    queryKey: ["jobs", pathname, apiParams],
    queryFn: () => api(S.JobList, "GET", `/jobs${qs(apiParams)}`),
    placeholderData: keepPreviousData,
  });
  const list = jobs.data?.jobs ?? [];
  const activeId = selected && list.some((j) => j.id === selected) ? selected : list[0]?.id ?? null;
  const total = jobs.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilters = FILTER_KEYS.filter((k) => k !== "q" && k !== "sort" && params.get(k));

  const search = async () => {
    try {
      const out = await api(S.SearchOut, "POST", "/jobs/search", {});
      setLinks(out.destination_links);
      tracker.start(out.task.id);
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t start the search", body: errorText(e) });
    }
  };

  const filterFields = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Location" htmlFor="f-loc">
        <Input id="f-loc" defaultValue={get("location")} placeholder="Any" onBlur={(e) => setParams({ location: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && setParams({ location: (e.target as HTMLInputElement).value.trim() })} />
      </Field>
      <Field label="Remote" htmlFor="f-remote">
        <Select id="f-remote" value={get("remote")} onChange={(e) => setParams({ remote: e.target.value })}>
          <option value="">Any</option>
          <option value="true">Remote only</option>
          <option value="false">On-site / hybrid</option>
        </Select>
      </Field>
      <Field label="Minimum salary" htmlFor="f-sal" hint="Only jobs that publish a salary">
        <Input id="f-sal" type="number" min={0} defaultValue={get("min_salary")} placeholder="Any" onBlur={(e) => setParams({ min_salary: e.target.value })} />
      </Field>
      <Field label="Experience" htmlFor="f-sen">
        <Select id="f-sen" value={get("seniority")} onChange={(e) => setParams({ seniority: e.target.value })}>
          <option value="">Any level</option>
          {["intern", "entry", "mid", "senior", "lead"].map((l) => (
            <option key={l} value={l}>
              {humanize(l)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Job type" htmlFor="f-type">
        <Select id="f-type" value={get("employment_type")} onChange={(e) => setParams({ employment_type: e.target.value })}>
          <option value="">Any type</option>
          {S.EMPLOYMENT_TYPES.map((t) => (
            <option key={t} value={t}>
              {humanize(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Company" htmlFor="f-co">
        <Input id="f-co" defaultValue={get("company")} placeholder="Exact name" onBlur={(e) => setParams({ company: e.target.value.trim() })} />
      </Field>
      <Field label="Skill" htmlFor="f-skill">
        <Input id="f-skill" defaultValue={get("skill")} placeholder="e.g. Python" onBlur={(e) => setParams({ skill: e.target.value.trim() })} />
      </Field>
      <Field label="Posted" htmlFor="f-posted">
        <Select id="f-posted" value={get("posted_within_days")} onChange={(e) => setParams({ posted_within_days: e.target.value })}>
          <option value="">Any time</option>
          <option value="1">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
        </Select>
      </Field>
      <Field label="Match score" htmlFor="f-score">
        <Select id="f-score" value={get("min_score")} onChange={(e) => setParams({ min_score: e.target.value })}>
          <option value="">Any score</option>
          <option value="50">50+</option>
          <option value="70">70+</option>
          <option value="80">80+</option>
          <option value="90">90+</option>
        </Select>
      </Field>
      <Field label="Source" htmlFor="f-src">
        <Select id="f-src" value={get("source")} onChange={(e) => setParams({ source: e.target.value })}>
          <option value="">All sources</option>
          <option value="greenhouse">Greenhouse</option>
          <option value="lever">Lever</option>
          <option value="adzuna">Adzuna</option>
          <option value="manual">Added by me</option>
        </Select>
      </Field>
      <div className="flex items-end sm:col-span-2">
        <Toggle checked={get("include_filtered") === "true"} onChange={(v) => setParams({ include_filtered: v ? "true" : "" })} label="Include filtered-out jobs" description="Jobs failing a hard requirement (location, seniority, sponsorship, role)." />
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title={title}
        description={description}
        action={
          !hideSearchActions && (
            <>
              <Button variant="secondary" onClick={() => setAdding(true)}>
                <Plus className="h-4 w-4" /> Add job
              </Button>
              <Button onClick={search} loading={tracker.running}>
                <Search className="h-4 w-4" /> {tracker.running ? "Searching…" : "Search now"}
              </Button>
            </>
          )
        }
      />
      <AddJobDialog open={adding} onClose={() => setAdding(false)} />

      {(tracker.running || tracker.done) && (
        <AIThinking tracker={tracker} steps={PIPELINES.search} title={tracker.done ? "Search complete. Results below are up to date." : "Searching and scoring. Results update when it finishes."} className="mb-4" />
      )}
      {links && (
        <Callout
          tone="neutral"
          className="mb-4"
          title="Search LinkedIn and Indeed yourself"
          action={Object.entries(links).map(([name, url]) => (
            <ButtonLink key={name} href={url} variant="secondary" size="sm">
              {humanize(name)} <ExternalLink className="h-3.5 w-3.5" />
            </ButtonLink>
          ))}
        >
          JobPilot never scrapes these sites. Open a search there, then use <em>Add job</em> for postings you want analyzed.
        </Callout>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, company or location" className="pl-9" aria-label="Search jobs" />
        </div>
        <Select value={get("sort") || "score"} onChange={(e) => setParams({ sort: e.target.value === "score" ? "" : e.target.value })} aria-label="Sort" className="w-40">
          <option value="score">Best match</option>
          <option value="recent">Newest</option>
          <option value="salary">Salary</option>
        </Select>
        <Button variant={showFilters || activeFilters.length ? "secondary" : "ghost"} onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters}>
          <SlidersHorizontal className="h-4 w-4" /> Filters {activeFilters.length > 0 && <span className="tabular rounded bg-primary px-1.5 text-[11px] text-primary-foreground">{activeFilters.length}</span>}
        </Button>
        <Segmented
          label="View"
          value={view}
          onChange={setView}
          options={[
            { id: "list", label: <span className="sr-only sm:not-sr-only">List</span>, icon: <List className="h-4 w-4" /> },
            { id: "grid", label: <span className="sr-only sm:not-sr-only">Grid</span>, icon: <LayoutGrid className="h-4 w-4" /> },
            { id: "split", label: <span className="sr-only sm:not-sr-only">Split</span>, icon: <Columns2 className="h-4 w-4" /> },
          ]}
        />
      </div>

      {showFilters && <div className="mb-4 animate-rise rounded-xl border border-border bg-surface p-4">{filterFields}</div>}
      {activeFilters.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          {activeFilters.map((k) => (
            <button key={k} onClick={() => setParams({ [k]: null })} className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2.5 py-0.5 text-xs text-subtle hover:border-border-strong">
              {humanize(k)}: {params.get(k)} <X className="h-3 w-3" aria-label="Remove filter" />
            </button>
          ))}
          <button onClick={() => setParams(Object.fromEntries(activeFilters.map((k) => [k, null])))} className="text-xs text-primary hover:underline">
            Clear all
          </button>
        </div>
      )}

      {jobs.error && <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} context="load jobs" />}
      {jobs.isLoading && (
        <div className="grid gap-3">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      )}
      {jobs.data && list.length === 0 && (
        <EmptyState icon={<Search className="h-5 w-5" />} title="No jobs match these filters" action={activeFilters.length ? <Button variant="secondary" onClick={() => setParams(Object.fromEntries(activeFilters.map((k) => [k, null])))}>Clear filters</Button> : <Button onClick={search}>Find jobs</Button>}>
          Try widening your filters, or run a new search across job boards.
        </EmptyState>
      )}

      {list.length > 0 && (
        <div className={cn(jobs.isFetching && "opacity-70 transition-opacity")}>
          {view === "split" ? (
            <div className="grid overflow-hidden rounded-xl border border-border bg-surface lg:grid-cols-[minmax(300px,380px)_1fr]" style={{ minHeight: "70vh" }}>
              <div className="scrollbar-thin border-b border-border lg:max-h-[78vh] lg:overflow-y-auto lg:border-r lg:border-b-0">
                {list.map((j) => (
                  <JobCard key={j.id} job={j} variant="compact" selected={j.id === activeId} onSelect={() => setSelected(j.id)} />
                ))}
              </div>
              <div className="scrollbar-thin lg:max-h-[78vh] lg:overflow-y-auto">{activeId && <JobPreview key={activeId} jobId={activeId} />}</div>
            </div>
          ) : (
            <div className={cn("grid gap-3", view === "grid" && "sm:grid-cols-2 2xl:grid-cols-3")}>
              {list.map((j) => (
                <JobCard key={j.id} job={j} variant={view === "grid" ? "card" : "row"} />
              ))}
            </div>
          )}
          <div className="mt-5 flex items-center justify-between text-sm text-subtle">
            <span className="tabular">
              {total} job{total === 1 ? "" : "s"} · page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setParams({ page: String(page - 1) })}>
                Previous
              </Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setParams({ page: String(page + 1) })}>
                Next
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
