import { AlertTriangle, Check } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components/layout/theme-toggle";

export function Logo() {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label="JobPilot home">
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground shadow-[0_0_28px_-4px_var(--primary)]">J</span>
      <span className="text-base font-semibold tracking-tight">JobPilot</span>
    </Link>
  );
}

/** Illustrative product preview. Clearly labelled as an example, never presented as real data. */
export function ExampleMatchCard({ className = "" }: { className?: string }) {
  return (
    <div className={`relative rounded-2xl border border-border bg-surface/80 p-5 shadow-float backdrop-blur ${className}`} aria-label="Example of a JobPilot match card">
      <span className="absolute -top-2.5 right-4 rounded-full border border-border bg-elevated px-2 py-0.5 text-[10px] font-medium tracking-wider text-muted uppercase">Example</span>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold">AI Engineer</div>
          <div className="text-[13px] text-subtle">Remote · Full-time</div>
        </div>
        <div className="text-right">
          <div className="font-mono text-2xl font-semibold text-primary">94</div>
          <div className="text-[10px] font-medium tracking-wider text-muted uppercase">match</div>
        </div>
      </div>
      <div className="mt-4 space-y-2.5">
        {[
          ["Skills", 97],
          ["Experience", 88],
          ["ATS readiness", 92],
        ].map(([l, v]) => (
          <div key={l as string}>
            <div className="flex justify-between text-xs text-subtle">
              <span>{l}</span>
              <span className="font-mono">{v}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-hover">
              <div className="h-full rounded-full bg-primary" style={{ width: `${v}%` }} />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-1.5 text-xs">
        {["LLM", "RAG", "Python"].map((s) => (
          <span key={s} className="flex items-center gap-1.5 text-subtle">
            <Check className="h-3 w-3 text-success" aria-hidden /> {s}
          </span>
        ))}
        <span className="flex items-center gap-1.5 text-subtle">
          <AlertTriangle className="h-3 w-3 text-warning" aria-hidden /> Kubernetes
        </span>
      </div>
    </div>
  );
}

export function AuthShell({ children, title, subtitle }: { children: React.ReactNode; title: string; subtitle: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-border bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="pointer-events-none absolute inset-0 ai-gradient opacity-70" aria-hidden />
        <div className="pointer-events-none absolute -top-40 -left-40 h-[520px] w-[520px] rounded-full bg-primary/20 blur-[120px]" aria-hidden />
        <div className="pointer-events-none absolute -right-32 -bottom-40 h-[420px] w-[420px] rounded-full bg-accent/10 blur-[120px]" aria-hidden />
        <div className="relative">
          <Logo />
        </div>
        <div className="relative max-w-md">
          <div className="text-[11px] font-semibold tracking-[0.14em] text-primary uppercase">Your AI career workspace</div>
          <h2 className="mt-3 text-3xl leading-tight font-semibold tracking-tight">Understand your fit before you apply.</h2>
          <ul className="mt-6 space-y-3 text-sm text-subtle">
            {[
              "Every match score is explained with evidence from your own resume.",
              "Your base resume is never changed; tailored versions only use what you’ve proven.",
              "Nothing is submitted without your review.",
            ].map((t) => (
              <li key={t} className="flex gap-2.5">
                <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden />
                {t}
              </li>
            ))}
          </ul>
          <ExampleMatchCard className="mt-10 max-w-sm" />
        </div>
        <p className="relative text-xs text-muted">Jobs come from public job-board APIs. LinkedIn and Indeed are never scraped.</p>
      </aside>

      <main className="flex flex-col px-5 py-8 sm:px-10">
        <div className="flex items-center justify-between gap-3">
          <div className="lg:invisible">
            <Logo />
          </div>
          <ThemeToggle />
        </div>
        <div className="mx-auto flex w-full max-w-[400px] flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-1.5 text-sm text-subtle">{subtitle}</p>
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
