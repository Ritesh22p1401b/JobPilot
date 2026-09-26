"use client";

import { ArrowRight, Check, Eye, EyeOff, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Button, Callout, Field, Input } from "@/components/ui";
import { ApiError, api, setToken } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import { useToken } from "@/lib/hooks";
import { Me, TokenOut } from "@/lib/schemas";
import { cn } from "@/lib/utils";

const Email = z.string().trim().min(1, "Enter your email address").email("That doesn’t look like a valid email address");

const RULES = [
  { id: "len", label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { id: "case", label: "Upper and lower case letters", test: (p: string) => /[a-z]/.test(p) && /[A-Z]/.test(p) },
  { id: "num", label: "A number", test: (p: string) => /\d/.test(p) },
  { id: "sym", label: "A symbol", test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

function strength(p: string): { score: number; label: string; color: string } {
  const score = RULES.filter((r) => r.test(p)).length;
  return [
    { score, label: "Too short", color: "var(--danger)" },
    { score, label: "Weak", color: "var(--danger)" },
    { score, label: "Fair", color: "var(--warning)" },
    { score, label: "Good", color: "var(--primary)" },
    { score, label: "Strong", color: "var(--success)" },
  ][score]!;
}

function PasswordInput({ id, value, onChange, autoComplete, invalid }: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input id={id} type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} className="h-10 pr-10" aria-invalid={invalid || undefined} />
      <button type="button" onClick={() => setShow(!show)} className="absolute top-1/2 right-2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-foreground" aria-label={show ? "Hide password" : "Show password"} aria-pressed={show}>
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

/** Sign-in / sign-up form with inline validation and friendly errors. */
export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const token = useToken();
  const next = params.get("next");
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const route = async () => {
    try {
      const me = await api(Me, "GET", "/auth/me");
      router.replace(me.has_profile ? (safeNext ?? "/dashboard") : "/onboarding");
    } catch {
      router.replace("/dashboard");
    }
  };

  useEffect(() => {
    if (token && !busy) void route();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to an existing session on load
  }, [token]);

  const emailErr = touched ? Email.safeParse(email).error?.issues[0]?.message : undefined;
  const pwErr = touched ? (mode === "signup" ? (password.length < 8 ? "Use at least 8 characters" : undefined) : !password ? "Enter your password" : undefined) : undefined;
  const confirmErr = touched && mode === "signup" && confirmPw !== password ? "Passwords don’t match" : undefined;
  const s = strength(password);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched(true);
    setError(null);
    if (!Email.safeParse(email).success || (mode === "signup" ? password.length < 8 || confirmPw !== password : !password)) return;
    setBusy(true);
    try {
      const out = await api(TokenOut, "POST", mode === "login" ? "/auth/login" : "/auth/register", { email: email.trim(), password });
      setToken(out.access_token);
      if (mode === "signup") router.replace("/onboarding");
      else await route();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError({ title: "Email or password is incorrect", message: "Check them and try again." });
      else if (err instanceof ApiError && err.status === 409) setError({ title: "You already have an account", message: "Sign in with this email instead." });
      else {
        const f = friendlyError(err, mode === "login" ? "sign you in" : "create your account");
        setError({ title: f.title, message: f.message });
      }
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {error && (
        <Callout tone="danger" title={error.title}>
          {error.message}
          {error.title === "You already have an account" && (
            <>
              {" "}
              <Link href={`/login${safeNext ? `?next=${encodeURIComponent(safeNext)}` : ""}`} className="font-medium text-primary hover:underline">
                Sign in
              </Link>
            </>
          )}
        </Callout>
      )}
      <Field label="Email" htmlFor="email" error={emailErr}>
        <Input id="email" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" aria-invalid={!!emailErr || undefined} autoFocus />
      </Field>
      <Field label="Password" htmlFor="password" error={pwErr}>
        <PasswordInput id="password" value={password} onChange={setPassword} autoComplete={mode === "login" ? "current-password" : "new-password"} invalid={!!pwErr} />
      </Field>
      {mode === "signup" && (
        <>
          {password && (
            <div aria-live="polite">
              <div className="flex items-center gap-2">
                <div className="flex flex-1 gap-1" aria-hidden>
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-1 flex-1 rounded-full bg-hover" style={i <= s.score ? { background: s.color } : undefined} />
                  ))}
                </div>
                <span className="w-16 text-right text-xs text-subtle">{s.label}</span>
              </div>
              <ul className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {RULES.map((r) => {
                  const ok = r.test(password);
                  return (
                    <li key={r.id} className={cn("flex items-center gap-1.5", ok ? "text-subtle" : "text-muted")}>
                      {ok ? <Check className="h-3 w-3 text-success" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                      {r.label}
                      <span className="sr-only">{ok ? "(met)" : "(not met)"}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <Field label="Confirm password" htmlFor="confirm" error={confirmErr}>
            <PasswordInput id="confirm" value={confirmPw} onChange={setConfirmPw} autoComplete="new-password" invalid={!!confirmErr} />
          </Field>
        </>
      )}
      <Button type="submit" size="lg" className="w-full" loading={busy}>
        {mode === "login" ? "Sign in" : "Create account"} {!busy && <ArrowRight className="h-4 w-4" />}
      </Button>
      <p className="text-center text-sm text-subtle">
        {mode === "login" ? (
          <>
            New to JobPilot?{" "}
            <Link href="/signup" className="font-medium text-primary hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-primary hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>
      {mode === "signup" && <p className="text-center text-xs text-muted">Your resume and data stay on this JobPilot server. You can export or delete everything at any time in Settings.</p>}
    </form>
  );
}
