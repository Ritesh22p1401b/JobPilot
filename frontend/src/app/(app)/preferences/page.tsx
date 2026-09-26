"use client";

import { Bot, Check } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { Button, Callout, Card, CardBody, CardHeader, ChipGroup, ErrorState, Field, Input, PageHeader, PageSkeleton, Select, Toggle } from "@/components/ui";
import { ChipsInput } from "@/components/ui/chips-input";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApiMutation, usePreferences } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, humanize } from "@/lib/utils";

type Prefs = S.Preferences;

const MODES: Record<(typeof S.APPLICATION_MODES)[number], { title: string; body: string }> = {
  DISCOVERY_ONLY: { title: "Discovery only", body: "Find and score jobs. You prepare and apply yourself." },
  ASSISTED_APPLICATION: { title: "Assisted application", body: "The agent prepares resumes, cover letters and answers for your review. You submit on the employer’s site." },
  AUTHORIZED_AUTO_APPLY: { title: "Authorized auto-apply", body: "May submit automatically, but only through employer-authorized APIs, above your threshold and daily limit." },
};

export default function PreferencesPage() {
  const q = usePreferences();
  const confirm = useConfirm();
  const toast = useToast();
  const [p, setP] = useState<Prefs | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const save = useApiMutation((body: Prefs) => api(S.Preferences, "PUT", "/preferences", body), [["preferences"], ["insights"], ["jobs"]]);

  useEffect(() => {
    if (q.data) setP(q.data);
  }, [q.data]);
  const dirty = useMemo(() => !!p && !!q.data && JSON.stringify(p) !== JSON.stringify(q.data), [p, q.data]);

  if (q.isLoading || !p) return q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <PageSkeleton />;
  const set = <K extends keyof Prefs>(k: K, v: Prefs[K]) => setP({ ...p, [k]: v });

  const chooseMode = async (m: Prefs["application_mode"]) => {
    if (m === "AUTHORIZED_AUTO_APPLY" && p.application_mode !== m) {
      const ok = await confirm({
        title: "Enable authorized auto-apply mode?",
        body: "The Application Agent will only act according to your rules: employer-authorized APIs only, approved resumes only, above your score threshold and daily limit. It always pauses when information can’t be safely determined. You still turn auto-apply on separately.",
        confirmLabel: "Enable mode",
      });
      if (!ok) return;
    }
    setP({ ...p, application_mode: m, auto_apply: m === "AUTHORIZED_AUTO_APPLY" ? p.auto_apply : false });
  };
  const toggleAuto = async (v: boolean) => {
    if (v) {
      const ok = await confirm({
        title: "Turn on auto-apply?",
        body: `Applications may be submitted without asking you each time, via employer-authorized APIs only, for matches ≥ ${p.auto_apply_minimum_score}, up to ${p.daily_application_limit} per day. Sensitive questions still wait for you. You can turn this off at any time.`,
        confirmLabel: "Turn on auto-apply",
      });
      if (!ok) return;
    }
    set("auto_apply", v);
  };

  const onSave = () => {
    const parsed = S.Preferences.safeParse(p);
    if (!parsed.success) return setErrors(parsed.error.issues.map((i) => `${humanize(String(i.path[0]))}: ${i.message}`));
    setErrors([]);
    save.mutate(parsed.data, {
      onSuccess: () => toast({ tone: "success", title: "Preferences saved", body: "Your matches are being re-scored." }),
      onError: (e) => toast({ tone: "error", title: "Couldn’t save preferences", body: errorText(e) }),
    });
  };

  return (
    <>
      <PageHeader title="Preferences" description="What to look for, and how much the agent may do for you. Jobs that clearly conflict with these are filtered out, and the reason is always shown." />
      {errors.length > 0 && (
        <Callout tone="danger" className="mb-5" title="Fix these before saving">
          <ul className="list-disc pl-4">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        </Callout>
      )}
      <div className="space-y-5 pb-20">
        <Card>
          <CardHeader title="What you’re looking for" />
          <CardBody className="grid gap-5 md:grid-cols-2">
            <Field label="Target job titles" hint="Leave empty to use the roles from your profile.">
              <ChipsInput value={p.target_titles} onChange={(v) => set("target_titles", v)} placeholder="e.g. AI Engineer" ariaLabel="Target job titles" />
            </Field>
            <Field label="Locations" hint="Cities, or “Remote”.">
              <ChipsInput value={p.locations} onChange={(v) => set("locations", v)} placeholder="e.g. Bengaluru" ariaLabel="Locations" />
            </Field>
            <Field label="Extra search keywords">
              <ChipsInput value={p.search_keywords} onChange={(v) => set("search_keywords", v)} placeholder="e.g. LLM" ariaLabel="Search keywords" />
            </Field>
            <Field label="Excluded companies">
              <ChipsInput value={p.excluded_companies} onChange={(v) => set("excluded_companies", v)} placeholder="Company name" ariaLabel="Excluded companies" />
            </Field>
            <Field label="Work mode">
              <ChipGroup label="Work mode" options={S.WORK_MODES} value={p.work_modes} onChange={(v) => set("work_modes", v)} format={humanize} />
            </Field>
            <Field label="Job type">
              <ChipGroup label="Job type" options={S.EMPLOYMENT_TYPES} value={p.employment_types} onChange={(v) => set("employment_types", v)} format={humanize} />
            </Field>
            <Field label="Experience level" htmlFor="pr-lvl">
              <Select id="pr-lvl" value={p.experience_level ?? ""} onChange={(e) => set("experience_level", (e.target.value || null) as Prefs["experience_level"])}>
                <option value="">Not specified</option>
                {S.EXPERIENCE_LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {humanize(l)}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="grid grid-cols-[1fr_100px] gap-3">
              <Field label="Minimum yearly salary" htmlFor="pr-sal">
                <Input id="pr-sal" type="number" min={0} value={p.minimum_salary ?? ""} onChange={(e) => set("minimum_salary", e.target.value === "" ? null : Number(e.target.value))} />
              </Field>
              <Field label="Currency" htmlFor="pr-cur">
                <Input id="pr-cur" value={p.currency} maxLength={3} onChange={(e) => set("currency", e.target.value.toUpperCase())} />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Work authorization" description="Only what you state here is used. JobPilot never guesses your visa status." />
          <CardBody className="grid gap-5 md:grid-cols-2">
            <Field label="Do you need visa sponsorship?" htmlFor="pr-visa">
              <Select id="pr-visa" value={p.visa_sponsorship_required === null ? "" : p.visa_sponsorship_required ? "yes" : "no"} onChange={(e) => set("visa_sponsorship_required", e.target.value === "" ? null : e.target.value === "yes")}>
                <option value="">Prefer not to say</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </Select>
            </Field>
            <Field label="Countries you’re authorized to work in">
              <ChipsInput value={p.work_authorization_countries} onChange={(v) => set("work_authorization_countries", v)} placeholder="e.g. India" ariaLabel="Work authorization countries" />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Automation" icon={<Bot className="h-4 w-4" />} />
          <CardBody className="space-y-6">
            <div className="grid gap-5 md:grid-cols-2">
              <Field label="Automatic job search" htmlFor="pr-freq">
                <Select id="pr-freq" value={p.search_frequency} onChange={(e) => set("search_frequency", e.target.value as Prefs["search_frequency"])}>
                  {S.SEARCH_FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {humanize(f)}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={`Notify me about matches scoring ${p.minimum_match_score}+`} htmlFor="pr-min">
                <input id="pr-min" type="range" min={0} max={100} step={5} value={p.minimum_match_score} onChange={(e) => set("minimum_match_score", Number(e.target.value))} className="w-full accent-[var(--primary)]" />
              </Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-[13px] font-medium">Application mode</legend>
              <div className="grid gap-2 md:grid-cols-3" role="radiogroup">
                {S.APPLICATION_MODES.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={p.application_mode === m}
                    onClick={() => void chooseMode(m)}
                    className={cn("rounded-xl border p-4 text-left transition-colors", p.application_mode === m ? "border-primary bg-hover" : "border-border hover:border-border-strong")}
                  >
                    <div className="flex items-center justify-between text-sm font-medium">
                      {MODES[m].title}
                      {p.application_mode === m && <Check className="h-4 w-4 text-primary" aria-hidden />}
                    </div>
                    <p className="mt-1 text-xs text-subtle">{MODES[m].body}</p>
                  </button>
                ))}
              </div>
            </fieldset>
            <div className="space-y-4 rounded-xl border border-border bg-elevated/30 p-4">
              <Toggle
                label="Auto-apply"
                description={p.application_mode === "AUTHORIZED_AUTO_APPLY" ? "Off by default. Employer-authorized APIs only, approved resumes only." : "Choose Authorized auto-apply mode first."}
                checked={p.auto_apply}
                disabled={p.application_mode !== "AUTHORIZED_AUTO_APPLY"}
                onChange={(v) => void toggleAuto(v)}
              />
              {p.application_mode === "AUTHORIZED_AUTO_APPLY" && (
                <div className="grid gap-4 md:grid-cols-2">
                  <Field label={`Only for matches ≥ ${p.auto_apply_minimum_score}`} htmlFor="pr-auto-min">
                    <input id="pr-auto-min" type="range" min={50} max={100} step={5} value={p.auto_apply_minimum_score} onChange={(e) => set("auto_apply_minimum_score", Number(e.target.value))} className="w-full accent-[var(--primary)]" />
                  </Field>
                  <Field label="Daily application limit" htmlFor="pr-limit">
                    <Input id="pr-limit" type="number" min={0} max={50} value={p.daily_application_limit} onChange={(e) => set("daily_application_limit", Number(e.target.value))} />
                  </Field>
                </div>
              )}
            </div>
            <Field label="Always ask me before answering questions about">
              <ChipGroup label="Approval categories" options={S.APPROVAL_CATEGORIES} value={p.require_user_approval_for as (typeof S.APPROVAL_CATEGORIES)[number][]} onChange={(v) => set("require_user_approval_for", v)} format={humanize} />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Notifications" />
          <CardBody className="space-y-4">
            <Toggle label="In-app notifications" checked={p.notify_in_app} onChange={(v) => set("notify_in_app", v)} />
            <Toggle label="Email notifications" description="Requires SMTP settings on the server." checked={p.notify_email} onChange={(v) => set("notify_email", v)} />
          </CardBody>
        </Card>
      </div>

      <div className={cn("fixed inset-x-0 bottom-16 z-20 transition-transform md:bottom-0", dirty ? "translate-y-0" : "pointer-events-none translate-y-[200%]")}>
        <div className="mx-auto mb-3 flex max-w-3xl items-center justify-between gap-3 rounded-xl border border-border bg-elevated px-4 py-3 shadow-float">
          <span className="text-sm text-subtle">Unsaved changes</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setP(q.data!)}>
              Discard
            </Button>
            <Button size="sm" onClick={onSave} loading={save.isPending}>
              Save preferences
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
