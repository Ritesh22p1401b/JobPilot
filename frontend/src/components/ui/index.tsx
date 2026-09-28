/* JobPilot design-system primitives (Tailwind + CVA). */
"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, Check, ChevronDown, CircleDashed, Info, RotateCw, X } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ Button
export const buttonVariants = cva(
  "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-[background,color,border,box-shadow,transform] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
  {
    variants: {
      variant: {
        primary: "bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--primary-strong)_inset] hover:bg-primary-strong",
        secondary: "border border-border bg-elevated text-foreground hover:border-border-strong hover:bg-hover",
        ghost: "text-subtle hover:bg-hover hover:text-foreground",
        danger: "bg-danger text-danger-foreground hover:opacity-90",
        success: "bg-success text-success-foreground hover:opacity-90",
        ai: "border ai-border ai-gradient text-foreground hover:border-primary",
        link: "h-auto px-0 text-primary hover:underline",
      },
      size: { sm: "h-8 px-3 text-[13px]", md: "h-9 px-4", lg: "h-11 px-5 text-[15px]", icon: "h-8 w-8", "icon-sm": "h-7 w-7" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, loading, disabled, children, type = "button", ...props },
  ref,
) {
  return (
    <button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
      {loading && <Spinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  );
});

/** Internal navigation styled as a button (uses next/link). External URLs open in a new tab. */
export function ButtonLink({
  href,
  className,
  variant,
  size,
  children,
  external,
  ...rest
}: { href: string; external?: boolean; children: React.ReactNode; className?: string } & VariantProps<typeof buttonVariants> &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href">) {
  const cls = cn(buttonVariants({ variant, size }), className);
  if (external || /^https?:/.test(href))
    return (
      <a href={href} target="_blank" rel="noreferrer noopener" className={cls} {...rest}>
        {children}
      </a>
    );
  return (
    <Link href={href} className={cls} {...rest}>
      {children}
    </Link>
  );
}

// ------------------------------------------------------------------ Card
export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border border-border bg-surface", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-4 pb-3", className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && <span className="mt-0.5 text-primary">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-subtle">{description}</p>}
        </div>
      </div>
      {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
    </div>
  );
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}

export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("text-[11px] font-semibold uppercase tracking-[0.08em] text-muted", className)}>{children}</div>;
}

// ------------------------------------------------------------------ Badge / status
export type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info";

/** Literal class names so Tailwind can see them (dynamic `text-${tone}` would never be generated). */
export const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-subtle",
  primary: "text-primary",
  success: "text-success",
  warning: "text-warning",
  danger: "text-danger",
  info: "text-info",
};

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return <span className={cn(`tint-${tone}`, "inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1.5 py-0.5 text-xs font-medium", className)} {...props} />;
}

export function Chip({ children, tone = "neutral", icon, className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone; icon?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs",
        tone === "neutral" ? "border-border bg-elevated text-subtle" : `tint-${tone} border-transparent`,
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </span>
  );
}

/** Explicit Yes/No (never a bare check mark, never colour alone). */
export function YesNo({ value, unknownLabel = "Unknown" }: { value: boolean | null | undefined; unknownLabel?: string }) {
  if (value === null || value === undefined)
    return (
      <Badge>
        <CircleDashed className="h-3 w-3" aria-hidden /> {unknownLabel}
      </Badge>
    );
  return value ? (
    <Badge tone="success">
      <Check className="h-3 w-3" aria-hidden /> Yes
    </Badge>
  ) : (
    <Badge tone="danger">
      <X className="h-3 w-3" aria-hidden /> No
    </Badge>
  );
}

// ------------------------------------------------------------------ Form controls
const control =
  "w-full rounded-lg border border-border bg-elevated text-sm text-foreground outline-none transition-colors placeholder:text-muted hover:border-border-strong focus:border-primary focus:ring-4 focus:ring-ring disabled:opacity-50";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(control, "h-9 px-3", className)} {...props} />;
});

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(control, "px-3 py-2 leading-relaxed", className)} {...props} />;
});

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn("relative", className)}>
      <select className={cn(control, "h-9 appearance-none pr-8 pl-3")} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-2.5 right-2.5 h-4 w-4 text-muted" aria-hidden />
    </div>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  className,
  htmlFor,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={htmlFor} className="block text-[13px] font-medium text-foreground">
        {label}
      </label>
      {children}
      {error ? (
        <p className="flex items-center gap-1 text-xs text-danger" role="alert">
          <AlertTriangle className="h-3 w-3" aria-hidden /> {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
}) {
  const id = React.useId();
  return (
    <div className={cn("flex items-start justify-between gap-4", disabled && "opacity-55")}>
      <div>
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
        </label>
        {description && <p className="text-xs text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn("relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-track")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-[left]", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

/** Segmented control (view modes, small option sets). */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: React.ReactNode; icon?: React.ReactNode }[];
  label: string;
  size?: "sm" | "md";
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-lg border border-border bg-elevated p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md font-medium transition-colors",
            size === "sm" ? "px-2 py-1 text-xs" : "px-3 py-1.5 text-[13px]",
            value === o.id ? "bg-hover text-foreground shadow-sm" : "text-muted hover:text-foreground",
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Multi-select chips (work modes, employment types…). */
export function ChipGroup<T extends string>({
  options,
  value,
  onChange,
  label,
  format = (s) => s,
}: {
  options: readonly T[];
  value: T[];
  onChange: (v: T[]) => void;
  label: string;
  format?: (s: T) => string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button
            key={o}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] transition-colors",
              on ? "border-primary tint-primary" : "border-border text-subtle hover:border-border-strong hover:text-foreground",
            )}
          >
            {on && <Check className="h-3.5 w-3.5" aria-hidden />}
            {format(o)}
          </button>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ Feedback
export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4 animate-spin", className)} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton rounded-md", className)} aria-hidden />;
}

