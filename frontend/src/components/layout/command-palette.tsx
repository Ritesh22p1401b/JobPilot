"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Briefcase, Building2, CornerDownLeft, FileText, Gauge, LayoutList, Moon, Search, Sparkles, Target, Wand2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import * as React from "react";
import { createPortal } from "react-dom";

import { useToast } from "@/components/ui/toast";
import { api, qs } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApplications, useInsights, useMe, useVersions } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { toggleTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

import { ALL_NAV } from "./nav";

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: React.ReactNode;
  run: () => void | Promise<void>;
  keywords?: string;
}

const PaletteCtx = React.createContext<{ open: () => void }>({ open: () => undefined });
export const usePalette = () => React.useContext(PaletteCtx);

function matches(q: string, ...fields: (string | undefined | null)[]): boolean {
  const hay = fields.filter(Boolean).join(" ").toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((w) => hay.includes(w));
}

export function CommandPaletteProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  return (
    <PaletteCtx.Provider value={{ open: () => setOpen(true) }}>
      {children}
      {open && <Palette onClose={() => setOpen(false)} />}
    </PaletteCtx.Provider>
  );
}

function Palette({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const qc = useQueryClient();
  const me = useMe();
  const hasProfile = !!me.data?.has_profile;
  const [q, setQ] = React.useState("");
  const [debounced, setDebounced] = React.useState("");
  const [cursor, setCursor] = React.useState(0);
  const input = React.useRef<HTMLInputElement>(null);
  const listId = React.useId();

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  React.useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => prev?.focus();
  }, []);

  const jobs = useQuery({
    queryKey: ["palette-jobs", debounced],
    queryFn: () => api(S.JobList, "GET", `/jobs${qs({ q: debounced, page_size: 6, include_filtered: true })}`),
    enabled: hasProfile && debounced.length >= 2,
  });
  const apps = useApplications();
  const versions = useVersions();
  const insights = useInsights(hasProfile);

  const go = (href: string) => () => {
    onClose();
    router.push(href);
  };
  const jobMatch = /^\/jobs\/([^/]+)/.exec(pathname);
  const currentJob = jobMatch?.[1];

  const commands: Item[] = [
    ...(currentJob
      ? [
          { id: "c-tailor", group: "Commands", label: "Tailor resume for current job", icon: <Wand2 className="h-4 w-4" />, run: go(`/resume-lab/new?job=${currentJob}`) },
          { id: "c-ats-job", group: "Commands", label: "Analyze ATS for current job", icon: <Gauge className="h-4 w-4" />, run: go(`/ats?job=${currentJob}`) },
        ]
      : []),
    {
      id: "c-find",
      group: "Commands",
      label: "Find new jobs now",
      hint: "Runs a search across public job boards",
      icon: <Sparkles className="h-4 w-4" />,
      keywords: "search discover",
      run: async () => {
        onClose();
        try {
          await api(S.SearchOut, "POST", "/jobs/search", {});
          toast({ tone: "info", title: "Searching for jobs", body: "New matches will appear in Job Search as they're scored." });
          void qc.invalidateQueries({ queryKey: ["tasks"] });
          router.push("/jobs");
        } catch (e) {
          toast({ tone: "error", title: "Couldn't start the search", body: errorText(e) });
        }
      },
    },
    { id: "c-ats", group: "Commands", label: "Analyze ATS", icon: <Gauge className="h-4 w-4" />, run: go("/ats") },
    { id: "c-new", group: "Commands", label: "Create tailored resume", icon: <Wand2 className="h-4 w-4" />, run: go("/resume-lab/new") },
    { id: "c-cover", group: "Commands", label: "Open cover letters", icon: <FileText className="h-4 w-4" />, run: go("/cover-letters") },
    { id: "c-apps", group: "Commands", label: "Open applications", icon: <LayoutList className="h-4 w-4" />, run: go("/applications") },
    { id: "c-analytics", group: "Commands", label: "Show analytics", icon: <Target className="h-4 w-4" />, run: go("/analytics") },
    {
      id: "c-theme",
      group: "Commands",
      label: "Toggle light / dark theme",
      icon: <Moon className="h-4 w-4" />,
      run: () => {
        toggleTheme();
        onClose();
      },
    },
  ];
  const nav: Item[] = ALL_NAV.map((n) => ({ id: `n-${n.href}`, group: "Go to", label: n.label, icon: <n.icon className="h-4 w-4" />, keywords: n.keywords, run: go(n.href) }));

  let items: Item[];
  if (!debounced) {
    items = [...commands, ...nav.slice(0, 8)];
  } else {
    const d = debounced;
    items = [
      ...(jobs.data?.jobs ?? []).map((j) => ({
        id: `j-${j.id}`,
        group: `Jobs`,
        label: j.title,
        hint: `${j.company}${j.match ? ` · ${Math.round(j.match.overall_score)} match` : ""}`,
        icon: <Briefcase className="h-4 w-4" />,
        run: go(`/jobs/${j.id}`),
      })),
      ...(insights.data?.companies ?? [])
        .filter((c) => matches(d, c.company))
        .slice(0, 4)
        .map((c) => ({ id: `co-${c.company}`, group: "Companies", label: c.company, hint: `${c.open_roles} open · ${c.matching_roles} matching`, icon: <Building2 className="h-4 w-4" />, run: go(`/jobs?company=${encodeURIComponent(c.company)}`) })),
      ...(apps.data?.applications ?? [])
        .filter((a) => matches(d, a.job?.title, a.job?.company, a.status))
        .slice(0, 4)
        .map((a) => ({ id: `a-${a.id}`, group: "Applications", label: `${a.job?.title ?? "Application"}`, hint: `${a.job?.company ?? ""} · ${a.status.toLowerCase().replace(/_/g, " ")}`, icon: <LayoutList className="h-4 w-4" />, run: go(`/applications/${a.id}`) })),
      ...(versions.data?.versions ?? [])
        .filter((v) => matches(d, v.label, v.job_title, v.company, `v${v.version_number}`, v.version_type === "MASTER" ? "base master resume" : "tailored resume"))
        .slice(0, 4)
        .map((v) => ({ id: `v-${v.id}`, group: "Resumes", label: v.label ?? `Version ${v.version_number}`, hint: v.version_type === "MASTER" ? "Base resume" : `Tailored · ${v.company ?? ""}`, icon: <FileText className="h-4 w-4" />, run: go(`/resume-lab/${v.id}`) })),
      ...(insights.data?.market_skills.skills ?? [])
        .filter((s) => matches(d, s.skill))
        .slice(0, 3)
        .map((s) => ({ id: `s-${s.skill}`, group: "Skills", label: s.skill, hint: `Asked for in ${s.postings} of your postings · you have it: ${s.you_have ? "Yes" : "No"}`, icon: <Target className="h-4 w-4" />, run: go(`/jobs?skill=${encodeURIComponent(s.skill)}`) })),
      ...[...commands, ...nav].filter((c) => matches(d, c.label, c.keywords, c.hint)),
    ];
  }

  React.useEffect(() => setCursor(0), [debounced]);
  const clamp = Math.min(cursor, Math.max(0, items.length - 1));
  const active = items[clamp];

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(items.length - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter" && active) {
      e.preventDefault();
      void active.run();
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  React.useEffect(() => {
    document.getElementById(`${listId}-${clamp}`)?.scrollIntoView({ block: "nearest" });
  }, [clamp, listId]);

  const groups: [string, (Item & { index: number })[]][] = [];
  items.forEach((it, index) => {
    const g = groups.find(([name]) => name === it.group);
    if (g) g[1].push({ ...it, index });
    else groups.push([it.group, [{ ...it, index }]]);
  });

  return createPortal(
    <div className="fixed inset-0 z-[75] flex items-start justify-center px-3 pt-[12vh]" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-black/60 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div role="dialog" aria-modal="true" aria-label="Search JobPilot" className="relative w-full max-w-xl animate-rise overflow-hidden rounded-2xl border border-border bg-elevated shadow-float">
        <div className="flex items-center gap-3 border-b border-border px-4">
          <Search className="h-4 w-4 text-muted" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            placeholder="Search jobs, companies, applications, resumes, skills, commands…"
            className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={active ? `${listId}-${clamp}` : undefined}
            aria-autocomplete="list"
          />
          <kbd className="rounded border border-border-strong px-1.5 py-0.5 font-mono text-[11px] text-muted">Esc</kbd>
        </div>
        <div id={listId} role="listbox" className="scrollbar-thin max-h-[55vh] overflow-y-auto p-2">
          {items.length === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted">{jobs.isFetching ? "Searching…" : `No results for “${debounced}”.`}</p>
          )}
          {groups.map(([name, list]) => (
            <div key={name} className="mb-1">
              <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-muted">
                {name} {debounced && name !== "Commands" && name !== "Go to" ? `(${list.length})` : ""}
              </div>
              {list.map((it) => (
                <div
                  key={it.id}
                  id={`${listId}-${it.index}`}
                  role="option"
                  aria-selected={it.index === clamp}
                  onMouseMove={() => setCursor(it.index)}
                  onClick={() => void it.run()}
                  className={cn("flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm", it.index === clamp ? "bg-hover text-foreground" : "text-subtle")}
                >
                  <span className={it.index === clamp ? "text-primary" : "text-muted"}>{it.icon}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {it.label}
                    {it.hint && <span className="ml-2 text-xs text-muted">{it.hint}</span>}
                  </span>
                  {it.index === clamp && <CornerDownLeft className="h-3.5 w-3.5 text-muted" aria-hidden />}
                </div>
              ))}
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 border-t border-border px-4 py-2 text-[11px] text-muted">
          <span>↑↓ to navigate</span>
          <span>↵ to open</span>
          <span>Ctrl K to toggle</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
