import type { Tone } from "@/components/ui";
import type { Application, Profile, VersionDetail } from "@/lib/schemas";
import { daysSince } from "@/lib/utils";

export const STATUS: Record<string, { label: string; tone: Tone; symbol: string }> = {
  SAVED: { label: "Saved", tone: "neutral", symbol: "♡" },
  APPROVAL_REQUIRED: { label: "Needs your input", tone: "warning", symbol: "⚠" },
  READY: { label: "Ready to submit", tone: "primary", symbol: "●" },
  APPLIED: { label: "Applied", tone: "info", symbol: "↗" },
  ASSESSMENT: { label: "Assessment", tone: "info", symbol: "◇" },
  INTERVIEW: { label: "Interview", tone: "success", symbol: "◉" },
  OFFER: { label: "Offer", tone: "success", symbol: "★" },
  REJECTED: { label: "Rejected", tone: "danger", symbol: "✕" },
  WITHDRAWN: { label: "Withdrawn", tone: "neutral", symbol: "–" },
};
export const statusOf = (s: string) => STATUS[s] ?? { label: s, tone: "neutral" as Tone, symbol: "·" };

/** Statuses a user may set by hand (mirrors MANUAL_TRANSITIONS in backend/app/api/applications.py). */
export const MANUAL_STATUSES = ["SAVED", "READY", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"];

export interface Column {
  id: string;
  label: string;
  statuses: string[];
  /** Status set when a card is dropped here; null = can't drop (reached only through the agent). */
  drop: string | null;
}

export const COLUMNS: Column[] = [
  { id: "saved", label: "Saved", statuses: ["SAVED"], drop: "SAVED" },
  { id: "preparing", label: "Preparing", statuses: ["APPROVAL_REQUIRED", "READY"], drop: null },
  { id: "applied", label: "Applied", statuses: ["APPLIED"], drop: "APPLIED" },
  { id: "assessment", label: "Assessment", statuses: ["ASSESSMENT"], drop: "ASSESSMENT" },
  { id: "interview", label: "Interview", statuses: ["INTERVIEW"], drop: "INTERVIEW" },
  { id: "offer", label: "Offer", statuses: ["OFFER"], drop: "OFFER" },
  { id: "rejected", label: "Rejected", statuses: ["REJECTED"], drop: "REJECTED" },
  { id: "withdrawn", label: "Withdrawn", statuses: ["WITHDRAWN"], drop: "WITHDRAWN" },
];

export const FOLLOW_UP_DAYS = 7;

export function isPrepared(a: Application): boolean {
  return a.answers.length > 0 || !!a.cover_letter;
}

/** Application Agent state (spec §30): Not started → Waiting for you → Ready to submit → Submitted. */
export function agentState(a: Application, preparing = false): { label: string; tone: Tone; symbol: string } {
  if (preparing) return { label: "Preparing", tone: "primary", symbol: "✦" };
  const lastFailed = a.events?.slice().reverse().find((e) => e.action.startsWith("submission"));
  if (lastFailed?.action === "submission_validation_failed" && a.status === "APPROVAL_REQUIRED") return { label: "Failed — needs input", tone: "danger", symbol: "✕" };
  if (["APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER", "REJECTED", "WITHDRAWN"].includes(a.status)) return { label: "Submitted", tone: "success", symbol: "✓" };
  if (a.status === "READY") return { label: "Ready to submit", tone: "primary", symbol: "●" };
  if (a.status === "APPROVAL_REQUIRED") return { label: "Waiting for you", tone: "warning", symbol: "⚠" };
  return isPrepared(a) ? { label: "Review", tone: "warning", symbol: "◐" } : { label: "Not started", tone: "neutral", symbol: "○" };
}

export function unansweredRequired(a: Application): string[] {
  const pkg = a.package as { unanswered_required?: string[] };
  return pkg.unanswered_required ?? a.answers.filter((q) => q.required && !q.answer).map((q) => q.question);
}

export function nextAction(a: Application): { label: string; urgent?: boolean } {
  switch (a.status) {
    case "SAVED":
      return { label: isPrepared(a) ? "Review application" : "Prepare application" };
    case "APPROVAL_REQUIRED": {
      const n = unansweredRequired(a).length;
      return { label: n ? `Answer ${n} question${n === 1 ? "" : "s"}` : "Review & approve", urgent: true };
    }
    case "READY":
      return { label: "Submit on employer site", urgent: true };
    case "APPLIED": {
      const d = daysSince(a.applied_at);
      if (d === null) return { label: "Wait for a response" };
      return d >= FOLLOW_UP_DAYS ? { label: "Follow up now", urgent: true } : { label: `Follow up in ${FOLLOW_UP_DAYS - d} day${FOLLOW_UP_DAYS - d === 1 ? "" : "s"}` };
    }
    case "ASSESSMENT":
      return { label: "Complete the assessment" };
    case "INTERVIEW":
      return { label: "Prepare for the interview" };
    case "OFFER":
      return { label: "Review the offer" };
    default:
      return { label: "—" };
  }
}

export interface Check {
  id: string;
  label: string;
  done: boolean;
  detail?: string;
  /** Needs the user rather than the agent. */
  user?: boolean;
}

/** Spec §29 readiness checklist, computed from stored application data only. */
export function readiness(a: Application, version?: VersionDetail | null, profile?: Profile | null): { checks: Check[]; pct: number } {
  const missing = unansweredRequired(a);
  const c = profile?.contact;
  const checks: Check[] = [
    { id: "job", label: "Job analyzed", done: true, detail: "Requirements extracted from the description" },
    { id: "resume", label: "Resume selected", done: !!a.resume_version_id, detail: version ? `v${version.version_number} · ${version.label ?? version.version_type.toLowerCase()}` : undefined },
    { id: "tailored", label: "Resume tailored for this job", done: version?.version_type === "TAILORED" },
    { id: "ats", label: "ATS checked", done: version?.quality_index !== null && version?.quality_index !== undefined, detail: version?.quality_index ? `Quality index ${Math.round(version.quality_index)}` : undefined },
    { id: "cover", label: "Cover letter prepared", done: !!a.cover_letter },
    { id: "profile", label: "Profile information complete", done: !!(c?.name && c?.email), detail: c && !(c.name && c.email) ? "Add your name and email in Profile" : undefined, user: true },
    { id: "questions", label: "Application questions answered", done: a.answers.length > 0 && missing.length === 0, detail: a.answers.length ? (missing.length ? `${missing.length} still need your answer` : `${a.answers.length} answered`) : "Not detected yet", user: true },
    { id: "approval", label: "Approved by you", done: ["READY", "APPLIED", "ASSESSMENT", "INTERVIEW", "OFFER"].includes(a.status), detail: "Nothing is submitted without your approval", user: true },
  ];
  return { checks, pct: Math.round((100 * checks.filter((x) => x.done).length) / checks.length) };
}
