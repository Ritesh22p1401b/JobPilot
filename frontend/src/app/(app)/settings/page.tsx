"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Moon, Sun } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Badge, Button, Callout, Card, CardBody, CardHeader, Field, Input, PageHeader, Segmented, Skeleton, Table, Td, Th, Toggle, YesNo } from "@/components/ui";
import { ChipsInput } from "@/components/ui/chips-input";
import { useConfirm } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, setToken } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useApiMutation, useLlmStatus, useMe } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { currentTheme, setTheme, type Theme } from "@/lib/theme";
import { fmtDateTime, humanize } from "@/lib/utils";

const LlmForm = z.object({
  base_url: z.string().trim().url("Enter the full URL, e.g. https://xxxx.trycloudflare.com/v1").or(z.literal("")),
  model: z.string().trim().max(200),
});

function Appearance() {
  const [theme, setT] = useState<Theme>("dark");
  useEffect(() => setT(currentTheme()), []);
  return (
    <Card>
      <CardHeader title="Appearance" />
      <CardBody>
        <Segmented
          label="Theme"
          value={theme}
          onChange={(t) => {
            setTheme(t);
            setT(t);
          }}
          options={[
            { id: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
            { id: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
            { id: "comfort", label: "Eye comfort", icon: <Eye className="h-4 w-4" /> },
          ]}
        />
      </CardBody>
    </Card>
  );
}

const PROVIDER_LABEL: Record<S.LlmProvider, string> = { qwen: "Qwen3-8B (Colab)", gemini: "Google Gemini" };

function LlmSettings() {
  const status = useLlmStatus();
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ base_url: "", model: "", api_key: "" });
  const [error, setError] = useState<string | null>(null);
  const save = useApiMutation((body: { base_url: string; model: string; api_key?: string }) => api(S.LlmHealth, "PUT", "/system/llm", body), [["ready"]]);
  const test = useApiMutation(() => api(S.LlmTest, "POST", "/system/llm/test"));
  const resetToEnv = useApiMutation(() => api(S.LlmHealth, "PUT", "/system/llm", { base_url: "", model: "" }), [["ready"]]);
  // "" = follow LLM_PROVIDER from backend/.env
  const choose = useApiMutation((provider: S.LlmProvider | "") => api(S.LlmHealth, "PUT", "/system/llm", { provider }), [["ready"]]);

  const provider: S.LlmProvider = status.data?.provider ?? "qwen";
  useEffect(() => {
    // The Qwen form only mirrors the Qwen endpoint; while Gemini is active the status describes Gemini instead.
    if (status.data && (status.data.provider ?? "qwen") === "qwen")
      setForm((f) => ({ ...f, base_url: status.data.base_url ?? "", model: status.data.model ?? "qwen3:8b" }));
  }, [status.data]);

  const onChoose = async (next: S.LlmProvider | "") => {
    setError(null);
    test.reset();
    try {
      const out = await choose.mutateAsync(next);
      qc.setQueryData(["llm"], out);
      const name = PROVIDER_LABEL[out.provider ?? "qwen"];
      toast({
        tone: out.reachable ? "success" : out.configured ? "error" : "info",
        title: out.reachable ? `Using ${name} (${out.model})` : out.configured ? `${name} selected, but it isn’t reachable` : `${name} selected, but it isn’t set up`,
        body: out.configured ? undefined : out.provider === "gemini" ? "Add GEMINI_API_KEY to backend/.env." : "Add the Colab URL below or LLM_BASE_URL in backend/.env.",
      });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const onSave = async () => {
    const parsed = LlmForm.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid");
    setError(null);
    try {
      const out = await save.mutateAsync({ ...parsed.data, ...(form.api_key ? { api_key: form.api_key } : {}) });
      qc.setQueryData(["llm"], out);
      setForm((f) => ({ ...f, api_key: "" }));
      toast({ tone: out.reachable ? "success" : "error", title: out.reachable ? `Connected to ${out.model}` : "Saved, but the endpoint isn’t reachable", body: out.reachable ? undefined : "Check that the Colab notebook is still running and the URL is current." });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const onUseEnv = async () => {
    setError(null);
    try {
      const out = await resetToEnv.mutateAsync(undefined);
      qc.setQueryData(["llm"], out);
      toast({ tone: out.configured ? "success" : "info", title: out.configured ? "Using backend/.env" : "Saved URL removed", body: out.configured ? undefined : "LLM_BASE_URL in backend/.env is empty, so no model is connected." });
    } catch (e) {
      setError(errorText(e));
    }
  };

  const s = status.data;
  const gemini = s?.providers?.gemini;
  return (
    <Card>
      <CardHeader
        title={`AI model (${PROVIDER_LABEL[provider]})`}
        description="Choose which model writes explanations and tailored text. Both use the same prompts, and every output is validated. Without a model, matching, ATS tests and tailoring still work; explanations use rules."
        action={s && <Badge tone={s.reachable ? "success" : s.configured ? "danger" : "warning"}>{s.reachable ? "● Connected" : s.configured ? "● Unreachable" : "● Not connected"}</Badge>}
      />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented<S.LlmProvider>
            label="LLM provider"
            value={provider}
            onChange={(p) => p !== provider && void onChoose(p)}
            options={(["qwen", "gemini"] as const).map((p) => ({
              id: p,
              label: (
                <>
                  {PROVIDER_LABEL[p]}
                  {s?.providers && !s.providers[p].configured && <span className="text-[11px] font-normal text-muted">(not set up)</span>}
                </>
              ),
            }))}
          />
          {choose.isPending && <span className="text-xs text-muted">Switching…</span>}
        </div>

        {s && (
          <Callout tone="info" title={s.source === "settings" ? `${PROVIDER_LABEL[provider]} chosen on this page` : "Following backend/.env"}>
            {s.source === "settings" ? (
              <>
                This choice overrides <code>LLM_PROVIDER</code> in backend/.env.{" "}
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => void onChoose("")}>
                  Follow backend/.env instead
                </button>
              </>
            ) : (
              <>
                <code>LLM_PROVIDER</code> in backend/.env selects the model (<code>qwen</code> or <code>gemini</code>). Edits to that file apply within seconds; no restart
                needed.
              </>
            )}
          </Callout>
        )}

        {provider === "gemini" ? (
          <div className="space-y-2 rounded-lg border border-border bg-background px-4 py-3 text-[13px]">
            <div className="flex justify-between gap-3">
              <span className="text-subtle">Model</span>
              <span className="font-medium">{gemini?.model ?? s?.model ?? "–"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-subtle">API key</span>
              <span className={gemini?.configured ? "text-success" : "text-warning"}>{gemini?.configured ? "✓ Set in backend/.env" : "⚠ Missing: add GEMINI_API_KEY to backend/.env"}</span>
            </div>
            <p className="text-xs text-muted">
              Change <code>GEMINI_MODEL</code> or <code>GEMINI_API_KEY</code> in backend/.env. The key stays on the server and is never sent to the browser.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Base URL" htmlFor="llm-url" hint="“/v1” is added if missing.">
              <Input id="llm-url" value={form.base_url} placeholder="https://xxxx.trycloudflare.com/v1" onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
            </Field>
            <Field label="Model" htmlFor="llm-model">
              <Input id="llm-model" value={form.model} placeholder="qwen3:8b" onChange={(e) => setForm({ ...form, model: e.target.value })} />
            </Field>
            <Field label="API key" htmlFor="llm-key" hint="Stored on the server only and never shown again. Leave blank to keep the current key.">
              <Input id="llm-key" type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
            </Field>
          </div>
        )}
        {error && <Callout tone="danger">{error}</Callout>}
        {test.error && (
          <Callout tone="danger" title="Test failed">
            {errorText(test.error)}
          </Callout>
        )}
        {test.data && (
          <Callout tone="success" title="The model returned valid JSON">
            {test.data.model} · {test.data.latency_ms} ms
          </Callout>
        )}
        <div className="flex gap-2">
          {provider === "qwen" && (
            <Button onClick={onSave} loading={save.isPending}>
              Save
            </Button>
          )}
          <Button variant="secondary" onClick={() => test.mutate(undefined)} loading={test.isPending} disabled={!s?.configured}>
            Test connection
          </Button>
          {provider === "qwen" && s?.base_url && s.source === "settings" && (
            <Button variant="ghost" onClick={onUseEnv} loading={resetToEnv.isPending}>
              Use LLM_BASE_URL from backend/.env
            </Button>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Health() {
  const ready = useQuery({ queryKey: ["ready"], queryFn: () => api(S.Ready, "GET", "/health/ready"), refetchInterval: 30000 });
  const label: Record<string, string> = { database: "PostgreSQL", vector_store: "Qdrant (vectors)", llm: "AI model", embeddings: "Embeddings" };
  return (
    <Card>
      <CardHeader title="System status" action={ready.data && <Badge tone={ready.data.status === "ok" ? "success" : "danger"}>{ready.data.status === "ok" ? "✓ Healthy" : "⚠ Degraded"}</Badge>} />
      <CardBody className="space-y-2.5">
        {!ready.data && <Skeleton className="h-24" />}
        {ready.data &&
          Object.entries(ready.data.checks).map(([k, v]) => {
            const text = String(v);
            const ok = text === "ok" || k === "embeddings";
            return (
              <div key={k} className="flex items-start justify-between gap-3 text-[13px]">
                <span className="text-subtle">{label[k] ?? humanize(k)}</span>
                <span className={ok ? "text-success" : text.startsWith("not configured") ? "text-warning" : "text-danger"}>{ok ? (k === "embeddings" ? `✓ ${text}` : "✓ OK") : `⚠ ${text}`}</span>
              </div>
            );
          })}
      </CardBody>
    </Card>
  );
}

function SourceRow({ source }: { source: z.infer<typeof S.Source> }) {
  const cfg = (source.configuration ?? {}) as Record<string, unknown>;
  const listKey = source.name === "greenhouse" ? "boards" : source.name === "lever" ? "sites" : null;
  const [list, setList] = useState<string[]>(listKey ? ((cfg[listKey] as string[] | undefined) ?? []) : []);
  const toast = useToast();
  const update = useApiMutation((body: Record<string, unknown>) => api(S.Ok, "PUT", `/sources/${source.name}`, body), [["sources"]]);
  const destination = source.type === "destination";
  const run = (body: Record<string, unknown>, msg: string) =>
    update.mutate(body, { onSuccess: () => toast({ tone: "success", title: msg }), onError: (e) => toast({ tone: "error", title: "Couldn’t update source", body: errorText(e) }) });
  return (
    <tr>
      <Td className="font-medium whitespace-nowrap">
        {humanize(source.name)}
        <div className="text-xs font-normal text-muted">{destination ? "Search links only" : humanize(source.type)}</div>
      </Td>
      <Td>
        <YesNo value={source.scraped} />
      </Td>
      <Td>{destination ? <span className="text-xs text-muted">n/a</span> : <Toggle label={<span className="sr-only">Enable {source.name}</span>} checked={source.enabled} onChange={(v) => run({ enabled: v }, v ? "Source enabled" : "Source disabled")} />}</Td>
      <Td className="min-w-72">
        {listKey ? (
          <div className="space-y-2">
            <ChipsInput value={list} onChange={setList} placeholder="company slug, e.g. gitlab" ariaLabel={`${source.name} ${listKey}`} />
            <Button size="sm" variant="secondary" onClick={() => run({ [listKey]: list }, "Company list saved")} loading={update.isPending}>
              Save {listKey}
            </Button>
          </div>
        ) : source.name === "adzuna" ? (
          <span className="text-xs text-subtle">
            API credentials configured: <YesNo value={source.credentials_configured} />
          </span>
        ) : (
          <span className="text-xs text-muted">Never scraped. JobPilot only builds search links for you to open.</span>
        )}
      </Td>
    </tr>
  );
}

function Sources() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api(S.SourceList, "GET", "/sources") });
  return (
    <Card>
      <CardHeader title="Job sources" description="Public, documented job-board APIs only. Greenhouse boards and Lever sites are company slugs from their job-board URLs (e.g. gitlab, stripe)." />
      {!sources.data ? (
        <CardBody>
          <Skeleton className="h-40" />
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th>Scraped</Th>
              <Th>Enabled</Th>
              <Th>Configuration</Th>
            </tr>
          </thead>
          <tbody>
            {sources.data.sources.map((s) => (
              <SourceRow key={s.name} source={s} />
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AgentRuns() {
  const me = useMe();
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api(S.AgentRuns, "GET", "/agents/runs?limit=25"), enabled: !!me.data?.has_profile, retry: false });
  if (!me.data?.has_profile || (runs.error instanceof ApiError && runs.error.status === 409)) return null;
  return (
    <Card>
      <CardHeader title="Agent activity" description="Every agent run is recorded for transparency." />
      {!runs.data ? (
        <CardBody>
          <Skeleton className="h-32" />
        </CardBody>
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Status</Th>
              <Th>Duration</Th>
              <Th>Model</Th>
              <Th>Started</Th>
            </tr>
          </thead>
          <tbody>
            {runs.data.runs.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium whitespace-nowrap">{humanize(r.agent)}</Td>
                <Td>
                  <Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : "neutral"}>
                    {r.status === "SUCCEEDED" ? "✓ Succeeded" : r.status === "FAILED" ? "✕ Failed" : humanize(r.status)}
                  </Badge>
                  {r.error && (
                    <div className="mt-1 max-w-xs truncate text-xs text-danger" title={r.error}>
                      {r.error}
                    </div>
                  )}
                </Td>
                <Td className="tabular font-mono text-xs">{r.latency_ms !== null && r.latency_ms !== undefined ? `${(r.latency_ms / 1000).toFixed(1)} s` : "—"}</Td>
                <Td className="text-xs text-subtle">{r.model ?? "Rules only"}</Td>
                <Td className="text-xs whitespace-nowrap text-muted">{fmtDateTime(r.started_at)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function Privacy() {
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const exportData = async () => {
    try {
      const res = await api(z.unknown(), "GET", "/privacy/export");
      const url = URL.createObjectURL(new Blob([JSON.stringify(res, null, 2)], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "jobpilot-export.json";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      toast({ tone: "error", title: "Export failed", body: errorText(e) });
    }
  };

  const actions = [
    { id: "resumes", label: "Delete resumes", body: "Deletes uploaded files and every resume version, including tailored ones." },
    { id: "applications", label: "Delete applications", body: "Deletes all applications and their history." },
    { id: "profile", label: "Delete profile", body: "Deletes your profile and everything derived from it: resumes, matches and applications." },
    { id: "account", label: "Delete account", body: "Deletes your account and all of its data. You’ll be signed out." },
  ];

  const run = async (a: (typeof actions)[number]) => {
    const ok = await confirm({ title: `${a.label} permanently?`, body: `${a.body} This can’t be undone.`, confirmLabel: a.label, tone: "danger", typeToConfirm: "delete" });
    if (!ok) return;
    setBusy(a.id);
    try {
      await api(S.Ok, "DELETE", `/privacy/${a.id}`);
      if (a.id === "account") {
        setToken(null);
        qc.clear();
        router.replace("/");
        return;
      }
      toast({ tone: "success", title: `${a.label.replace("Delete ", "")} deleted` });
      await qc.invalidateQueries();
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t delete", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <CardHeader title="Your data" description="Export everything JobPilot stores about you, or delete it." action={<Button variant="secondary" onClick={exportData}><Download className="h-4 w-4" /> Export (JSON)</Button>} />
      <CardBody className="grid gap-3 md:grid-cols-2">
        {actions.map((a) => (
          <div key={a.id} className="flex flex-col justify-between gap-3 rounded-xl border border-border p-4">
            <div>
              <div className="text-sm font-medium">{a.label}</div>
              <p className="mt-0.5 text-xs text-muted">{a.body}</p>
            </div>
            <Button variant="secondary" size="sm" className="self-start text-danger" onClick={() => run(a)} loading={busy === a.id}>
              {a.label}
            </Button>
          </div>
        ))}
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Workspace, AI model, job sources and your data." />
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
          <LlmSettings />
          <div className="space-y-5">
            <Health />
            <Appearance />
          </div>
        </div>
        <Sources />
        <AgentRuns />
        <Privacy />
      </div>
    </>
  );
}
