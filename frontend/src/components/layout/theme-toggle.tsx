"use client";

import { Eye, Moon, Sun } from "lucide-react";
import * as React from "react";

import { THEMES, currentTheme, setTheme, type Theme } from "@/lib/theme";
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

export const THEME_OPTIONS: Record<Theme, { label: string; hint: string; icon: typeof Moon; tone: string }> = {
  light: { label: "Light", hint: "Light theme", icon: Sun, tone: "text-warning" },
  dark: { label: "Dark", hint: "Dark theme", icon: Moon, tone: "text-primary" },
  comfort: { label: "Eye comfort", hint: "Eye comfort: warm, dim and low in blue light for night use", icon: Eye, tone: "text-primary" },
};

/** Light / Dark / Eye comfort switch. `compact` shows icons only (labels stay available to screen readers). */
export function ThemeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const theme = useThemeState();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: React.KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const i = (THEMES.indexOf(theme) + step + THEMES.length) % THEMES.length;
    setTheme(THEMES[i]!);
    refs.current[i]?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Color theme" onKeyDown={onKey} className={cn("inline-flex shrink-0 items-center rounded-lg border border-border bg-background p-0.5", className)}>
      {THEMES.map((value, i) => {
        const o = THEME_OPTIONS[value];
        const active = theme === value;
        const Icon = o.icon;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            title={o.hint}
            onClick={() => setTheme(value)}
            className={cn(
              "relative inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none",
              compact ? "h-7 w-7 justify-center" : "h-7 px-2.5",
              active ? "bg-surface text-foreground shadow-sm" : "text-muted hover:text-foreground",
            )}
          >
            <Icon className={cn("h-3.5 w-3.5", active && o.tone)} aria-hidden />
            <span className={compact ? "sr-only" : undefined}>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
