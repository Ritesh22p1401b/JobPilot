"use client";

import { useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RequireProfile } from "@/components/layout/require-profile";
import { Badge, Button, ButtonLink, Card, EmptyState, ErrorState, PageHeader, PageSkeleton } from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApplications, useInsights } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDate } from "@/lib/utils";

export default function FollowUpsPage() {
  const insights = useInsights();
  const apps = useApplications();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const markDone = async (appId: string) => {
    setBusy(appId);
    const existing = apps.data?.applications.find((a) => a.id === appId)?.notes ?? "";
    const line = `Followed up on ${new Date().toLocaleDateString()}.`;
    try {
      // Logging the follow-up adds an event, which resets the 7-day follow-up timer.
      await api(S.Application, "PATCH", `/applications/${appId}`, { notes: existing ? `${existing}\n${line}` : line });
      toast({ tone: "success", title: "Follow-up logged", body: "We’ll remind you again after 7 more days without activity." });
      for (const k of [["insights"], ["applications"]]) void qc.invalidateQueries({ queryKey: k });
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t log the follow-up", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  const due = insights.data?.follow_ups ?? [];
  return (
    <RequireProfile title="Follow-ups">
      <PageHeader title="Follow-ups" description="Applications with no activity for 7+ days since you applied. A short, polite follow-up often helps." />
      {insights.isLoading && <PageSkeleton rows={2} />}
      {insights.error && <ErrorState error={insights.error} onRetry={() => insights.refetch()} />}
      {insights.data &&
        (due.length ? (
          <div className="space-y-3">
            {due.map((f) => (
              <Card key={f.application_id} className="flex flex-wrap items-center justify-between gap-4 p-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{f.company}</span>
                    <Badge tone={f.days_since_activity >= 14 ? "danger" : "warning"}>
                      <CalendarClock className="h-3 w-3" aria-hidden /> Follow-up due · {f.days_since_activity} days quiet
                    </Badge>
                  </div>
                  <Link href={`/applications/${f.application_id}`} className="text-[13px] text-subtle hover:text-primary">
                    {f.title}
                  </Link>
                  <div className="text-xs text-muted">Applied {fmtDate(f.applied_at)}</div>
                </div>
                <div className="flex gap-2">
                  <ButtonLink href={`/applications/${f.application_id}`} variant="secondary" size="sm">
                    Open
                  </ButtonLink>
                  <Button size="sm" onClick={() => markDone(f.application_id)} loading={busy === f.application_id}>
                    <Check className="h-3.5 w-3.5" /> Mark followed up
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No follow-ups due">
            You’ll see applications here once they’ve had 7 days without a response.
          </EmptyState>
        ))}
    </RequireProfile>
  );
}
