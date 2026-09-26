import { z } from "zod";

const BASE = "/api/v1";
const TOKEN_KEY = "jobpilot.token";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session simply won't persist */
  }
  window.dispatchEvent(new Event("jobpilot:auth"));
}

function detailMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail))
      return detail
        .map((d) => (d && typeof d === "object" && "msg" in d ? String((d as { msg: unknown }).msg) : String(d)))
        .join("; ");
  }
  return `Request failed (${status})`;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

async function raw(method: Method, path: string, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload: BodyInit | undefined;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${path}`, { method, headers, body: payload });
  if (res.status === 401 && token) setToken(null);
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(res.status, detailMessage(data, res.status));
  }
  return res;
}

/** JSON request, validated against a Zod schema so UI code never trusts an unexpected shape. */
export async function api<Schema extends z.ZodTypeAny>(
  schema: Schema,
  method: Method,
  path: string,
  body?: unknown,
): Promise<z.output<Schema>> {
  const res = await raw(method, path, body);
  const data: unknown = await res.json();
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    console.error("Unexpected API response", path, parsed.error.issues);
    throw new ApiError(500, `Unexpected response from ${path}`);
  }
  return parsed.data;
}

/** Download an authenticated file and hand it to the browser. */
export async function download(path: string, fallbackName: string): Promise<void> {
  const res = await raw("GET", path);
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Fetch an authenticated file as an object URL (caller must URL.revokeObjectURL it). */
export async function blobUrl(path: string): Promise<string> {
  const res = await raw("GET", path);
  return URL.createObjectURL(await res.blob());
}

export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}
