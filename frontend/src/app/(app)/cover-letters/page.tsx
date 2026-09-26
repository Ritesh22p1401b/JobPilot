"use client";

import { Copy, Mail } from "lucide-react";
import { useState } from "react";

import { StatusBadge } from "@/components/applications/tracker";
import { RequireProfile } from "@/components/layout/require-profile";
import { AIGenerated, Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useApplications } from "@/lib/hooks";
import { cn, fmtDate } from "@/lib/utils";

export default function CoverLettersPage() {
  const apps = useApplications();
  const toast = useToast();
  const list = (apps.data?.applications ?? []).filter((a) => a.cover_letter);
  const [active, setActive] = useState<string | null>(null);
  const current = list.find((a) => a.id === active) ?? list[0];

  return (
    <RequireProfile title="Cover Letters">
      <PageHeader title="Cover Letters" description="Every cover letter prepared for your applications. Each is built from your matched evidence and checked against your resume; edit them in the application workspace." />
      {apps.isLoading && <PageSkeleton rows={2} />}
      {apps.error && <ErrorState error={apps.error} onRetry={() => apps.refetch()} />}
      {apps.data &&
        (!list.length ? (
          <EmptyState icon={<Mail className="h-5 w-5" />} title="No cover letters yet" action={<ButtonLink href="/applications/agent">Open Application Agent</ButtonLink>}>
            Prepare an application and the agent writes a cover letter from your verified evidence.
          </EmptyState>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
            <Card className="overflow-hidden">
              <ul>
                {list.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => setActive(a.id)} className={cn("w-full border-b border-border px-4 py-3 text-left transition-colors last:border-0", current?.id === a.id ? "bg-hover shadow-[inset_2px_0_0_var(--primary)]" : "hover:bg-hover/60")}>
                      <div className="truncate text-sm font-medium">{a.job?.company}</div>
                      <div className="truncate text-xs text-subtle">{a.job?.title}</div>
                      <div className="mt-1 text-[11px] text-muted">Updated {fmtDate(a.updated_at)}</div>
                    </button>
                  </li>
                ))}
              </ul>
            </Card>
            {current && (
              <Card className="p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold">
                      {current.job?.company} — {current.job?.title}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusBadge status={current.status} />
                      {current.cover_letter_source === "llm" ? <AIGenerated /> : current.cover_letter_source === "user" ? <Badge tone="success">Edited by you</Badge> : <Badge>Template from your evidence</Badge>}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        void navigator.clipboard.writeText(current.cover_letter ?? "");
                        toast({ tone: "success", title: "Copied to clipboard" });
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" /> Copy
                    </Button>
                    <ButtonLink href={`/applications/${current.id}#step-cover`} size="sm">
                      Edit
                    </ButtonLink>
                  </div>
                </div>
                <div className="mt-5 rounded-xl border border-border bg-background p-6 text-sm leading-relaxed whitespace-pre-line text-subtle">{current.cover_letter}</div>
              </Card>
            )}
          </div>
        ))}
    </RequireProfile>
  );
}
