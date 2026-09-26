"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Alert, Button, Card, Field, Input, Tabs } from "@/components/ui";
import { api, setToken } from "@/lib/api";
import { useToken } from "@/lib/hooks";
import { TokenOut } from "@/lib/schemas";

const Credentials = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(8, "At least 8 characters").max(128),
});

export default function AuthPage() {
  const router = useRouter();
  const token = useToken();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token) router.replace("/dashboard");
  }, [token, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = Credentials.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const out = await api(TokenOut, "POST", mode === "login" ? "/auth/login" : "/auth/register", parsed.data);
      setToken(out.access_token);
      router.replace(mode === "register" ? "/resume" : "/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto grid min-h-screen max-w-5xl items-center gap-10 px-4 py-10 md:grid-cols-2">
      <section>
        <div className="text-sm font-semibold text-primary">JobPilot AI</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">Find jobs that fit — with evidence, not guesses.</h1>
        <ul className="mt-6 space-y-3 text-sm text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">Public job APIs only.</span> Greenhouse, Lever and Adzuna. LinkedIn and
            Indeed are never scraped; you get search links instead.
          </li>
          <li>
            <span className="font-medium text-foreground">Traceable match scores.</span> Every requirement shows the resume
            evidence behind it, or says plainly that there is none.
          </li>
          <li>
            <span className="font-medium text-foreground">Truthful tailoring.</span> Your master resume is never changed, and
            tailored versions contain only claims backed by it.
          </li>
          <li>
            <span className="font-medium text-foreground">You stay in control.</span> Auto-apply is off by default; applications
            are prepared for your review.
          </li>
        </ul>
      </section>

      <Card className="p-6">
        <Tabs
          value={mode}
          onChange={setMode}
          tabs={[
            { id: "login", label: "Sign in" },
            { id: "register", label: "Create account" },
          ]}
        />
        <form onSubmit={submit} className="mt-5 space-y-4" noValidate>
          <Field label="Email" error={errors.email}>
            <Input
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </Field>
          <Field label="Password" error={errors.password} hint={mode === "register" ? "At least 8 characters." : undefined}>
            <Input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
          <Button type="submit" className="w-full" loading={busy}>
            {mode === "login" ? "Sign in" : "Create account"}
          </Button>
        </form>
      </Card>
    </main>
  );
}
