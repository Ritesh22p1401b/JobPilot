"use client";

import { useEffect, useState } from "react";

import { Alert, Button, Card, CardBody, CardHeader, ErrorState, Field, Input, Loading, PageHeader, Select, Toggle } from "@/components/ui";
import { api } from "@/lib/api";
import { useApiMutation, usePreferences } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, humanize, splitList } from "@/lib/utils";

type Prefs = S.Preferences;

const MODE_TEXT: Record<(typeof S.APPLICATION_MODES)[number], string> = {
  DISCOVERY_ONLY: "Find and score jobs. You apply yourself.",
  ASSISTED_APPLICATION: "Also prepare tailored resumes, cover letters and answers for your review. You submit on the employer site.",
  AUTHORIZED_AUTO_APPLY:
    "May submit automatically, but only through employer-authorized APIs, above your score threshold and daily limit. Sensitive questions always need your approval.",
};

function ListInput({ label, value, onChange, hint, placeholder }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; placeholder?: string }) {
  const [text, setText] = useState(value.join(", "));
  useEffect(() => setText(value.join(", ")), [value]);
  return (
    <Field label={label} hint={hint ?? "Comma separated."}>
      <Input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => onChange(splitList(text))} />
    </Field>
  );
}

function CheckGroup<T extends string>({ label, options, value, onChange }: { label: string; options: readonly T[]; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => {
          const on = value.includes(o);
          return (
            <button
              key={o}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}
              className={cn("rounded-full border px-3 py-1 text-sm", on ? "border-primary bg-info-soft text-primary" : "text-muted-foreground hover:bg-muted")}
            >
              {humanize(o)}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export default function PreferencesPage() {
  const q = usePreferences();
  const [p, setP] = useState<Prefs | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useApiMutation((body: Prefs) => api(S.Preferences, "PUT", "/preferences", body), [["preferences"], ["dashboard"], ["jobs"]]);

  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  if (!p) return null;
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP({ ...p, [k]: v });

  const onSave = () => {
    const parsed = S.Preferences.safeParse(p);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${humanize(String(i.path[0]))}: ${i.message}`));
      return;
    }
    setErrors([]);
    save.mutate(parsed.data);
  };

  return (
    <>
      <PageHeader
        title="Preferences"
        description="What to look for, and how much JobPilot is allowed to do for you. Saving re-scores your jobs."
        action={
          <Button onClick={onSave} loading={save.isPending}>
            Save preferences
          </Button>
        }
      />
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
        <Alert tone="success" className="mb-5">
          Saved. Matches are being re-scored.
          {p.auto_apply && !save.data.auto_apply && " Auto-apply was left off because it needs Authorized auto-apply mode."}
        </Alert>
      )}

      <div className="space-y-5">
        <Card>
          <CardHeader title="What you’re looking for" />
          <CardBody className="grid gap-5 md:grid-cols-2">
            <ListInput label="Target job titles" value={p.target_titles} onChange={(v) => set("target_titles", v)} placeholder="AI Engineer, Backend Engineer" hint="Comma separated. Leave empty to use the roles from your resume." />
            <ListInput label="Locations" value={p.locations} onChange={(v) => set("locations", v)} placeholder="Bengaluru, Remote" />
            <ListInput label="Extra search keywords" value={p.search_keywords} onChange={(v) => set("search_keywords", v)} />
            <ListInput label="Excluded companies" value={p.excluded_companies} onChange={(v) => set("excluded_companies", v)} />
            <CheckGroup label="Work modes" options={S.WORK_MODES} value={p.work_modes} onChange={(v) => set("work_modes", v)} />
            <CheckGroup label="Employment types" options={S.EMPLOYMENT_TYPES} value={p.employment_types} onChange={(v) => set("employment_types", v)} />
            <Field label="Experience level">
              <Select value={p.experience_level ?? ""} onChange={(e) => set("experience_level", (e.target.value || null) as Prefs["experience_level"])}>
                <option value="">Not specified</option>
                {S.EXPERIENCE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {humanize(l)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-[1fr_96px] gap-3">
              <Field label="Minimum salary (yearly)">
                <Input type="number" min={0} value={p.minimum_salary ?? ""} onChange={(e) => set("minimum_salary", e.target.value === "" ? null : Number(e.target.value))} />
              </Field>
              <Field label="Currency">
                <Input value={p.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Work authorization" description="Only what you state here is used. JobPilot never guesses your visa status." />
          <CardBody className="grid gap-5 md:grid-cols-2">
            <Field label="Do you need visa sponsorship?">
              <Select
                value={p.visa_sponsorship_required === null ? "" : p.visa_sponsorship_required ? "yes" : "no"}
                onChange={(e) => set("visa_sponsorship_required", e.target.value === "" ? null : e.target.value === "yes")}
              >
                <option value="">Prefer not to say</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <ListInput label="Countries you’re authorized to work in" value={p.work_authorization_countries} onChange={(v) => set("work_authorization_countries", v)} placeholder="India" />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Automation" />
          <CardBody className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Automatic job search">
                <Select value={p.search_frequency} onChange={(e) => set("search_frequency", e.target.value as Prefs["search_frequency"])}>
                  {S.SEARCH_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {humanize(f)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Minimum match score to notify: ${p.minimum_match_score}`}>
                <input type="range" min={0} max={100} step={5} value={p.minimum_match_score} onChange={(e) => set("minimum_match_score", Number(e.target.value))} className="w-full accent-[var(--primary)]" />
              </Field>
            </div>

            <fieldset>
              <legend className="mb-2 text-sm font-medium">Application mode</legend>
              <div className="grid gap-2 md:grid-cols-3">
                {S.APPLICATION_MODES.map((m) => (
                  <label key={m} className={cn("cursor-pointer rounded-md border p-3", p.application_mode === m && "border-primary bg-info-soft")}>
                    <input
                      type="radio"
                      name="mode"
                      className="sr-only"
                      checked={p.application_mode === m}
                      onChange={() => setP({ ...p, application_mode: m, auto_apply: m === "AUTHORIZED_AUTO_APPLY" ? p.auto_apply : false })}
                    />
                    <div className="text-sm font-medium">{humanize(m)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{MODE_TEXT[m]}</div>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-4 rounded-md border p-4">
              <Toggle
                label="Auto-apply"
                description={
                  p.application_mode === "AUTHORIZED_AUTO_APPLY"
                    ? "Off by default. Only employer-authorized API submissions, and only for resumes you have approved."
                    : "Choose Authorized auto-apply mode first."
                }
                checked={p.auto_apply}
                disabled={p.application_mode !== "AUTHORIZED_AUTO_APPLY"}
                onChange={(v) => set("auto_apply", v)}
              />
              {p.auto_apply && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={`Auto-apply only at score ≥ ${p.auto_apply_minimum_score}`}>
                    <input type="range" min={50} max={100} step={5} value={p.auto_apply_minimum_score} onChange={(e) => set("auto_apply_minimum_score", Number(e.target.value))} className="w-full accent-[var(--primary)]" />
                  </Field>
                  <Field label="Daily application limit">
                    <Input type="number" min={0} max={50} value={p.daily_application_limit} onChange={(e) => set("daily_application_limit", Number(e.target.value))} />
                  </Field>
                </div>
              )}
            </div>

            <CheckGroup
              label="Always ask me before answering questions about"
              options={S.APPROVAL_CATEGORIES}
              value={p.require_user_approval_for as (typeof S.APPROVAL_CATEGORIES)[number][]}
              onChange={(v) => set("require_user_approval_for", v)}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Notifications" />
          <CardBody className="space-y-4">
            <Toggle label="In-app notifications" checked={p.notify_in_app} onChange={(v) => set("notify_in_app", v)} />
            <Toggle label="Email notifications" description="Requires SMTP settings on the server." checked={p.notify_email} onChange={(v) => set("notify_email", v)} />
          </CardBody>
        </Card>

        <div className="flex justify-end">
          <Button onClick={onSave} loading={save.isPending}>
            Save preferences
          </Button>
        </div>
      </div>
    </>
  );
}
