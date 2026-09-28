/** "comfort" is a warm, dim, low-blue-light theme for night / low-light use. */
export type Theme = "dark" | "light" | "comfort";

export const THEMES: readonly Theme[] = ["light", "dark", "comfort"];

const isTheme = (v: unknown): v is Theme => typeof v === "string" && (THEMES as readonly string[]).includes(v);

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  const t = document.documentElement.dataset.theme;
  return isTheme(t) ? t : "dark";
}

export function setTheme(t: Theme): void {
  document.documentElement.dataset.theme = t;
  try {
    window.localStorage.setItem("jobpilot.theme", t);
  } catch {
    /* storage unavailable: theme still applies for this page view */
  }
  window.dispatchEvent(new Event("jobpilot:theme"));
}

/** Cycles Light → Dark → Eye comfort → Light. */
export function toggleTheme(): void {
  setTheme(THEMES[(THEMES.indexOf(currentTheme()) + 1) % THEMES.length]!);
}
