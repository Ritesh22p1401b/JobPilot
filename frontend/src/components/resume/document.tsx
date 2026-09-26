"use client";

import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import type { z } from "zod";

import type * as S from "@/lib/schemas";
import { cn } from "@/lib/utils";

type Content = z.infer<typeof S.ResumeContent>;
type Bullet = Content["experience"][number]["bullets"][number];

export const RESUME_SECTIONS: { id: string; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "skills", label: "Skills" },
  { id: "experience", label: "Experience" },
  { id: "projects", label: "Projects" },
  { id: "education", label: "Education" },
  { id: "certifications", label: "Certifications" },
  { id: "achievements", label: "Achievements" },
];

function BulletLine({ b }: { b: Bullet }) {
  const [showOriginal, setShowOriginal] = useState(false);
  const rewritten = !!b.original_text && b.original_text.trim() !== b.text.trim();
  return (
    <li className={cn("group relative rounded-md pl-1", rewritten && "bg-[color-mix(in_oklab,var(--primary)_7%,transparent)]", !b.verified && "bg-[color-mix(in_oklab,var(--danger)_10%,transparent)]")}>
      <span>{b.text}</span>
      {rewritten && (
        <button type="button" onClick={() => setShowOriginal(!showOriginal)} className="ml-1.5 inline-flex items-center gap-0.5 rounded px-1 text-[11px] font-medium text-primary hover:underline" aria-expanded={showOriginal}>
          <span aria-hidden>✦</span> AI rewritten
        </button>
      )}
      {!b.verified && (
        <span className="ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-medium text-danger">
          <AlertTriangle className="h-3 w-3" aria-hidden /> Unverified
        </span>
      )}
      {showOriginal && b.original_text && <span className="mt-1 block rounded border border-border bg-background px-2 py-1 text-xs text-muted">Your original: {b.original_text}</span>}
    </li>
  );
}

/** Renders a resume version's content (what gets written to DOCX/PDF), with AI changes marked. */
export function ResumeDocument({ content }: { content: Content }) {
  const c = content.contact;
  const order = content.section_order.length ? content.section_order : RESUME_SECTIONS.map((s) => s.id);
  const H = ({ id, children }: { id: string; children: React.ReactNode }) => (
    <h3 id={`sec-${id}`} className="mt-6 mb-2 scroll-mt-24 border-b border-border pb-1 text-[11px] font-semibold tracking-[0.12em] text-muted uppercase">
      {children}
    </h3>
  );
  const sections: Record<string, React.ReactNode> = {
    summary: content.summary ? (
      <section key="summary">
        <H id="summary">
          Summary{" "}
          {content.summary_source === "generated" && (
            <span className="ml-1 font-sans tracking-normal normal-case text-primary">
              <span aria-hidden>✦</span> AI generated from your evidence
            </span>
          )}
        </H>
        <p className="text-[13.5px] leading-relaxed">{content.summary}</p>
      </section>
    ) : null,
    skills: Object.keys(content.skills).length ? (
      <section key="skills">
        <H id="skills">Skills</H>
        <dl className="space-y-1 text-[13.5px]">
          {Object.entries(content.skills).map(([cat, items]) => (
            <div key={cat} className="flex gap-2">
              <dt className="shrink-0 font-medium">{cat}:</dt>
              <dd className="text-subtle">{items.join(", ")}</dd>
            </div>
          ))}
        </dl>
      </section>
    ) : null,
    experience: content.experience.length ? (
      <section key="experience">
        <H id="experience">Experience</H>
        <div className="space-y-4">
          {content.experience.map((e) => (
            <div key={e.source_id}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="text-[14px] font-semibold">
                  {e.title}
                  {e.company && <span className="font-normal text-subtle"> · {e.company}</span>}
                </div>
                <div className="text-xs text-muted">
                  {e.start_date ?? ""} – {e.end_date ?? "Present"}
                </div>
              </div>
              <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed">
                {e.bullets.map((b, i) => (
                  <BulletLine key={i} b={b} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    ) : null,
    projects: content.projects.length ? (
      <section key="projects">
        <H id="projects">Projects</H>
        <div className="space-y-3">
          {content.projects.map((p) => (
            <div key={p.source_id}>
              <div className="text-[14px] font-semibold">{p.name}</div>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed">
                {p.bullets.map((b, i) => (
                  <BulletLine key={i} b={b} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    ) : null,
    education: content.education.length ? (
      <section key="education">
        <H id="education">Education</H>
        {content.education.map((e) => (
          <div key={e.id} className="flex flex-wrap justify-between gap-2 text-[13.5px]">
            <span>
              <span className="font-medium">{[e.degree, e.field && `in ${e.field}`].filter(Boolean).join(" ")}</span>
              {e.institution && <span className="text-subtle"> · {e.institution}</span>}
            </span>
            <span className="text-xs text-muted">{[e.end_date, e.grade].filter(Boolean).join(" · ")}</span>
          </div>
        ))}
      </section>
    ) : null,
    certifications: content.certifications.length ? (
      <section key="certifications">
        <H id="certifications">Certifications</H>
        <ul className="list-disc pl-5 text-[13.5px]">
          {content.certifications.map((x) => (
            <li key={x.id}>
              {x.name}
              {x.issuer && <span className="text-subtle"> · {x.issuer}</span>}
            </li>
          ))}
        </ul>
      </section>
    ) : null,
    achievements: content.achievements.length ? (
      <section key="achievements">
        <H id="achievements">Achievements</H>
        <ul className="list-disc pl-5 text-[13.5px]">
          {content.achievements.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      </section>
    ) : null,
  };
  return (
    <article className="rounded-xl border border-border bg-surface px-6 py-7 md:px-10">
      <header className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">{c.name ?? "Your name"}</h2>
        <p className="mt-1 text-xs text-subtle">{[c.email, c.phone, c.location, c.linkedin, c.github, c.portfolio].filter(Boolean).join("  ·  ")}</p>
      </header>
      {order.map((id) => sections[id] ?? null)}
      {RESUME_SECTIONS.filter((s) => !order.includes(s.id)).map((s) => sections[s.id] ?? null)}
    </article>
  );
}