export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-4" aria-busy aria-label="Loading">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-20" />
      ))}
    </div>
  );
}

export function Callout({
  tone = "info",
  title,
  children,
  icon,
  action,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const border = {
    neutral: "border-border",
    primary: "border-[color-mix(in_oklab,var(--primary)_35%,var(--border))]",
    success: "border-[color-mix(in_oklab,var(--success)_35%,var(--border))]",
    warning: "border-[color-mix(in_oklab,var(--warning)_35%,var(--border))]",
    danger: "border-[color-mix(in_oklab,var(--danger)_35%,var(--border))]",
    info: "border-[color-mix(in_oklab,var(--info)_35%,var(--border))]",
  }[tone];
  const Icon = icon ?? (tone === "danger" || tone === "warning" ? <AlertTriangle className="h-4 w-4" /> : tone === "success" ? <Check className="h-4 w-4" /> : <Info className="h-4 w-4" />);
  return (
    <div className={cn("flex gap-3 rounded-xl border bg-surface px-4 py-3 text-sm", border, className)} role={tone === "danger" ? "alert" : undefined}>
      <span className={cn("mt-0.5 shrink-0", TONE_TEXT[tone])} aria-hidden>
        {Icon}
      </span>
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={cn("text-subtle", title && "mt-0.5")}>{children}</div>}
        {action && <div className="mt-2.5 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-xl border border-dashed border-border-strong px-6 py-14 text-center", className)}>
      {icon && <div className="mb-3 rounded-xl border border-border bg-elevated p-3 text-primary">{icon}</div>}
      <p className="text-[15px] font-medium">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm text-subtle">{children}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

/** Friendly error with retry and a collapsible technical-details section (spec §76). */
export function ErrorState({ error, onRetry, context }: { error: unknown; onRetry?: () => void; context?: string }) {
  const f = friendlyError(error, context);
  return (
    <Callout
      tone="danger"
      title={f.title}
      action={f.retryable && onRetry ? (
        <Button size="sm" variant="secondary" onClick={onRetry}>
          <RotateCw className="h-3.5 w-3.5" /> Try again
        </Button>
      ) : undefined}
    >
      {f.message}
      {f.detail && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Technical details</summary>
          <code className="mt-1 block font-mono break-all text-muted">{f.detail}</code>
        </details>
      )}
    </Callout>
  );
}

export function InlineError({ error }: { error: unknown }) {
  if (!error) return null;
  const f = friendlyError(error);
  return (
    <p className="flex items-start gap-1.5 text-sm text-danger" role="alert">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span>{f.title === "Action needed first" || f.title === "Please check your input" ? f.message : `${f.title}. ${f.message}`}</span>
    </p>
  );
}

// ------------------------------------------------------------------ Scores
export function scoreTone(score: number | null | undefined): Tone {
  if (score === null || score === undefined) return "neutral";
  if (score >= 85) return "success";
  if (score >= 70) return "primary";
  if (score >= 50) return "warning";
  return "danger";
}

export function scoreLabel(score: number | null | undefined): string {
  if (score === null || score === undefined) return "Not scored";
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Fair";
  return "Weak";
}

