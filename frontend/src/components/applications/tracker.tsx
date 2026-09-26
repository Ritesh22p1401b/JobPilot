"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUpDown, Columns3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import type { z } from "zod";

import { Badge, Button, ScoreBadge, Select, Table, Td, Th } from "@/components/ui";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import * as S from "@/lib/schemas";
import type { Application } from "@/lib/schemas";
import { cn, daysSince, fmtDate, fmtSalary } from "@/lib/utils";

import { COLUMNS, FOLLOW_UP_DAYS, MANUAL_STATUSES, nextAction, statusOf } from "./model";

type AppList = z.infer<typeof S.ApplicationList>;

/** Status change with an optimistic update (spec §71) and rollback on failure. */
export function useStatusUpdate() {
  const qc = useQueryClient();
  const toast = useToast();
  return async (ids: string[], status: string) => {
    const prev = qc.getQueryData<AppList>(["applications"]);
    if (prev) qc.setQueryData<AppList>(["applications"], { ...prev, applications: prev.applications.map((a) => (ids.includes(a.id) ? { ...a, status } : a)) });
    try {
      await Promise.all(ids.map((id) => api(S.Application, "PATCH", `/applications/${id}`, { status })));
      toast({ tone: "success", title: ids.length > 1 ? `${ids.length} applications moved to ${statusOf(status).label}` : `Moved to ${statusOf(status).label}` });
    } catch (e) {
      if (prev) qc.setQueryData(["applications"], prev);
      toast({ tone: "error", title: "Couldn’t update status", body: errorText(e) });
    } finally {
      for (const k of [["applications"], ["insights"], ["dashboard"]]) void qc.invalidateQueries({ queryKey: k });
    }
  };
}

export function StatusBadge({ status }: { status: string }) {
  const s = statusOf(status);
  return (
    <Badge tone={s.tone}>
      <span aria-hidden>{s.symbol}</span> {s.label}
    </Badge>
  );
}

function versionLabel(a: Application, versions: Map<string, z.infer<typeof S.Version>>): string | null {
  const v = a.resume_version_id ? versions.get(a.resume_version_id) : undefined;
  if (!v) return null;
  return v.version_type === "MASTER" ? "Base resume" : v.label ?? `Tailored v${v.version_number}`;
}

// ------------------------------------------------------------------ Kanban
function KanbanCard({ a, versions, onMove }: { a: Application; versions: Map<string, z.infer<typeof S.Version>>; onMove: (status: string) => void }) {
  const next = nextAction(a);
  const resume = versionLabel(a, versions);
  return (
    <article
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", a.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group cursor-grab rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong active:cursor-grabbing"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={`/applications/${a.id}`} className="line-clamp-2 text-[13px] leading-snug font-medium hover:text-primary">
            {a.job?.title ?? "Application"}
          </Link>
          <div className="truncate text-xs text-subtle">{a.job?.company}</div>
        </div>
        <ScoreBadge score={a.job?.match?.overall_score} suffix="%" />
      </div>
      <div className="mt-2.5 space-y-1 text-[11px] text-muted">
        {a.applied_at ? <div>Applied {fmtDate(a.applied_at)}</div> : <div>Saved {fmtDate(a.created_at)}</div>}
        {resume && <div className="truncate">Resume: {resume}</div>}
      </div>
      <div className={cn("mt-2 text-xs font-medium", next.urgent ? "text-warning" : "text-subtle")}>Next: {next.label}</div>
      <label className="mt-2 block">
        <span className="sr-only">Move {a.job?.title} to</span>
        <select
          value=""
          onChange={(e) => e.target.value && onMove(e.target.value)}
          className="h-7 w-full rounded-md border border-border bg-elevated px-1.5 text-[11px] text-subtle opacity-70 focus:opacity-100 group-hover:opacity-100"
        >
          <option value="">Move to…</option>
          {MANUAL_STATUSES.filter((s) => s !== a.status && s !== "READY").map((s) => (
            <option key={s} value={s}>
              {statusOf(s).label}
            </option>
          ))}
        </select>
      </label>
    </article>
  );
}

