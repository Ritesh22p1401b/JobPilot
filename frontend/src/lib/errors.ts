import { ApiError } from "@/lib/api";

export interface FriendlyError {
  title: string;
  message: string;
  /** Raw technical detail, shown only behind a "Technical details" toggle. */
  detail?: string;
  retryable: boolean;
}

/** Maps any error to user-facing copy. Raw backend errors are never shown as the headline. */
export function friendlyError(err: unknown, context = "complete this action"): FriendlyError {
  if (err instanceof ApiError) {
    const detail = `${err.status || "network"}: ${err.message}`;
    switch (true) {
      case err.status === 0:
        return { title: "Can’t reach JobPilot", message: "The JobPilot server isn’t responding. Check that the API is running, then try again.", detail, retryable: true };
      case err.status === 401:
        return { title: "Your session has ended", message: "Please sign in again.", detail, retryable: false };
      case err.status === 403:
        return { title: "Not allowed", message: err.message, detail, retryable: false };
      case err.status === 404:
        return { title: "Not found", message: "This item no longer exists or you don’t have access to it.", detail, retryable: false };
      case err.status === 409:
        // 409s carry actionable, user-safe messages (e.g. "Upload a resume first", "Approve it first").
        return { title: "Action needed first", message: err.message, detail, retryable: false };
      case err.status === 413 || err.status === 422:
        return { title: "Please check your input", message: err.message, detail, retryable: false };
      case err.status === 429:
        return { title: "Slow down a moment", message: "Too many requests in a short time. Wait a minute, then try again.", detail, retryable: true };
      case err.status === 503:
        return { title: "AI model unavailable", message: "The LLM isn’t reachable right now. Everything else still works; check Settings → LLM.", detail, retryable: true };
      default:
        return { title: `We couldn’t ${context}`, message: "Something went wrong on the server. Try again in a moment.", detail, retryable: true };
    }
  }
  return { title: `We couldn’t ${context}`, message: "An unexpected error occurred.", detail: err instanceof Error ? err.message : String(err), retryable: true };
}

export function errorText(err: unknown): string {
  const f = friendlyError(err);
  return f.title === "Action needed first" || f.title === "Please check your input" ? f.message : `${f.title}. ${f.message}`;
}
