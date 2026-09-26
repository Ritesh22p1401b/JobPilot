"use client";

import { Columns3, LayoutList, Search, Table2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import { statusOf } from "@/components/applications/model";
import { ApplicationsTable, KanbanBoard } from "@/components/applications/tracker";
import { RequireProfile } from "@/components/layout/require-profile";
import { ButtonLink, EmptyState, ErrorState, Input, PageHeader, PageSkeleton, Segmented } from "@/components/ui";
import { useApplications, useLocalPref, useVersions } from "@/lib/hooks";

function Tracker() {
  const apps = useApplications();
  const versions = useVersions();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [view, setView] = useLocalPref<"board" | "table">("tracker-view", "board");
  const [q, setQ] = useState("");
  const status = params.get("status");

  const vmap = useMemo(() => new Map((versions.data?.versions ?? []).map((v) => [v.id, v])), [versions.data]);
  const all = apps.data?.applications ?? [];
  const shown = all.filter((a) => (!status || a.status === status) && (!q || `${a.job?.title} ${a.job?.company}`.toLowerCase().includes(q.toLowerCase())));

  if (apps.isLoading) return <PageSkeleton />;
  if (apps.error) return <ErrorState error={apps.error} onRetry={() => apps.refetch()} />;

  return (
    <>
      <PageHeader
        title="Application Tracker"
        description="Every application from saved to offer. Drag cards between columns, or use each card’s Move menu. Every change is recorded in the application’s timeline."
        action={
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { id: "board", label: "Kanban", icon: <Columns3 className="h-4 w-4" /> },
              { id: "table", label: "Table", icon: <Table2 className="h-4 w-4" /> },
            ]}
          />
        }
      />
      {all.length === 0 ? (
        <EmptyState icon={<LayoutList className="h-5 w-5" />} title="No applications yet" action={<ButtonLink href="/matches">Find high-match jobs</ButtonLink>}>
          Start by finding a high-match job, then save it or prepare an application.
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="absolute top-2.5 left-3 h-4 w-4 text-muted" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search role or company" className="pl-9" aria-label="Search applications" />
            </div>
            {status && (
              <button onClick={() => router.replace(pathname)} className="inline-flex items-center gap-1 rounded-full border border-border bg-elevated px-2.5 py-1 text-xs text-subtle hover:border-border-strong">
                Status: {statusOf(status).label} <X className="h-3 w-3" aria-label="Clear status filter" />
              </button>
            )}
            <span className="text-xs text-muted">
              {shown.length} of {all.length}
            </span>
          </div>
          {view === "board" ? (
            <KanbanBoard apps={shown} versions={vmap} />
          ) : (
            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <ApplicationsTable apps={shown} versions={vmap} />
            </div>
          )}
        </>
      )}
    </>
  );
}

export default function ApplicationsPage() {
  return (
    <RequireProfile title="Application Tracker">
      <Suspense fallback={<PageSkeleton />}>
        <Tracker />
      </Suspense>
    </RequireProfile>
  );
}