export function KanbanBoard({ apps, versions }: { apps: Application[]; versions: Map<string, z.infer<typeof S.Version>> }) {
  const update = useStatusUpdate();
  const [over, setOver] = useState<string | null>(null);
  const toast = useToast();
  return (
    <div className="scrollbar-thin relative -mx-4 overflow-x-auto px-4 pb-3 md:-mx-8 md:px-8">
      <div className="flex min-w-max gap-3">
        {COLUMNS.map((col) => {
          const cards = apps.filter((a) => col.statuses.includes(a.status));
          return (
            <section
              key={col.id}
              aria-label={`${col.label} (${cards.length})`}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(col.id);
              }}
              onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
              onDrop={(e) => {
                e.preventDefault();
                setOver(null);
                const id = e.dataTransfer.getData("text/plain");
                const app = apps.find((a) => a.id === id);
                if (!app || col.statuses.includes(app.status)) return;
                if (!col.drop) {
                  toast({ tone: "info", title: "Use Prepare application", body: "Applications enter Preparing when the Application Agent drafts them for your review." });
                  return;
                }
                void update([id], col.drop);
              }}
              className={cn("flex w-[272px] shrink-0 flex-col rounded-xl border bg-elevated/40 transition-colors", over === col.id ? (col.drop ? "border-primary bg-hover" : "border-danger") : "border-border")}
            >
              <header className="flex items-center justify-between px-3 py-2.5">
                <span className="flex items-center gap-2 text-[12px] font-semibold tracking-wider text-subtle uppercase">
                  <span aria-hidden>{statusOf(col.statuses[0]!).symbol}</span> {col.label}
                </span>
                <span className="tabular rounded bg-hover px-1.5 text-[11px] text-muted">{cards.length}</span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {cards.map((a) => (
                  <KanbanCard key={a.id} a={a} versions={versions} onMove={(s) => void update([a.id], s)} />
                ))}
                {!cards.length && <p className="px-2 py-4 text-center text-xs text-muted">{col.drop ? "Drop here" : "Prepared applications appear here"}</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Table
type ColKey = "company" | "role" | "match" | "ats" | "status" | "salary" | "saved" | "applied" | "followup" | "resume" | "next";
const TABLE_COLS: { key: ColKey; label: string; sortable?: boolean }[] = [
  { key: "company", label: "Company", sortable: true },
  { key: "role", label: "Role", sortable: true },
  { key: "match", label: "Match", sortable: true },
  { key: "ats", label: "ATS", sortable: true },
  { key: "status", label: "Status", sortable: true },
  { key: "salary", label: "Salary" },
  { key: "saved", label: "Date saved", sortable: true },
  { key: "applied", label: "Date applied", sortable: true },
  { key: "followup", label: "Follow-up" },
  { key: "resume", label: "Resume" },
  { key: "next", label: "Next action" },
];

export function ApplicationsTable({ apps, versions }: { apps: Application[]; versions: Map<string, z.infer<typeof S.Version>> }) {
  const update = useStatusUpdate();
  const confirm = useConfirm();
  const [sort, setSort] = useState<{ key: ColKey; dir: 1 | -1 }>({ key: "saved", dir: -1 });
  const [hidden, setHidden] = useState<Set<ColKey>>(new Set(["salary", "ats"]));
  const [dense, setDense] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState("");
  const [showCols, setShowCols] = useState(false);
  const colsRef = useRef<HTMLDivElement>(null);

  const val = (a: Application, k: ColKey): string | number => {
    const v = a.resume_version_id ? versions.get(a.resume_version_id) : undefined;
    return {
      company: a.job?.company ?? "",
      role: a.job?.title ?? "",
      match: a.job?.match?.overall_score ?? -1,
      ats: v?.quality_index ?? -1,
      status: statusOf(a.status).label,
      salary: a.job?.salary_max ?? a.job?.salary_min ?? -1,
      saved: a.created_at ?? "",
      applied: a.applied_at ?? "",
      followup: "",
      resume: "",
      next: "",
    }[k];
  };
  const rows = useMemo(
    () => [...apps].sort((x, y) => (val(x, sort.key) > val(y, sort.key) ? 1 : val(x, sort.key) < val(y, sort.key) ? -1 : 0) * sort.dir),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- val depends only on versions
    [apps, sort, versions],
  );
  const cols = TABLE_COLS.filter((c) => !hidden.has(c.key));
  const cell = dense ? "py-1.5" : "py-3";
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));

  const applyBulk = async () => {
    if (!bulk || !selected.size) return;
    const ok = await confirm({ title: `Move ${selected.size} application${selected.size === 1 ? "" : "s"} to ${statusOf(bulk).label}?`, body: "Each change is recorded in the application’s audit trail.", confirmLabel: "Move" });
    if (!ok) return;
    await update([...selected], bulk);
    setSelected(new Set());
    setBulk("");
  };

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2 text-[13px]">
          {selected.size > 0 ? (
            <>
              <span className="text-subtle">{selected.size} selected</span>
              <Select value={bulk} onChange={(e) => setBulk(e.target.value)} aria-label="Bulk status" className="w-44">
                <option value="">Change status…</option>
                {MANUAL_STATUSES.filter((s) => s !== "READY").map((s) => (
                  <option key={s} value={s}>
                    {statusOf(s).label}
                  </option>
                ))}
              </Select>
              <Button size="sm" onClick={applyBulk} disabled={!bulk}>
                Apply
              </Button>
            </>
          ) : (
            <span className="text-muted">{rows.length} applications</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setDense(!dense)} aria-pressed={dense}>
            {dense ? "Comfortable" : "Compact"}
          </Button>
          <div className="relative" ref={colsRef}>
            <Button variant="ghost" size="sm" onClick={() => setShowCols(!showCols)} aria-expanded={showCols}>
              <Columns3 className="h-3.5 w-3.5" /> Columns
            </Button>
            {showCols && (
              <div className="absolute right-0 z-20 mt-1 w-48 rounded-xl border border-border bg-elevated p-2 shadow-float">
                {TABLE_COLS.map((c) => (
                  <label key={c.key} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-hover">
                    <input
                      type="checkbox"
                      checked={!hidden.has(c.key)}
                      onChange={() => {
                        const h = new Set(hidden);
                        if (h.has(c.key)) h.delete(c.key);
                        else h.add(c.key);
                        setHidden(h);
                      }}
                      className="accent-[var(--primary)]"
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <Th className="w-9">
              <input type="checkbox" aria-label="Select all" checked={allSelected} onChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} className="accent-[var(--primary)]" />
            </Th>
            {cols.map((c) => (
              <Th key={c.key} aria-sort={sort.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : undefined}>
                {c.sortable ? (
                  <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? (sort.dir === 1 ? -1 : 1) : -1 })}>
                    {c.label} <ArrowUpDown className="h-3 w-3" aria-hidden />
                  </button>
                ) : (
                  c.label
                )}
              </Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const v = a.resume_version_id ? versions.get(a.resume_version_id) : undefined;
            const next = nextAction(a);
            const since = daysSince(a.applied_at);
            return (
              <tr key={a.id} className={cn("hover:bg-hover/40", selected.has(a.id) && "bg-hover/60")}>
                <Td className={cell}>
                  <input
                    type="checkbox"
                    aria-label={`Select ${a.job?.title}`}
                    checked={selected.has(a.id)}
                    onChange={() => {
                      const s = new Set(selected);
                      if (s.has(a.id)) s.delete(a.id);
                      else s.add(a.id);
                      setSelected(s);
                    }}
                    className="accent-[var(--primary)]"
                  />
                </Td>
                {cols.map((c) => (
                  <Td key={c.key} className={cn(cell, "whitespace-nowrap")}>
                    {c.key === "company" && <span className="font-medium">{a.job?.company}</span>}
                    {c.key === "role" && (
                      <Link href={`/applications/${a.id}`} className="hover:text-primary">
                        {a.job?.title}
                      </Link>
                    )}
                    {c.key === "match" && <ScoreBadge score={a.job?.match?.overall_score} />}
                    {c.key === "ats" && <ScoreBadge score={v?.quality_index} />}
                    {c.key === "status" && <StatusBadge status={a.status} />}
                    {c.key === "salary" && <span className="text-subtle">{fmtSalary(a.job?.salary_min, a.job?.salary_max, a.job?.currency) ?? "—"}</span>}
                    {c.key === "saved" && <span className="text-subtle">{fmtDate(a.created_at)}</span>}
                    {c.key === "applied" && <span className="text-subtle">{fmtDate(a.applied_at)}</span>}
                    {c.key === "followup" &&
                      (a.status === "APPLIED" && since !== null ? (
                        since >= FOLLOW_UP_DAYS ? <Badge tone="warning">Due now</Badge> : <span className="text-subtle">in {FOLLOW_UP_DAYS - since} d</span>
                      ) : (
                        <span className="text-muted">—</span>
                      ))}
                    {c.key === "resume" && <span className="text-subtle">{versionLabel(a, versions) ?? "—"}</span>}
                    {c.key === "next" && <span className={next.urgent ? "text-warning" : "text-subtle"}>{next.label}</span>}
                  </Td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}
