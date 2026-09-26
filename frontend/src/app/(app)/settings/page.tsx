"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { useEffect, useState } from "react";
import { z } from "zod";

import { Alert, Badge, Button, Card, CardBody, CardHeader, Field, Input, Loading, PageHeader, Table, Td, Th, Toggle, YesNo } from "@/components/ui";
import { ApiError, api, setToken } from "@/lib/api";
import { useApiMutation } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDateTime, humanize, splitList } from "@/lib/utils";

const LlmForm = z.object({
  base_url: z.string().trim().url("Enter the full URL, e.g. https://xxxx.trycloudflare.com").or(z.literal("")),
  model: z.string().trim().max(200),
});

function LlmSettings() {
  const status = useQuery({ queryKey: ["llm"], queryFn: () => api(S.LlmHealth, "GET", "/system/llm") });
  const [form, setForm] = useState({ base_url: "", model: "", api_key: "" });
  const [error, setError] = useState<string | null>(null);
  const qc = useQueryClient();
  const save = useApiMutation(
    (body: { base_url: string; model: string; api_key?: string }) => api(S.LlmHealth, "PUT", "/system/llm", body),
    [["llm"], ["ready"]],
  );
  const test = useApiMutation(() => api(S.LlmTest, "POST", "/system/llm/test"));

  useEffect(() => {
    if (status.data) setForm((f) => ({ ...f, base_url: status.data.base_url ?? "", model: status.data.model ?? "" }));
  }, [status.data]);

  const onSave = async () => {
    const parsed = LlmForm.safeParse(form);
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Invalid");
    setError(null);
    const out = await save.mutateAsync({ ...parsed.data, ...(form.api_key ? { api_key: form.api_key } : {}) });
    qc.setQueryData(["llm"], out);
    setForm((f) => ({ ...f, api_key: "" }));
  };

  const s = status.data;
  return (
    <Card>
      <CardHeader
        title="LLM (Qwen3-8B)"
        description="Any OpenAI-compatible endpoint. For Colab, paste the tunnel URL printed by colab/qwen3_colab_server.ipynb; it changes each Colab session. Without an LLM, everything still works with rule-based output."
        action={
          s && (
            <Badge tone={s.reachable ? "success" : s.configured ? "danger" : "neutral"}>
              {s.reachable ? "Connected" : s.configured ? "Unreachable" : "Not configured"}
            </Badge>
          )
        }
      />
      <CardBody className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Base URL" hint="/v1 is added automatically if missing.">
            <Input value={form.base_url} placeholder="https://xxxx.trycloudflare.com" onChange={(e) => setForm({ ...form, base_url: e.target.value })} />
          </Field>
          <Field label="Model">
            <Input value={form.model} placeholder="qwen3:8b" onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="API key (optional)" hint="Stored on the server only and never shown again. Leave blank to keep the current key.">
            <Input type="password" autoComplete="off" value={form.api_key} onChange={(e) => setForm({ ...form, api_key: e.target.value })} />
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        {save.error && <Alert tone="danger">{(save.error as Error).message}</Alert>}
        {test.error && <Alert tone="danger" title="Test failed">{(test.error as Error).message}</Alert>}
        {test.data && (
          <Alert tone="success" title="Model returned valid JSON">
            {test.data.model} · {test.data.latency_ms} ms
          </Alert>
        )}
        <div className="flex gap-2">
          <Button onClick={onSave} loading={save.isPending}>Save</Button>
          <Button variant="outline" onClick={() => test.mutate(undefined)} loading={test.isPending} disabled={!s?.configured}>
            Test connection
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}

function Health() {
  const ready = useQuery({ queryKey: ["ready"], queryFn: () => api(S.Ready, "GET", "/health/ready"), refetchInterval: 30000 });
  if (!ready.data) return <Card><Loading /></Card>;
  const label: Record<string, string> = { database: "PostgreSQL", vector_store: "Qdrant", llm: "LLM", embeddings: "Embeddings" };
  return (
    <Card>
      <CardHeader title="System status" action={<Badge tone={ready.data.status === "ok" ? "success" : "danger"}>{humanize(ready.data.status)}</Badge>} />
      <Table>
        <tbody>
          {Object.entries(ready.data.checks).map(([k, v]) => {
            const text = String(v);
            const ok = text === "ok" || k === "embeddings";
            return (
              <tr key={k}>
                <Td className="font-medium">{label[k] ?? humanize(k)}</Td>
                <Td>
                  <Badge tone={ok ? "success" : text.startsWith("not configured") ? "neutral" : "warning"}>{text === "ok" ? "OK" : text}</Badge>
                </Td>
              </tr>
            );
          })}
        </tbody>
      </Table>
    </Card>
  );
}

function SourceRow({ source }: { source: z.infer<typeof S.Source> }) {
  const cfg = (source.configuration ?? {}) as Record<string, unknown>;
  const listKey = source.name === "greenhouse" ? "boards" : source.name === "lever" ? "sites" : null;
  const [list, setList] = useState(listKey ? ((cfg[listKey] as string[] | undefined) ?? []).join(", ") : "");
  const update = useApiMutation((body: Record<string, unknown>) => api(S.Ok, "PUT", `/sources/${source.name}`, body), [["sources"]]);
  const destination = source.type === "destination";
  return (
    <tr>
      <Td className="font-medium">
        {humanize(source.name)}
        <div className="text-xs font-normal text-muted-foreground">{destination ? "Search links only" : humanize(source.type)}</div>
      </Td>
      <Td>
        <YesNo value={source.scraped} />
      </Td>
      <Td>
        {destination ? (
          <span className="text-xs text-muted-foreground">n/a</span>
        ) : (
          <Toggle label={source.enabled ? "On" : "Off"} checked={source.enabled} onChange={(v) => update.mutate({ enabled: v })} />
        )}
      </Td>
      <Td className="min-w-64">
        {listKey ? (
          <div className="flex gap-2">
            <Input value={list} onChange={(e) => setList(e.target.value)} aria-label={`${source.name} ${listKey}`} />
            <Button variant="outline" size="sm" className="h-9" onClick={() => update.mutate({ [listKey]: splitList(list) })} loading={update.isPending}>
              Save
            </Button>
          </div>
        ) : source.name === "adzuna" ? (
          <span className="text-xs">
            API credentials configured: <YesNo value={source.credentials_configured} />
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Never scraped. JobPilot only builds search links for you to open.</span>
        )}
        {update.error && <div className="mt-1 text-xs text-danger">{(update.error as Error).message}</div>}
      </Td>
    </tr>
  );
}

function Sources() {
  const sources = useQuery({ queryKey: ["sources"], queryFn: () => api(S.SourceList, "GET", "/sources") });
  return (
    <Card>
      <CardHeader title="Job sources" description="Public, documented job-board APIs only. Greenhouse boards and Lever sites are company slugs (e.g. gitlab, stripe)." />
      {!sources.data ? (
        <Loading />
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
  const runs = useQuery({ queryKey: ["runs"], queryFn: () => api(S.AgentRuns, "GET", "/agents/runs?limit=25"), retry: false });
  if (runs.error instanceof ApiError && runs.error.status === 409) return null;
  return (
    <Card>
      <CardHeader title="Recent agent runs" description="Each agent run is recorded for traceability." />
      {!runs.data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Agent</Th>
              <Th>Status</Th>
              <Th>Latency</Th>
              <Th>Model</Th>
              <Th>Started</Th>
            </tr>
          </thead>
          <tbody>
            {runs.data.runs.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{humanize(r.agent)}</Td>
                <Td>
                  <Badge tone={r.status === "SUCCEEDED" ? "success" : r.status === "FAILED" ? "danger" : "neutral"}>{humanize(r.status)}</Badge>
                  {r.error && <div className="mt-1 max-w-xs truncate text-xs text-danger" title={r.error}>{r.error}</div>}
                </Td>
                <Td className="tabular text-xs">{r.latency_ms !== null && r.latency_ms !== undefined ? `${(r.latency_ms / 1000).toFixed(1)} s` : "—"}</Td>
                <Td className="text-xs text-muted-foreground">{r.model ?? "Rules only"}</Td>
                <Td className="text-xs text-muted-foreground">{fmtDateTime(r.started_at)}</Td>
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
  const [confirm, setConfirm] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const exportData = async () => {
    const res = await api(z.unknown(), "GET", "/privacy/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(res, null, 2)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "jobpilot-export.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const actions = [
    { id: "resumes", label: "Delete resumes", body: "Deletes uploaded files and all resume versions." },
    { id: "applications", label: "Delete applications", body: "Deletes all applications and their history." },
    { id: "profile", label: "Delete profile", body: "Deletes your candidate profile and everything derived from it." },
    { id: "account", label: "Delete account", body: "Deletes your account and all data. This cannot be undone." },
  ];

  const run = async (id: string) => {
    setBusy(true);
    try {
      await api(S.Ok, "DELETE", `/privacy/${id}`);
      if (id === "account") {
        setToken(null);
        qc.clear();
        return;
      }
      setMessage(`${humanize(id)} deleted.`);
      await qc.invalidateQueries();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
      setConfirm(null);
      setTyped("");
    }
  };

  return (
    <Card>
      <CardHeader title="Your data" description="Export everything JobPilot stores about you, or delete it." />
      <CardBody className="space-y-4">
        <Button variant="outline" onClick={exportData}>
          <Download className="h-4 w-4" /> Export my data (JSON)
        </Button>
        {message && <Alert tone="info">{message}</Alert>}
        <div className="grid gap-3 md:grid-cols-2">
          {actions.map((a) => (
            <div key={a.id} className="rounded-md border p-3">
              <div className="text-sm font-medium">{a.label}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">{a.body}</div>
              {confirm === a.id ? (
                <div className="mt-3 space-y-2">
                  <Field label='Type "delete" to confirm'>
                    <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
                  </Field>
                  <div className="flex gap-2">
                    <Button variant="danger" size="sm" disabled={typed !== "delete"} loading={busy} onClick={() => run(a.id)}>
                      Delete permanently
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <Button variant="outline" size="sm" className="mt-3" onClick={() => { setConfirm(a.id); setTyped(""); }}>
                  {a.label}
                </Button>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-5">
        <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
          <LlmSettings />
          <Health />
        </div>
        <Sources />
        <AgentRuns />
        <Privacy />
      </div>
    </>
  );
}
