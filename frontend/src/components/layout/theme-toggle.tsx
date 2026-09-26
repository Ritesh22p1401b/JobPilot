"use client";

import { Moon, Sun } from "lucide-react";
import * as React from "react";

import { currentTheme, setTheme, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Current theme, kept in sync with every toggle on the page (they all dispatch `jobpilot:theme`). */
export function useThemeState(): Theme {
  const [t, setT] = React.useState<Theme>("dark");
  React.useEffect(() => {
    const sync = () => setT(currentTheme());
    sync();
    window.addEventListener("jobpilot:theme", sync);
    return () => window.removeEventListener("jobpilot:theme", sync);
  }, []);
  return t;
}

const OPTIONS: { value: Theme; label: string; icon: typeof Moon }[] = [
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

/** Two-state Dark / Light switch. `compact` shows icons only (labels stay available to screen readers). */
export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const theme = useThemeState();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    refs.current[OPTIONS.findIndex((o) => o.value === next)]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Color theme" onKeyDown={onKey} className={cn("inline-flex shrink-0 items-center rounded-lg border border-border bg-surface p-0.5", className)}>
      {OPTIONS.map((o, i) => {
        const active = theme === o.value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={`${o.label} theme`}
            onClick={() => setTheme(o.value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none",
              compact ? "h-7 w-7 justify-center" : "h-7 px-2.5",
              active ? "bg-elevated text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", active && (o.value === "dark" ? "text-primary" : "text-warning"))} aria-hidden />
            <span className={compact ? "sr-only" : undefined}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
