"use client";

import { Check, Circle, X } from "lucide-react";

import { Spinner } from "@/components/ui";
import type { TaskTracker } from "@/lib/hooks";
import { cn } from "@/lib/utils";

export interface PipelineStep {
  event: string;
  label: string;
}

/** The event chains the backend actually runs (see backend/app/events/handlers.py). */
export const PIPELINES = {
  search: [
    { event: "discovery.requested", label: "Searching public job boards" },
    { event: "jobs.collected", label: "Normalizing and removing duplicates" },
    { event: "jobs.normalized", label: "Mapping resume evidence and scoring matches" },
    { event: "matches.computed", label: "Writing explanations and alerts" },
  ],
  tailor: [
    { event: "resume.tailor_requested", label: "Selecting evidence from your base resume" },
    { event: "resume.version_created", label: "Testing the tailored version (round-trip parsing, ATS checks)" },
  ],
  prepare: [{ event: "application.prepare_requested", label: "Tailoring resume, writing cover letter, drafting answers" }],
  onboarding: [
    { event: "resume.uploaded", label: "Testing how parsers read your resume" },
    { event: "profile.updated", label: "Scoring known jobs against your profile" },
  ],
  match: [{ event: "profile.updated", label: "Re-scoring jobs against your profile" }],
} satisfies Record<string, PipelineStep[]>;

type StepState = "done" | "active" | "pending" | "failed";

function stateOf(steps: PipelineStep[], t: TaskTracker): StepState[] {
  if (t.done) return steps.map(() => (t.failed ? "failed" : "done"));
  const activeIdx = steps.map((s, i) => (t.activeTypes.includes(s.event) ? i : -1)).filter((i) => i >= 0);
  const furthest = activeIdx.length ? Math.max(...activeIdx) : steps.findIndex((s) => !t.seenTypes.has(s.event));
  const cursor = furthest < 0 ? steps.length - 1 : furthest;
  return steps.map((s, i) => (i < cursor ? "done" : i === cursor ? "active" : "pending"));
}

/** Premium processing indicator (spec §55) backed by real task states. */
export function AIThinking({ tracker, steps, title, className }: { tracker: TaskTracker; steps: PipelineStep[]; title: string; className?: string }) {
  const states = stateOf(steps, tracker);
  return (
    <div className={cn("rounded-xl border ai-border ai-gradient bg-surface p-4", className)} role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-primary" aria-hidden>
          ✦
        </span>
        JobPilot AI
      </div>
      <p className="mt-1 text-sm text-subtle">{title}</p>
      <ol className="mt-3 space-y-1.5">
        {steps.map((s, i) => {
          const st = states[i];
          return (
            <li key={s.event} className={cn("flex items-center gap-2.5 text-[13px]", st === "pending" ? "text-muted" : "text-foreground")}>
              <span className="grid h-4 w-4 place-items-center" aria-hidden>
                {st === "done" && <Check className="h-4 w-4 text-success" />}
                {st === "active" && <Spinner className="h-3.5 w-3.5 text-primary" />}
                {st === "pending" && <Circle className="h-3 w-3" />}
                {st === "failed" && <X className="h-4 w-4 text-danger" />}
              </span>
              {s.label}
              <span className="sr-only">{st === "done" ? "(done)" : st === "active" ? "(in progress)" : st === "failed" ? "(failed)" : "(waiting)"}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
