"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { NeedsResume } from "@/components/domain";
import { Alert, Badge, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, Loading, PageHeader, Textarea, Toggle } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useApiMutation } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { splitList } from "@/lib/utils";

type Profile = S.Profile;
const newId = () => Math.random().toString(36).slice(2, 10);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const ContactCheck = z.object({
  name: z.string().trim().min(1, "Name is required").nullable(),
  email: z.string().trim().email("Enter a valid email").nullable().or(z.literal("")),
});

function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <Card>
      <CardHeader title={title} description={description} action={action} />
      <CardBody className="space-y-4">{children}</CardBody>
    </Card>
  );
}

function SkillEditor({ skills, onChange }: { skills: Profile["skills"]; onChange: (s: Profile["skills"]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const names = splitList(draft).filter((n) => !skills.some((s) => s.name.toLowerCase() === n.toLowerCase()));
    if (names.length) onChange([...skills, ...names.map((name) => ({ name, category: "other", sections: ["skills"], known: true }))]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {skills.map((s) => (
          <Badge key={s.name} tone={s.sections.some((x) => x !== "skills") ? "info" : "neutral"} className="pr-1">
            {s.name}
            <button aria-label={`Remove ${s.name}`} onClick={() => onChange(skills.filter((x) => x.name !== s.name))} className="rounded-full p-0.5 hover:bg-black/10">
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          placeholder="Add skills you actually have (comma separated)"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button variant="outline" onClick={add}>
          Add
        </Button>
      </div>
    </div>
  );
}

export default function ProfilePage() {
  const q = useQuery({ queryKey: ["profile"], queryFn: () => api(S.ProfileOut, "GET", "/profile"), retry: false });
  const [p, setP] = useState<Profile | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useApiMutation((body: Partial<Profile>) => api(S.ProfileUpdateOut, "PATCH", "/profile", body), [["profile"], ["resume"], ["versions"], ["dashboard"]]);

  useEffect(() => {
    if (q.data) setP(structuredClone(q.data.profile));
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error instanceof ApiError && q.error.status === 409)
    return (
      <>
        <PageHeader title="Profile" />
        <NeedsResume />
      </>
    );
  if (q.error) return <ErrorState error={q.error} />;
  if (!p) return null;

  const set = <K extends keyof Profile>(k: K, v: Profile[K]) => setP({ ...p, [k]: v });
  const setContact = (k: keyof Profile["contact"], v: string) => set("contact", { ...p.contact, [k]: v || null });

  const onSave = () => {
    const errs: string[] = [];
    const c = ContactCheck.safeParse({ name: p.contact.name ?? null, email: p.contact.email ?? "" });
    if (!c.success) errs.push(...c.error.issues.map((i) => i.message));
    for (const e of p.experience) {
      for (const d of [e.start_date, e.end_date]) if (d && !MONTH.test(d)) errs.push(`Dates must be YYYY-MM (got “${d}”).`);
    }
    setErrors(errs);
    if (errs.length) return;
    save.mutate({
      contact: p.contact,
      summary: p.summary,
      skills: p.skills,
      experience: p.experience,
      education: p.education,
      projects: p.projects,
      certifications: p.certifications,
      target_roles: p.target_roles,
      languages: p.languages,
    });
  };

  const regression = save.data?.regression ? S.Regression.safeParse(save.data.regression) : null;

  return (
    <>
      <PageHeader
        title="Profile"
        description="Your verified facts. JobPilot only ever claims what is here. Saving creates a new master resume version and re-scores your jobs."
        action={
          <Button onClick={onSave} loading={save.isPending}>
            Save profile
          </Button>
        }
      />
      {q.data?.warnings.length ? (
        <Alert tone="warning" className="mb-5" title="Check these parsed fields">
          <ul className="list-disc pl-4">
            {q.data.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      {errors.length > 0 && (
        <Alert tone="danger" className="mb-5">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Alert>
      )}
      {save.error && <Alert tone="danger" className="mb-5">{(save.error as Error).message}</Alert>}
      {save.isSuccess && (
        <Alert tone="success" className="mb-5" title="Saved as a new master version">
          {regression?.success && (
            <>
              {regression.data.skills_lost.length > 0 && <div>Skills removed: {regression.data.skills_lost.join(", ")}</div>}
              {regression.data.skills_added.length > 0 && <div>Skills added: {regression.data.skills_added.join(", ")}</div>}
              {regression.data.warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </>
          )}
          Resume tests and job scoring are re-running in the background.
        </Alert>
      )}

      <div className="space-y-5">
        <Section title="Contact">
          <div className="grid gap-4 md:grid-cols-2">
            {(["name", "email", "phone", "location", "linkedin", "github", "portfolio"] as const).map((k) => (
              <Field key={k} label={k[0]!.toUpperCase() + k.slice(1)}>
                <Input value={p.contact[k] ?? ""} onChange={(e) => setContact(k, e.target.value)} />
              </Field>
            ))}
          </div>
        </Section>

        <Section title="Summary">
          <Textarea rows={4} value={p.summary ?? ""} onChange={(e) => set("summary", e.target.value || null)} />
        </Section>

        <Section title="Skills" description="Blue skills are demonstrated in your experience or projects; grey ones are listed only. Only add skills you genuinely have.">
          <SkillEditor skills={p.skills} onChange={(s) => set("skills", s)} />
        </Section>

        <Section title="Target roles">
          <Field label="Roles you want" hint="Comma separated. Used for job search and role-fit scoring.">
            <Input value={p.target_roles.join(", ")} onChange={(e) => set("target_roles", splitList(e.target.value))} />
          </Field>
          <Field label="Languages" hint="Comma separated.">
            <Input value={p.languages.join(", ")} onChange={(e) => set("languages", splitList(e.target.value))} />
          </Field>
        </Section>

        <Section
          title="Experience"
          action={
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                set("experience", [
                  ...p.experience,
                  { id: newId(), company: "", title: "", location: null, start_date: null, end_date: null, current: false, is_internship: false, bullets: [], skills: [], raw_header: null },
                ])
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add role
            </Button>
          }
        >
          {p.experience.map((e, i) => {
            const upd = (patch: Partial<Profile["experience"][number]>) => set("experience", p.experience.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={e.id} className="space-y-3 rounded-md border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Title"><Input value={e.title ?? ""} onChange={(ev) => upd({ title: ev.target.value })} /></Field>
                  <Field label="Company"><Input value={e.company ?? ""} onChange={(ev) => upd({ company: ev.target.value })} /></Field>
                  <Field label="Start (YYYY-MM)"><Input value={e.start_date ?? ""} onChange={(ev) => upd({ start_date: ev.target.value || null })} /></Field>
                  <Field label="End (YYYY-MM)"><Input value={e.end_date ?? ""} disabled={e.current} onChange={(ev) => upd({ end_date: ev.target.value || null })} /></Field>
                </div>
                <div className="flex flex-wrap gap-6">
                  <Toggle label="Current role" checked={e.current} onChange={(v) => upd({ current: v, end_date: v ? null : e.end_date })} />
                  <Toggle label="Internship" checked={e.is_internship} onChange={(v) => upd({ is_internship: v })} />
                </div>
                <Field label="Bullets" hint="One per line. Include real numbers only where you have them.">
                  <Textarea rows={Math.max(3, e.bullets.length + 1)} value={e.bullets.join("\n")} onChange={(ev) => upd({ bullets: ev.target.value.split("\n").map((b) => b.replace(/^[•\-*]\s*/, "")).filter((b) => b.trim()) })} />
                </Field>
                <Button variant="ghost" size="sm" onClick={() => set("experience", p.experience.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove role
                </Button>
              </div>
            );
          })}
        </Section>

        <Section
          title="Projects"
          action={
            <Button variant="outline" size="sm" onClick={() => set("projects", [...p.projects, { id: newId(), name: "New project", description: null, url: null, start_date: null, end_date: null, bullets: [], skills: [] }])}>
              <Plus className="h-3.5 w-3.5" /> Add project
            </Button>
          }
        >
          {p.projects.map((pr, i) => {
            const upd = (patch: Partial<Profile["projects"][number]>) => set("projects", p.projects.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={pr.id} className="space-y-3 rounded-md border p-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Field label="Name"><Input value={pr.name} onChange={(ev) => upd({ name: ev.target.value })} /></Field>
                  <Field label="URL"><Input value={pr.url ?? ""} onChange={(ev) => upd({ url: ev.target.value || null })} /></Field>
                </div>
                <Field label="Bullets" hint="One per line.">
                  <Textarea rows={Math.max(3, pr.bullets.length + 1)} value={pr.bullets.join("\n")} onChange={(ev) => upd({ bullets: ev.target.value.split("\n").map((b) => b.replace(/^[•\-*]\s*/, "")).filter((b) => b.trim()) })} />
                </Field>
                <Button variant="ghost" size="sm" onClick={() => set("projects", p.projects.filter((_, j) => j !== i))}>
                  <Trash2 className="h-3.5 w-3.5" /> Remove project
                </Button>
              </div>
            );
          })}
        </Section>

        <Section title="Education">
          {p.education.map((ed, i) => {
            const upd = (patch: Partial<Profile["education"][number]>) => set("education", p.education.map((x, j) => (j === i ? { ...x, ...patch } : x)));
            return (
              <div key={ed.id} className="grid gap-3 rounded-md border p-4 md:grid-cols-2">
                <Field label="Institution"><Input value={ed.institution ?? ""} onChange={(ev) => upd({ institution: ev.target.value })} /></Field>
                <Field label="Degree"><Input value={ed.degree ?? ""} onChange={(ev) => upd({ degree: ev.target.value })} /></Field>
                <Field label="Field"><Input value={ed.field ?? ""} onChange={(ev) => upd({ field: ev.target.value || null })} /></Field>
                <Field label="Grade"><Input value={ed.grade ?? ""} onChange={(ev) => upd({ grade: ev.target.value || null })} /></Field>
              </div>
            );
          })}
          <Button
            variant="outline"
            size="sm"
            onClick={() => set("education", [...p.education, { id: newId(), institution: "", degree: "", degree_level: null, field: null, start_date: null, end_date: null, grade: null, raw: null }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add education
          </Button>
        </Section>

        <Section title="Certifications" description="Certifications alone don’t count as demonstrated experience in matching.">
          {p.certifications.map((c, i) => (
            <div key={c.id} className="flex gap-2">
              <Input value={c.name} aria-label="Certification" onChange={(ev) => set("certifications", p.certifications.map((x, j) => (j === i ? { ...x, name: ev.target.value } : x)))} />
              <Button variant="ghost" size="icon" aria-label="Remove certification" onClick={() => set("certifications", p.certifications.filter((_, j) => j !== i))}>
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => set("certifications", [...p.certifications, { id: newId(), name: "", issuer: null, date: null }])}>
            <Plus className="h-3.5 w-3.5" /> Add certification
          </Button>
        </Section>

        <div className="flex justify-end">
          <Button onClick={onSave} loading={save.isPending}>
            Save profile
          </Button>
        </div>
      </div>
    </>
  );
}