/** Counts up from 0 on mount (disabled for reduced motion). */
export function useCountUp(target: number | null | undefined, ms = 700): number | null {
  const [v, setV] = React.useState<number | null>(target ?? null);
  React.useEffect(() => {
    if (target === null || target === undefined) return setV(null);
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    let raf = 0;
    const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const TONE_VAR: Record<Tone, string> = {
  neutral: "var(--muted)",
  primary: "var(--primary)",
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  info: "var(--info)",
};

export function ScoreRing({
  score,
  size = 88,
  label = "match",
  stroke = 7,
  showLabel = true,
}: {
  score: number | null | undefined;
  size?: number;
  label?: string;
  stroke?: number;
  showLabel?: boolean;
}) {
  const shown = useCountUp(score);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, shown ?? 0));
  const color = TONE_VAR[scoreTone(score)];
  return (
    <div className="relative inline-grid shrink-0 place-items-center" style={{ width: size, height: size }} role="img" aria-label={score === null || score === undefined ? `${label}: not scored` : `${label}: ${Math.round(score)} out of 100`}>
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - pct / 100)} />
      </svg>
      <div className="absolute text-center leading-none">
        <div className="tabular font-mono font-semibold" style={{ fontSize: size * 0.28 }}>
          {shown === null ? "—" : Math.round(shown)}
        </div>
        {showLabel && <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-muted">{label}</div>}
      </div>
    </div>
  );
}

export function ScoreBadge({ score, className, suffix = "" }: { score: number | null | undefined; className?: string; suffix?: string }) {
  return (
    <Badge tone={scoreTone(score)} className={cn("tabular font-mono text-[13px]", className)} title={scoreLabel(score)}>
      {score === null || score === undefined ? "—" : `${Math.round(score)}${suffix}`}
    </Badge>
  );
}

export function Meter({ value, label, hint, weight }: { value: number | null | undefined; label: React.ReactNode; hint?: React.ReactNode; weight?: number }) {
  const tone = scoreTone(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-subtle">
          {label}
          {weight !== undefined && <span className="ml-1.5 text-[11px] text-muted">· {Math.round(weight * 100)}%</span>}
        </span>
        <span className="tabular font-mono font-medium">{value === null || value === undefined ? <span className="text-muted">n/a</span> : Math.round(value)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover" aria-hidden>
        <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${Math.max(0, Math.min(100, value ?? 0))}%`, background: TONE_VAR[tone] }} />
      </div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function KPI({ label, value, sub, icon, href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; icon?: React.ReactNode; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between text-[13px] text-subtle">
        {label}
        {icon && <span className="text-muted">{icon}</span>}
      </div>
      <div className="tabular mt-2 font-mono text-[28px] leading-none font-semibold">{value}</div>
      {sub && <div className="mt-2 text-xs text-muted">{sub}</div>}
    </>
  );
  const cls = "block rounded-xl border border-border bg-surface px-4 py-4 transition-colors";
  return href ? (
    <Link href={href} className={cn(cls, "hover:border-border-strong hover:bg-elevated")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

// ------------------------------------------------------------------ Table
export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="scrollbar-thin relative overflow-x-auto">
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
    </div>
  );
}
export function Th({ className, ...props }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("sticky top-0 z-[1] border-b border-border bg-surface px-3 py-2.5 text-left text-xs font-medium whitespace-nowrap text-muted", className)} {...props} />;
}
export function Td({ className, ...props }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-border px-3 py-3 align-top", className)} {...props} />;
}

// ------------------------------------------------------------------ Tabs
export function Tabs<T extends string>({
  value,
  onChange,
  tabs,
  className,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: { id: T; label: React.ReactNode; count?: number }[];
  className?: string;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (next === null) return;
    e.preventDefault();
    const idx = (next + tabs.length) % tabs.length;
    const tab = tabs[idx];
    if (tab) {
      onChange(tab.id);
      refs.current[idx]?.focus();
    }
  };
  return (
    <div role="tablist" className={cn("scrollbar-thin relative flex gap-1 overflow-x-auto border-b border-border", className)}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => onKey(e, i)}
          className={cn(
            "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-[13px] font-medium whitespace-nowrap transition-colors",
            value === t.id ? "border-primary text-foreground" : "border-transparent text-muted hover:text-foreground",
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="tabular rounded bg-hover px-1.5 text-[11px] text-subtle">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ Page chrome
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  back,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  eyebrow?: React.ReactNode;
  back?: { href: string; label: string };
}) {
  return (
    <div className="mb-6 animate-rise">
      {back && (
        <Link href={back.href} className="mb-3 inline-flex items-center gap-1 text-[13px] text-muted hover:text-foreground">
          ← {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {eyebrow && <div className="mb-1.5">{eyebrow}</div>}
          <h1 className="text-2xl font-semibold tracking-tight md:text-[28px]">{title}</h1>
          {description && <p className="mt-1.5 max-w-3xl text-sm text-subtle">{description}</p>}
        </div>
        {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
      </div>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-border-strong bg-elevated px-1.5 py-0.5 font-mono text-[11px] text-subtle">{children}</kbd>;
}

/** Marks AI-produced content (spec §78). */
export function AIGenerated({ label = "AI generated" }: { label?: string }) {
  return (
    <Badge tone="primary">
      <span aria-hidden>✦</span> {label}
    </Badge>
  );
}
