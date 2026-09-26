export type Theme = "dark" | "light";

export function currentTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
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

export function toggleTheme(): void {
  setTheme(currentTheme() === "dark" ? "light" : "dark");
}
