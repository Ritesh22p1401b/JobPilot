"use client";

import { ArrowRight, BarChart3, FileCheck2, Gauge, ListChecks, Scale, Search, ShieldCheck, Sparkles, Target, Wand2 } from "lucide-react";
import Link from "next/link";

import { ExampleMatchCard, Logo } from "@/components/auth/auth-shell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ButtonLink } from "@/components/ui";
import { useToken } from "@/lib/hooks";

const FLOW = ["Profile", "Discover", "Match", "Evidence", "ATS", "Tailor", "Apply", "Track", "Improve"];

const FEATURES = [
  { icon: Sparkles, title: "Explainable job matching", body: "Every score breaks down into skills, experience, seniority, education and preferences — with the reasons behind each." },
  { icon: Scale, title: "Requirement → evidence mapping", body: "Each requirement in a job description is linked to the line in your resume that proves it, or clearly marked missing." },
  { icon: Gauge, title: "ATS scanner", body: "Tests parsing on the real DOCX/PDF: round-trip fidelity, formatting risks, keyword and requirement coverage, prioritized fixes." },
  { icon: Wand2, title: "Truthful tailoring", body: "Tailored versions reorder and rephrase only what you’ve proven. New skills or numbers are rejected. Your base resume never changes." },
  { icon: ListChecks, title: "Application workspace", body: "Readiness checklist, cover letter and drafted answers in one place. Sensitive questions always wait for you." },
  { icon: BarChart3, title: "Tracking & insights", body: "Kanban and table tracking, follow-up reminders, funnel analytics and skill gaps based on the jobs you target." },
];

export default function Landing() {
  const token = useToken();
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute -top-60 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full bg-primary/15 blur-[140px]" aria-hidden />

      <header className="relative z-10 mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
        <Logo />
        <nav className="flex items-center gap-2">
          <a href="#how" className="hidden px-3 text-sm text-subtle hover:text-foreground sm:block">
            How it works
          </a>
          <ThemeToggle compact />
          {token ? (
            <ButtonLink href="/dashboard" size="sm">
              Open workspace <ArrowRight className="h-3.5 w-3.5" />
            </ButtonLink>
          ) : (
            <>
              <ButtonLink href="/login" variant="ghost" size="sm">
                Sign in
              </ButtonLink>
              <ButtonLink href="/signup" size="sm">
                Get started
              </ButtonLink>
            </>
          )}
        </nav>
      </header>

      <section className="relative z-10 mx-auto grid max-w-6xl items-center gap-12 px-5 pt-14 pb-20 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
        <div className="animate-rise">
          <div className="inline-flex items-center gap-2 rounded-full border ai-border ai-gradient px-3 py-1 text-xs font-medium text-subtle">
            <span className="text-primary" aria-hidden>
              ✦
            </span>
            Your AI career operating system
          </div>
          <h1 className="mt-5 text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl">
            Find the right jobs.
            <br />
            Build the right application.
            <br />
            <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">Apply with confidence.</span>
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-relaxed text-subtle">
            JobPilot connects job discovery, resume intelligence, ATS analysis, application preparation and career insights in one workspace — and shows the evidence behind every decision.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <ButtonLink href={token ? "/dashboard" : "/signup"} size="lg">
              {token ? "Open your workspace" : "Get started — it’s free"} <ArrowRight className="h-4 w-4" />
            </ButtonLink>
            <ButtonLink href="#how" variant="secondary" size="lg">
              See how it works
            </ButtonLink>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-success" aria-hidden /> No scraping of LinkedIn or Indeed
            </span>
            <span className="flex items-center gap-1.5">
              <FileCheck2 className="h-3.5 w-3.5 text-success" aria-hidden /> Never invents skills or metrics
            </span>
            <span className="flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5 text-success" aria-hidden /> You approve every application
            </span>
          </div>
        </div>
        <div className="relative mx-auto w-full max-w-md animate-rise">
          <ExampleMatchCard />
          <div className="absolute -bottom-24 -left-10 hidden w-60 rounded-xl border border-border bg-elevated p-3.5 text-xs shadow-float sm:block">
            <div className="text-[10px] font-semibold tracking-wider text-muted uppercase">Requirement → evidence</div>
            <div className="mt-2 font-medium">Build production RAG systems</div>
            <div className="mt-1 text-subtle">“Built RAG pipelines with LangGraph + Qdrant”</div>
            <div className="mt-2 inline-flex items-center gap-1 rounded tint-success px-1.5 py-0.5 font-medium">✓ Strong</div>
          </div>
        </div>
      </section>

      <section id="how" className="relative z-10 border-y border-border bg-surface/60">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <h2 className="text-center text-2xl font-semibold tracking-tight">One continuous workflow</h2>
          <p className="mx-auto mt-2 max-w-xl text-center text-sm text-subtle">Every screen answers one question — what to consider, why you fit, what’s missing, and what to do next.</p>
          <ol className="mt-10 flex flex-wrap items-center justify-center gap-2">
            {FLOW.map((step, i) => (
              <li key={step} className="flex items-center gap-2">
                <span className="rounded-full border border-border bg-elevated px-3.5 py-1.5 text-[13px] font-medium">
                  <span className="mr-1.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                  {step}
                </span>
                {i < FLOW.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-muted" aria-hidden />}
              </li>
            ))}
          </ol>
          <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl border border-border bg-surface p-5 transition-colors hover:border-border-strong">
                <f.icon className="h-5 w-5 text-primary" aria-hidden />
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1.5 text-sm text-subtle">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative z-10 mx-auto max-w-6xl px-5 py-20 text-center">
        <Search className="mx-auto h-6 w-6 text-primary" aria-hidden />
        <h2 className="mt-4 text-2xl font-semibold tracking-tight">Find the right job → understand your fit → apply → track → improve.</h2>
        <div className="mt-8">
          <ButtonLink href={token ? "/dashboard" : "/signup"} size="lg">
            {token ? "Open your workspace" : "Create your workspace"} <ArrowRight className="h-4 w-4" />
          </ButtonLink>
        </div>
      </section>

      <footer className="relative z-10 border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-5 py-6 text-xs text-muted">
          <span>JobPilot · scores estimate fit and never guarantee interviews.</span>
          <span className="flex gap-4">
            <Link href="/login" className="hover:text-foreground">
              Sign in
            </Link>
            <Link href="/signup" className="hover:text-foreground">
              Create account
            </Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
