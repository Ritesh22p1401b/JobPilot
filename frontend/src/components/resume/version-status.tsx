import { Badge, type Tone } from "@/components/ui";
import { humanize } from "@/lib/utils";

const STATUS: Record<string, { tone: Tone; symbol: string; label: string }> = {
  APPROVED: { tone: "success", symbol: "✓", label: "Approved" },
  DRAFT: { tone: "warning", symbol: "◐", label: "Needs review" },
  NEEDS_REVIEW: { tone: "warning", symbol: "⚠", label: "Needs review" },
  REJECTED: { tone: "danger", symbol: "✕", label: "Rejected" },
};

export function VersionStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? { tone: "neutral" as Tone, symbol: "·", label: humanize(status) };
  return (
    <Badge tone={s.tone}>
      <span aria-hidden>{s.symbol}</span> {s.label}
    </Badge>
  );
}
