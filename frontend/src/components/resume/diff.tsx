"use client";

import type { z } from "zod";

import { Badge, Segmented, YesNo } from "@/components/ui";
import type * as S from "@/lib/schemas";
import { cn, humanize } from "@/lib/utils";
import { useState } from "react";

type Change = z.infer<typeof S.Change>;

/** Git-style before/after view of AI changes (spec §24). Nothing is hidden: every change is listed. */
export function ResumeDiff({ changes, counts }: { changes: Change[]; counts: Record<string, number> }) {
  const [filter, setFilter] = useState<"all" | "ADDED" | "REWRITTEN" | "REMOVED" | "REORDERED">("all");
  const shown = filter === "all" ? changes : changes.filter((c) => c.type === filter);
  if (!changes.length) return <p className="text-sm text-muted">No differences.</p>;
  return (
    <div>
      <Segmented
        label="Filter changes"
        size="sm"
        value={filter}
        onChange={setFilter}
        options={[
          { id: "all", label: `All (${changes.length})` },
          { id: "REWRITTEN", label: `Modified (${counts.REWRITTEN ?? 0})` },
          { id: "ADDED", label: `Added (${counts.ADDED ?? 0})` },
          { id: "REMOVED", label: `Removed (${counts.REMOVED ?? 0})` },
          { id: "REORDERED", label: `Reordered (${counts.REORDERED ?? 0})` },
        ]}
      />
      <ul className="mt-4 space-y-2.5">
        {shown.map((c, i) => (
          <li key={i} className="overflow-hidden rounded-lg border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-elevated/60 px-3 py-1.5 text-xs">
              <span className="flex items-center gap-2">
                <Badge tone={c.type === "ADDED" ? "success" : c.type === "REMOVED" ? "danger" : c.type === "REWRITTEN" ? "primary" : "neutral"}>
                  {c.type === "REWRITTEN" ? "Modified" : humanize(c.type)}
                </Badge>
                <span className="text-muted">{humanize(c.section)}</span>
              </span>
              {c.type !== "REMOVED" && c.type !== "REORDERED" && (
                <span className="flex items-center gap-1.5 text-muted">
                  Verified against base resume <YesNo value={c.verified} />
                </span>
              )}
            </div>
            <div className="font-mono text-[12.5px] leading-relaxed">
              {c.original && c.type !== "ADDED" && (
                <div className={cn("flex gap-2 px-3 py-1.5", c.type === "REORDERED" ? "text-subtle" : "bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] text-foreground")}>
                  <span className={cn("select-none", c.type === "REORDERED" ? "text-muted" : "text-danger")} aria-hidden>
                    {c.type === "REORDERED" ? "↕" : "−"}
                  </span>
                  <span className="sr-only">{c.type === "REORDERED" ? "Moved:" : "Removed:"}</span>
                  <span className="whitespace-pre-wrap">{c.original}</span>
                </div>
              )}
              {c.new && c.type !== "REMOVED" && c.type !== "REORDERED" && (
                <div className="flex gap-2 bg-[color-mix(in_oklab,var(--success)_10%,transparent)] px-3 py-1.5">
                  <span className="select-none text-success" aria-hidden>
                    +
                  </span>
                  <span className="sr-only">Added:</span>
                  <span className="whitespace-pre-wrap">{c.new}</span>
                </div>
              )}
            </div>
            {(c.detail || c.evidence_source) && (
              <div className="border-t border-border px-3 py-1.5 text-xs text-muted">
                {c.detail}
                {c.evidence_source && <span> · Evidence: {c.evidence_source}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
