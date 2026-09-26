"use client";

import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { useRef, useState } from "react";
import type { z } from "zod";

import { Callout, Spinner } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { friendlyError } from "@/lib/errors";
import * as S from "@/lib/schemas";
import { cn } from "@/lib/utils";

export const MAX_MB = 5; // keep in sync with MAX_UPLOAD_BYTES on the backend

// What the single upload request does, shown while it runs (no per-step progress is reported by the server).
const STEPS = ["Extracting text and layout", "parsing contact, experience and skills", "creating your base resume"];

export function ResumeUploader({ compact, onDone }: { compact?: boolean; onDone?: (out: z.infer<typeof S.UploadOut>) => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ title: string; message: string } | null>(null);

  const upload = async (file: File) => {
    setError(null);
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) return setError({ title: "Unsupported file type", message: "Upload a PDF, DOCX or TXT file." });
    if (file.size > MAX_MB * 1024 * 1024) return setError({ title: "File too large", message: `The limit is ${MAX_MB} MB.` });
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const out = await api(S.UploadOut, "POST", "/resume/upload", fd);
      for (const key of [["resume"], ["me"], ["dashboard"], ["versions"], ["profile"], ["insights"]]) void qc.invalidateQueries({ queryKey: key });
      onDone?.(out);
    } catch (e) {
      const f = friendlyError(e, "read this resume");
      setError(
        e instanceof ApiError && e.status === 422
          ? { title: "We couldn’t read this resume", message: `${e.message} If it’s a scanned image, export it as a text-based PDF or DOCX.` }
          : { title: f.title, message: f.message },
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const f = e.dataTransfer.files[0];
          if (f) void upload(f);
        }}
        className={cn(
          "flex flex-col items-center justify-center rounded-xl border-2 border-dashed text-center transition-colors",
          compact ? "px-4 py-6" : "px-6 py-14",
          drag ? "border-primary bg-hover" : "border-border-strong hover:border-primary/60",
        )}
      >
        {busy ? (
          <div className="w-full max-w-xs text-left" role="status" aria-live="polite">
            <div className="mb-3 flex items-center gap-2 text-sm font-medium">
              <span className="text-primary" aria-hidden>
                ✦
              </span>
              Analyzing your resume…
            </div>
            <div className="flex items-start gap-2.5 text-[13px] text-subtle">
              <Spinner className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span>
                {STEPS.join(", ")}. This usually takes a few seconds.
              </span>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-xl border border-border bg-elevated p-3 text-primary">
              <FileUp className="h-5 w-5" aria-hidden />
            </div>
            <p className="text-sm">
              Drag your resume here, or{" "}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => input.current?.click()}>
                browse files
              </button>
            </p>
            <p className="mt-1 text-xs text-muted">PDF, DOCX or TXT · up to {MAX_MB} MB</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept=".pdf,.docx,.txt"
          className="hidden"
          aria-label="Upload resume"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <Callout tone="danger" title={error.title} className="mt-3">
          {error.message}
        </Callout>
      )}
    </div>
  );
}
