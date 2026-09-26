"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { RequireProfile } from "@/components/layout/require-profile";
import { Button, Callout, Card, CardBody, CardHeader, ErrorState, Field, Input, PageHeader, PageSkeleton, Textarea, Toggle } from "@/components/ui";
import { ChipsInput } from "@/components/ui/chips-input";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApiMutation } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, humanize } from "@/lib/utils";

type Profile = S.Profile;
const newId = () => Math.random().toString(36).slice(2, 10);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const Email = z.string().trim().email();

const SECTIONS = [
  ["contact", "Contact"],
  ["summary", "Summary"],
  ["skills", "Skills"],
  ["targets", "Target roles"],
  ["experience", "Experience"],
  ["projects", "Projects"],
  ["education", "Education"],
  ["certifications", "Certifications"],
] as const;

const bulletsFrom = (text: string) =>
  text
    .split("\n")
    .map((b) => b.replace(/^[•\-*]\s*/, ""))
    .filter((b) => b.trim());

function Content() {
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api(S.ProfileOut, "GET", "/profile") });
  const toast = useToast();
  const [p, setP] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useApiMutation((body: Partial<Profile>) => api(S.ProfileUpdateOut, "PATCH", "/profile", body), [["profile"], ["resume"], ["versions"], ["insights"], ["dashboard"]]);

  useEffect(() => {
    if (q.data) setP(structuredClone(q.data.profile));
  }, [q.data]);
  const dirty = useMemo(() => !!p && !!q.data && JSON.stringify(p) !== JSON.stringify(q.data.profile), [p, q.data]);

  if (q.isLoading || !p) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <PageSkeleton />;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const skillNames = p.skills.map((s) => s.name);

  const onSave = () => {
    const errs: string[] = [];
    if (!p.contact.name?.trim()) errs.push("Name is required.");
    if (p.contact.email && !Email.safeParse(p.contact.email).success) errs.push("Enter a valid email address.");
    for (const e of p.experience) for (const d of [e.start_date, e.end_date]) if (d && !MONTH.test(d)) errs.push(`Dates must look like 2024-03 (got “${d}”).`);
    setErrors(errs);
    if (errs.length) return;
    save.mutate(
      { contact: p.contact, summary: p.summary, skills: p.skills, experience: p.experience, education: p.education, projects: p.projects, certifications: p.certifications, target_roles: p.target_roles, languages: p.languages },
      {
        onSuccess: (out) => {
          const r = out.regression ? S.Regression.safeParse(out.regression) : null;
          const lost = r?.success ? r.data.skills_lost : [];
          toast({ tone: "success", title: "Saved as a new base resume version", body: lost.length ? `Skills removed: ${lost.join(", ")}. Jobs are being re-scored.` : "Resume tests and job scores are updating in the background." });
        },
        onError: (e) => toast({ tone: "error", title: "Couldn’t save your profile", body: errorText(e) }),
      },
    );
  };

  return (
    <>
      <PageHeader title="Profile" description="Your verified facts, and the single source of truth for matching, tailoring, cover letters and applications. JobPilot never claims anything that isn’t here." />
      {q.data!.warnings.length > 0 && (
        <Callout tone="warning" className="mb-5" title="Please check these parsed details">
          <ul className="list-disc pl-4">
            {q.data!.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}
      {errors.length > 0 && (
        <Callout tone="danger" className="mb-5" title="Fix these before saving">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="grid gap-6 lg:grid-cols-[180px_1fr]">
        <nav aria-label="Profile sections" className="hidden lg:block">
          <div className="sticky top-20 space-y-0.5">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#p-${id}`} className="block rounded-lg px-2.5 py-1.5 text-[13px] text-subtle hover:bg-hover hover:text-foreground">
                {label}
              </a>
            ))}
          </div>
        </nav>
        <div className="min-w-0 space-y-5 pb-20">
          <Card id="p-contact" className="scroll-mt-24">
            <CardHeader title="Contact" />
            <CardBody className="grid gap-4 md:grid-cols-2">
              {(["name", "email", "phone", "location", "linkedin", "github", "portfolio"] as const).map((k) => (
                <Field key={k} label={humanize(k)} htmlFor={`pc-${k}`}>
                  <Input id={`pc-${k}`} value={p.contact[k] ?? ""} onChange={(e) => set("contact", { ...p.contact, [k]: e.target.value || null })} />
                </Field>
              ))}
            </CardBody>
          </Card>

          <Card id="p-summary" className="scroll-mt-24">
            <CardHeader title="Summary" />
            <CardBody>
              <Textarea rows={4} value={p.summary ?? ""} onChange={(e) => set("summary", e.target.value || null)} aria-label="Summary" />
            </CardBody>
          </Card>

          <Card id="p-skills" className="scroll-mt-24">
            <CardHeader title="Skills" description="Only list skills you genuinely have. Skills also shown in your experience or projects count as stronger evidence." />
            <CardBody>
              <ChipsInput
                value={skillNames}
                ariaLabel="Skills"
                placeholder="Add a skill and press Enter"
                onChange={(names) =>
                  set(
                    "skills",
                    names.map((n) => p.skills.find((s) => s.name === n) ?? { name: n, category: "other", sections: ["skills"], known: true }),
                  )
                }
              />
            </CardBody>
          </Card>

          <Card id="p-targets" className="scroll-mt-24">
            <CardHeader title="Target roles & languages" />
            <CardBody className="space-y-4">
              <Field label="Roles you want" hint="Used for job search and role-fit scoring.">
                <ChipsInput value={p.target_roles} onChange={(v) => set("target_roles", v)} placeholder="e.g. AI Engineer" ariaLabel="Target roles" />
              </Field>
              <Field label="Languages">
                <ChipsInput value={p.languages} onChange={(v) => set("languages", v)} placeholder="e.g. English" ariaLabel="Languages" />
              </Field>
            </CardBody>
          </Card>

          <Card id="p-experience" className="scroll-mt-24">
            <CardHeader
              title="Experience"
              action={
                <Button variant="secondary" size="sm" onClick={() => set("experience", [...p.experience, { id: newId(), company: "", title: "", location: null, start_date: null, end_date: null, current: false, is_internship: false, bullets: [], skills: [], raw_header: null }])}>
                  <Plus className="h-3.5 w-3.5" /> Add role
                </Button>
              }
            />
            <CardBody className="space-y-4">
              {p.experience.map((e, i) => {
                const upd = (patch: Partial<Profile["experience"][number]>) => set("experience", p.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={e.id} className="space-y-4 rounded-xl border border-border bg-elevated/30 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Title" htmlFor={`e-t-${e.id}`}>
                        <Input id={`e-t-${e.id}`} value={e.title ?? ""} onChange={(ev) => upd({ title: ev.target.value })} />
                      </Field>
                      <Field label="Company" htmlFor={`e-c-${e.id}`}>
                        <Input id={`e-c-${e.id}`} value={e.company ?? ""} onChange={(ev) => upd({ company: ev.target.value })} />
                      </Field>
                      <Field label="Start" htmlFor={`e-s-${e.id}`} hint="YYYY-MM">
                        <Input id={`e-s-${e.id}`} value={e.start_date ?? ""} placeholder="2023-06" onChange={(ev) => upd({ start_date: ev.target.value || null })} />
                      </Field>
                      <Field label="End" htmlFor={`e-e-${e.id}`} hint="YYYY-MM">
                        <Input id={`e-e-${e.id}`} value={e.end_date ?? ""} placeholder="2024-12" disabled={e.current} onChange={(ev) => upd({ end_date: ev.target.value || null })} />
                      </Field>
                    </div>
                    <div className="flex flex-wrap gap-8">
                      <Toggle label="Current role" checked={e.current} onChange={(v) => upd({ current: v, end_date: v ? null : e.end_date })} />
                      <Toggle label="Internship" checked={e.is_internship} onChange={(v) => upd({ is_internship: v })} />
                    </div>
                    <Field label="Bullets" htmlFor={`e-b-${e.id}`} hint="One per line: action + technology + outcome. Add numbers only where you have them.">
                      <Textarea id={`e-b-${e.id}`} rows={Math.max(3, e.bullets.length + 1)} value={e.bullets.join("\n")} onChange={(ev) => upd({ bullets: bulletsFrom(ev.target.value) })} />
                    </Field>
                    <Button variant="ghost" size="sm" onClick={() => set("experience", p.experience.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove role
                    </Button>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card id="p-projects" className="scroll-mt-24">
            <CardHeader
              title="Projects"
              action={
                <Button variant="secondary" size="sm" onClick={() => set("projects", [...p.projects, { id: newId(), name: "New project", description: null, url: null, start_date: null, end_date: null, bullets: [], skills: [] }])}>
                  <Plus className="h-3.5 w-3.5" /> Add project
                </Button>
              }
            />
            <CardBody className="space-y-4">
              {p.projects.map((pr, i) => {
                const upd = (patch: Partial<Profile["projects"][number]>) => set("projects", p.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={pr.id} className="space-y-4 rounded-xl border border-border bg-elevated/30 p-4">
                    <div className="grid gap-3 md:grid-cols-2">
                      <Field label="Name" htmlFor={`p-n-${pr.id}`}>
                        <Input id={`p-n-${pr.id}`} value={pr.name} onChange={(ev) => upd({ name: ev.target.value })} />
                      </Field>
                      <Field label="URL" htmlFor={`p-u-${pr.id}`}>
                        <Input id={`p-u-${pr.id}`} value={pr.url ?? ""} onChange={(ev) => upd({ url: ev.target.value || null })} />
                      </Field>
                    </div>
                    <Field label="Bullets" htmlFor={`p-b-${pr.id}`} hint="One per line.">
                      <Textarea id={`p-b-${pr.id}`} rows={Math.max(3, pr.bullets.length + 1)} value={pr.bullets.join("\n")} onChange={(ev) => upd({ bullets: bulletsFrom(ev.target.value) })} />
                    </Field>
                    <Button variant="ghost" size="sm" onClick={() => set("projects", p.projects.filter((_, j) => j !== i))}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove project
                    </Button>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card id="p-education" className="scroll-mt-24">
            <CardHeader
              title="Education"
              action={
                <Button variant="secondary" size="sm" onClick={() => set("education", [...p.education, { id: newId(), institution: "", degree: "", degree_level: null, field: null, start_date: null, end_date: null, grade: null, raw: null }])}>
                  <Plus className="h-3.5 w-3.5" /> Add education
                </Button>
              }
            />
            <CardBody className="space-y-3">
              {p.education.map((ed, i) => {
                const upd = (patch: Partial<Profile["education"][number]>) => set("education", p.education.map((x, j) => (j === i ? { ...x, ...patch } : x)));
                return (
                  <div key={ed.id} className="grid gap-3 rounded-xl border border-border bg-elevated/30 p-4 md:grid-cols-2">
                    <Field label="Institution" htmlFor={`ed-i-${ed.id}`}>
                      <Input id={`ed-i-${ed.id}`} value={ed.institution ?? ""} onChange={(ev) => upd({ institution: ev.target.value })} />
                    </Field>
                    <Field label="Degree" htmlFor={`ed-d-${ed.id}`}>
                      <Input id={`ed-d-${ed.id}`} value={ed.degree ?? ""} onChange={(ev) => upd({ degree: ev.target.value })} />
                    </Field>
                    <Field label="Field of study" htmlFor={`ed-f-${ed.id}`}>
                      <Input id={`ed-f-${ed.id}`} value={ed.field ?? ""} onChange={(ev) => upd({ field: ev.target.value || null })} />
                    </Field>
                    <Field label="Grade" htmlFor={`ed-g-${ed.id}`}>
                      <Input id={`ed-g-${ed.id}`} value={ed.grade ?? ""} onChange={(ev) => upd({ grade: ev.target.value || null })} />
                    </Field>
                  </div>
                );
              })}
            </CardBody>
          </Card>

          <Card id="p-certifications" className="scroll-mt-24">
            <CardHeader title="Certifications" description="Certifications alone don’t count as demonstrated experience in matching." />
            <CardBody className="space-y-2">
              {p.certifications.map((c, i) => (
                <div key={c.id} className="flex gap-2">
                  <Input value={c.name} aria-label="Certification" onChange={(ev) => set("certifications", p.certifications.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
                  <Button variant="ghost" size="icon" aria-label="Remove certification" onClick={() => set("certifications", p.certifications.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={() => set("certifications", [...p.certifications, { id: newId(), name: "", issuer: null, date: null }])}>
                <Plus className="h-3.5 w-3.5" /> Add certification
              </Button>
            </CardBody>
          </Card>
        </div>
      </div>

      <div className={cn("fixed inset-x-0 bottom-16 z-20 transition-transform md:bottom-0", dirty ? "translate-y-0" : "pointer-events-none translate-y-[200%]")}>
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-border bg-elevated px-4 py-3 shadow-float">
          <span className="text-sm text-subtle">You have unsaved changes. Saving creates a new base resume version.</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setP(structuredClone(q.data!.profile))}>
              Discard
            </Button>
            <Button size="sm" onClick={onSave} loading={save.isPending}>
              Save profile
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ProfilePage() {
  return (
    <RequireProfile title="Profile">
      <Content />
    </RequireProfile>
  );
}
