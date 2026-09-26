"use client";

import { Plus, X } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

/** Tag-style list input: type and press Enter or comma; Backspace on empty removes the last chip. */
export function ChipsInput({
  value,
  onChange,
  placeholder,
  suggestions = [],
  id,
  ariaLabel,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  suggestions?: string[];
  id?: string;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = React.useState("");
  const add = (raw: string) => {
    const items = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (items.length) onChange([...value, ...items]);
    setDraft("");
  };
  const remaining = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase())).slice(0, 8);
  return (
    <div>
      <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-elevated px-2 py-1.5 focus-within:border-primary focus-within:ring-4 focus-within:ring-ring">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 rounded-md bg-hover py-0.5 pr-1 pl-2 text-[13px]">
            {v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="rounded p-0.5 text-muted hover:text-foreground" aria-label={`Remove ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          aria-label={ariaLabel}
          value={draft}
          onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? "" : placeholder}
          className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted"
        />
      </div>
      {remaining.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">Suggested:</span>
          {remaining.map((s) => (
            <button key={s} type="button" onClick={() => onChange([...value, s])} className={cn("inline-flex items-center gap-1 rounded-full border border-dashed border-border-strong px-2.5 py-0.5 text-xs text-subtle hover:border-primary hover:text-foreground")}>
              <Plus className="h-3 w-3" aria-hidden /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
