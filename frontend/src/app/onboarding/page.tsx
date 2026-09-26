"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Rocket } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { AIThinking, PIPELINES } from "@/components/ai/thinking";
import { Logo } from "@/components/auth/auth-shell";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { ResumeUploader } from "@/components/resume/uploader";
import { Badge, Button, Callout, Card, ChipGroup, Field, Input, PageSkeleton, Select } from "@/components/ui";
import { ChipsInput } from "@/components/ui/chips-input";
import { api } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useMe, usePreferences, useResume, useTaskTracker, useToken } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, humanize } from "@/lib/utils";

const STEPS = ["Welcome", "Resume", "Profile", "Target roles", "Preferences", "Skills", "First matches"] as const;

export default function OnboardingPage() {
  const token = useToken();
  const router = useRouter();
  const qc = useQueryClient();
  const me = useMe();
  const [step, setStep] = useState(0);
  const hasProfile = !!me.data?.has_profile;
  const resume = useResume(hasProfile);
  const prefsQ = usePreferences();

  const [contact, setContact] = useState<S.Profile["contact"] | null>(null);
  const [skills, setSkills] = useState<string[]>([]);
  const [roles, setRoles] = useState<string[]>([]);
  const [prefs, setPrefs] = useState<S.Preferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tracker = useTaskTracker([["jobs"], ["insights"], ["dashboard"]]);

  useEffect(() => {
    if (token === null) router.replace("/login?next=/onboarding");
  }, [token, router]);
  const profile = resume.data?.profile ?? null;
  useEffect(() => {
    if (!profile) return;
    setContact(profile.contact);
    setSkills(profile.skills.map((s) => s.name));
    setRoles(profile.target_roles.slice(0, 5));
  }, [profile]);
  useEffect(() => {
    if (prefsQ.data && !prefs) setPrefs(prefsQ.data);
  }, [prefsQ.data, prefs]);

  if (!token || me.isLoading)
    return (
      <div className="mx-auto max-w-2xl p-8">
        <PageSkeleton rows={2} />
      </div>
    );

  const next = () => setStep((s) => Math.min(STEPS.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  const finish = async () => {
    if (!prefs || !contact || !profile) return;
    setSaving(true);
    setError(null);
    try {
      const original = profile.skills.map((s) => s.name);
      const skillsChanged = skills.length !== original.length || skills.some((s) => !original.includes(s));
      const contactChanged = JSON.stringify(contact) !== JSON.stringify(profile.contact);
      const rolesChanged = JSON.stringify(roles) !== JSON.stringify(profile.target_roles);
      if (skillsChanged || contactChanged || rolesChanged) {
        // Keep the parser's evidence for skills that stayed; new skills are user-stated facts.
        const kept = profile.skills.filter((s) => skills.includes(s.name));
        const added = skills.filter((s) => !original.includes(s)).map((name) => ({ name, category: "other", sections: ["skills"], known: true }));
        await api(S.ProfileUpdateOut, "PATCH", "/profile", { contact, skills: [...kept, ...added], target_roles: roles });
      }
      await api(S.Preferences, "PUT", "/preferences", { ...prefs, target_titles: prefs.target_titles.length ? prefs.target_titles : roles });
      const out = await api(S.SearchOut, "POST", "/jobs/search", {});
      tracker.start(out.task.id);
      next();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };

  const setP = <K extends keyof S.Preferences>(k: K, v: S.Preferences[K]) => prefs && setPrefs({ ...prefs, [k]: v });

  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between border-b border-border px-5 md:px-10">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle compact />
          {hasProfile && step < STEPS.length - 1 && (
            <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
              Skip for now
            </Button>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-2xl px-5 py-10">
        <ol className="mb-10 flex items-center gap-1.5" aria-label="Onboarding progress">
          {STEPS.map((s, i) => (
            <li key={s} className="flex-1" aria-current={i === step ? "step" : undefined}>
              <div className={cn("h-1 rounded-full transition-colors", i <= step ? "bg-primary" : "bg-border")} />
              <span className={cn("mt-2 hidden text-[11px] sm:block", i === step ? "text-foreground" : "text-muted")}>{s}</span>
            </li>
          ))}
        </ol>

        <div key={step} className="animate-rise">
          {step === 0 && (
            <section>
              <Badge tone="primary">✦ Welcome to JobPilot</Badge>
              <h1 className="mt-4 text-3xl font-semibold tracking-tight">Let’s set up your workspace</h1>
              <p className="mt-3 text-subtle">It takes about two minutes. JobPilot reads your resume, confirms a few details with you, and then finds and scores jobs that fit.</p>
              <ul className="mt-6 space-y-2.5 text-sm">
                {["Upload your existing resume", "Confirm your profile and target roles", "Set location, work mode and salary", "Review your skills", "Get your first scored matches"].map((t) => (
                  <li key={t} className="flex items-center gap-2.5 text-subtle">
                    <Check className="h-4 w-4 text-primary" aria-hidden /> {t}
                  </li>
                ))}
              </ul>
              <Button size="lg" className="mt-8" onClick={next}>
                Get started <ArrowRight className="h-4 w-4" />
              </Button>
            </section>
          )}

          {step === 1 && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">Upload your resume</h1>
              <p className="mt-2 text-sm text-subtle">It becomes your base resume. JobPilot never modifies it; tailored versions are always created separately.</p>
              <div className="mt-6">
                <ResumeUploader onDone={() => next()} />
              </div>
              {hasProfile && (
                <Callout tone="info" className="mt-4" title="You already have a base resume" action={<Button size="sm" variant="secondary" onClick={next}>Use my current resume</Button>}>
                  Upload a new file only if you want to replace it.
                </Callout>
              )}
              <div className="mt-8 flex justify-between">
                <Button variant="ghost" onClick={back}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
              </div>
            </section>
          )}

          {step === 2 && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">Confirm your profile</h1>
              <p className="mt-2 text-sm text-subtle">This is what we extracted. Your profile is the single source of truth for matching, tailoring and applications.</p>
              {!profile || !contact ? (
                <div className="mt-6">
                  <PageSkeleton rows={1} />
                </div>
              ) : (
                <>
                  {resume.data!.warnings.length > 0 && (
                    <Callout tone="warning" className="mt-5" title="Please double-check">
                      <ul className="list-disc pl-4">
                        {resume.data!.warnings.map((w) => (
                          <li key={w}>{w}</li>
                        ))}
                      </ul>
                    </Callout>
                  )}
                  <Card className="mt-5 p-5">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(["name", "email", "phone", "location"] as const).map((k) => (
                        <Field key={k} label={humanize(k)} htmlFor={`c-${k}`}>
                          <Input id={`c-${k}`} value={contact[k] ?? ""} onChange={(e) => setContact({ ...contact, [k]: e.target.value || null })} />
                        </Field>
                      ))}
                    </div>
                  </Card>
                  <Card className="mt-4 p-5">
                    <div className="mb-3 flex items-center justify-between">
                      <span className="text-sm font-medium">Experience</span>
                      <span className="text-xs text-muted">
                        {Math.round((profile.total_experience_months / 12) * 10) / 10} years
                        {profile.internship_months ? ` + ${profile.internship_months} months internship` : ""}
                      </span>
                    </div>
                    {profile.experience.length ? (
                      <ul className="space-y-2.5">
                        {profile.experience.map((e) => (
                          <li key={e.id} className="flex items-start justify-between gap-3 text-sm">
                            <div>
                              <div className="font-medium">{e.title ?? "Untitled role"}</div>
                              <div className="text-xs text-subtle">{e.company}</div>
                            </div>
                            <span className="text-xs whitespace-nowrap text-muted">
                              {e.start_date ?? "?"} – {e.current ? "Present" : (e.end_date ?? "?")}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-sm text-muted">No experience entries found. You can add them later in Profile.</p>
                    )}
                    <p className="mt-3 text-xs text-muted">Need to fix a role or bullet? You can edit everything later in Profile.</p>
                  </Card>
                </>
              )}
              <Nav back={back} next={next} disabled={!contact?.name} />
            </section>
          )}

          {step === 3 && prefs && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">What roles are you targeting?</h1>
              <p className="mt-2 text-sm text-subtle">Used to search job boards and to score role fit.</p>
              <div className="mt-6 space-y-5">
                <Field label="Target roles" htmlFor="roles" hint="Press Enter after each role.">
                  <ChipsInput id="roles" value={roles} onChange={(v) => { setRoles(v); setP("target_titles", v); }} placeholder="e.g. AI Engineer" suggestions={profile?.target_roles ?? []} />
                </Field>
                <Field label="Locations" htmlFor="locs" hint="Cities or “Remote”.">
                  <ChipsInput id="locs" value={prefs.locations} onChange={(v) => setP("locations", v)} placeholder="e.g. Bengaluru" suggestions={[profile?.contact.location, "Remote"].filter((x): x is string => !!x)} />
                </Field>
              </div>
              <Nav back={back} next={next} disabled={!roles.length} />
            </section>
          )}

          {step === 4 && prefs && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">Your preferences</h1>
              <p className="mt-2 text-sm text-subtle">Jobs that clearly conflict with these are filtered out, and the reason is always shown.</p>
              <div className="mt-6 space-y-6">
                <Field label="Work mode">
                  <ChipGroup label="Work mode" options={S.WORK_MODES} value={prefs.work_modes} onChange={(v) => setP("work_modes", v)} format={humanize} />
                </Field>
                <Field label="Job type">
                  <ChipGroup label="Job type" options={S.EMPLOYMENT_TYPES} value={prefs.employment_types} onChange={(v) => setP("employment_types", v)} format={humanize} />
                </Field>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Experience level" htmlFor="lvl">
                    <Select id="lvl" value={prefs.experience_level ?? ""} onChange={(e) => setP("experience_level", (e.target.value || null) as S.Preferences["experience_level"])}>
                      <option value="">Not specified</option>
                      {S.EXPERIENCE_LEVELS.map((l) => (
                        <option key={l} value={l}>
                          {humanize(l)}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Need visa sponsorship?" htmlFor="visa" hint="Only what you state is used; never inferred.">
                    <Select id="visa" value={prefs.visa_sponsorship_required === null ? "" : prefs.visa_sponsorship_required ? "yes" : "no"} onChange={(e) => setP("visa_sponsorship_required", e.target.value === "" ? null : e.target.value === "yes")}>
                      <option value="">Prefer not to say</option>
                      <option value="yes">Yes</option>
                      <option value="no">No</option>
                    </Select>
                  </Field>
                  <Field label="Minimum yearly salary (optional)" htmlFor="sal">
                    <Input id="sal" type="number" min={0} inputMode="numeric" value={prefs.minimum_salary ?? ""} onChange={(e) => setP("minimum_salary", e.target.value === "" ? null : Number(e.target.value))} />
                  </Field>
                  <Field label="Currency" htmlFor="cur">
                    <Input id="cur" maxLength={3} value={prefs.currency} onChange={(e) => setP("currency", e.target.value.toUpperCase())} />
                  </Field>
                </div>
              </div>
              <Nav back={back} next={next} disabled={!prefs.work_modes.length} />
            </section>
          )}

          {step === 5 && (
            <section>
              <h1 className="text-2xl font-semibold tracking-tight">Review your skills</h1>
              <p className="mt-2 text-sm text-subtle">Remove anything that isn’t accurate and add skills you genuinely have. Matching only counts skills you’ve listed or demonstrated.</p>
              <div className="mt-6">
                <ChipsInput value={skills} onChange={setSkills} placeholder="Add a skill and press Enter" ariaLabel="Skills" />
                <p className="mt-2 text-xs text-muted">{skills.length} skills. Skills you add here are treated as your own statement; they’re strongest when also shown in your experience.</p>
              </div>
              {error && (
                <Callout tone="danger" className="mt-4" title="Couldn’t save">
                  {error}
                </Callout>
              )}
              <div className="mt-8 flex justify-between">
                <Button variant="ghost" onClick={back}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button size="lg" onClick={finish} loading={saving}>
                  <Rocket className="h-4 w-4" /> Find my first matches
                </Button>
              </div>
            </section>
          )}

          {step === 6 && (
            <section className="text-center">
              <h1 className="text-2xl font-semibold tracking-tight">{tracker.done ? "Your JobPilot workspace is ready" : "Finding your first matches…"}</h1>
              <p className="mt-2 text-sm text-subtle">{tracker.done ? "Your matches are scored and explained. Here’s where to start." : "This runs in the background. It usually takes one to two minutes."}</p>
              <AIThinking tracker={tracker} steps={PIPELINES.search} title="Searching public job boards and scoring every job against your resume." className="mx-auto mt-8 max-w-md text-left" />
              {tracker.failed && (
                <Callout tone="danger" className="mx-auto mt-4 max-w-md text-left" title="The search didn’t finish">
                  You can run it again from Job Search.
                </Callout>
              )}
              <div className="mt-8 flex justify-center gap-3">
                <Button
                  size="lg"
                  onClick={() => {
                    void qc.invalidateQueries();
                    router.push("/dashboard");
                  }}
                  variant={tracker.done ? "primary" : "secondary"}
                >
                  {tracker.done ? "Open my dashboard" : "Continue to dashboard"} <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Nav({ back, next, disabled }: { back: () => void; next: () => void; disabled?: boolean }) {
  return (
    <div className="mt-8 flex justify-between">
      <Button variant="ghost" onClick={back}>
        <ArrowLeft className="h-4 w-4" /> Back
      </Button>
      <Button onClick={next} disabled={disabled}>
        Continue <ArrowRight className="h-4 w-4" />
      </Button>
    </div>
  );
}
