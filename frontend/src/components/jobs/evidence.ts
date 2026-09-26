import type { Tone } from "@/components/ui";

/** Evidence strength shown to users (spec §15). Always paired with a symbol + word, never colour alone. */
export interface Strength {
  label: string;
  symbol: string;
  tone: Tone;
  /** 0–100 bar length for the job↔resume comparison. */
  level: number;
}

export const STRENGTH: Record<string, Strength> = {
  SUPPORTED: { label: "Strong", symbol: "✓", tone: "success", level: 100 },
  SEMANTIC_MATCH: { label: "Moderate", symbol: "◐", tone: "primary", level: 70 },
  PARTIALLY_SUPPORTED: { label: "Weak", symbol: "◐", tone: "warning", level: 40 },
  RELATED_BUT_NOT_MATCH: { label: "Related only", symbol: "≈", tone: "warning", level: 20 },
  MISSING: { label: "Missing", symbol: "○", tone: "danger", level: 0 },
  UNKNOWN: { label: "Can’t tell", symbol: "?", tone: "neutral", level: 0 },
  CONFLICT: { label: "Conflict", symbol: "!", tone: "danger", level: 0 },
};

export const strengthOf = (status: string | null | undefined): Strength => STRENGTH[status ?? ""] ?? STRENGTH.UNKNOWN!;

export const COMPONENT_LABEL: Record<string, string> = {
  skill: "Technical skills",
  experience: "Experience",
  role: "Role & domain fit",
  seniority: "Seniority",
  education: "Education",
  location: "Location",
  preference: "Your preferences",
};
export const COMPONENT_ORDER = ["skill", "experience", "role", "seniority", "education", "location", "preference"];

export const TIER_LABEL: Record<string, string> = { REQUIRED: "Required", PREFERRED: "Preferred", NICE_TO_HAVE: "Nice to have", UNSPECIFIED: "Unspecified" };
export const TIER_ORDER: Record<string, number> = { REQUIRED: 0, PREFERRED: 1, NICE_TO_HAVE: 2, UNSPECIFIED: 3 };
