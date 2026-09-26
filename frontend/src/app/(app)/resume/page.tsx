"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, RefreshCw, Upload } from "lucide-react";
import { useRef, useState } from "react";

import { VersionStatusBadge } from "@/components/domain";
import { Alert, Badge, Button, Card, CardBody, CardHeader, Empty, Loading, Meter, PageHeader, Spinner } from "@/components/ui";
import { ApiError, api, download } from "@/lib/api";
import { useResume } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { cn, fmtDateTime, humanize } from "@/lib/utils";

const ACCEPT = ".pdf,.docx,.txt";
const MAX_MB = 5; // keep in sync with MAX_UPLOAD_BYTES on the backend

function Uploader({ compact }: { compact?: boolean }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ skills: number; experience_entries: number; warnings: string[] } | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setResult(null);
    if (!/\.(pdf|docx|txt)$/i.test(file.name)) return setError("Upload a PDF, DOCX or TXT file.");
    if (file.size > MAX_MB * 1024 * 1024) return setError(`File is larger than ${MAX_MB} MB.`);
    const fd = new FormData();
    fd.append("file", file);
    setBusy(true);
    try {
      const out = await api(S.UploadOut, "POST", "/resume/upload", fd);
      setResult(out);
      for (const key of [["resume"], ["me"], ["dashboard"], ["versions"], ["profile"]]) void qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Upload failed");
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
          "flex flex-col items-center justify-center rounded-lg border-2 border-dashed text-center transition-colors",
          compact ? "px-4 py-5" : "px-6 py-12",
          drag ? "border-primary bg-info-soft" : "border-border",
        )}
      >
        {busy ? (
          <div className="flex items-center gap-2 text-sm">
            <Spinner /> Parsing your resume…
          </div>
        ) : (
          <>
            {!compact && <Upload className="mb-3 h-6 w-6 text-muted-foreground" />}
            <p className="text-sm">
              Drag your resume here, or{" "}
              <button className="font-medium text-primary" onClick={() => input.current?.click()}>
                choose a file
              </button>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">PDF, DOCX or TXT · up to {MAX_MB} MB</p>
          </>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
            e.target.value = "";
          }}
        />
      </div>
      {error && <Alert tone="danger" className="mt-3">{error}</Alert>}
      {result && (
        <Alert tone="success" className="mt-3" title="Resume parsed">
          Found {result.skills} skills and {result.experience_entries} experience entries. Jobs will be re-scored in the background.
          {result.warnings.length > 0 && (
            <ul className="mt-1 list-disc pl-4">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
    </div>
  );
}

export default function ResumePage() {
  const resume = useResume();
  const qc = useQueryClient();
  const [reparsing, setReparsing] = useState(false);
  const noResume = resume.error instanceof ApiError && resume.error.status === 409; // no candidate profile yet

  if (resume.isLoading) return <Loading />;
  if (noResume || !resume.data)
    return (
      <>
        <PageHeader title="Resume" description="Your uploaded resume becomes your master resume. It is never modified by JobPilot." />
        <Uploader />
      </>
    );

  const { master_version: mv, file, profile, warnings } = resume.data;
  const layout = file?.layout ?? {};
  const layoutFlags = Object.entries(layout).filter(([, v]) => typeof v === "boolean" || typeof v === "number");

  const reparse = async () => {
    setReparsing(true);
    try {
      await api(S.Ok, "POST", "/resume/reparse");
      void qc.invalidateQueries({ queryKey: ["resume"] });
    } finally {
      setReparsing(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Resume"
        description="Your master resume is immutable. Edits in Profile create a new master version, and tailoring always creates separate versions."
        action={
          mv && (
            <>
              <Button variant="outline" onClick={reparse} loading={reparsing}>
                <RefreshCw className="h-4 w-4" /> Re-parse
              </Button>
              {mv.has_original && (
                <Button variant="outline" onClick={() => download(`/resume/${mv.id}/download?format=original`, file?.filename ?? "resume")}>
                  <Download className="h-4 w-4" /> Original
                </Button>
              )}
              <Button variant="outline" onClick={() => download(`/resume/${mv.id}/download?format=docx`, "resume.docx")}>
                <Download className="h-4 w-4" /> DOCX
              </Button>
              <Button variant="outline" onClick={() => download(`/resume/${mv.id}/download?format=pdf`, "resume.pdf")}>
                <Download className="h-4 w-4" /> PDF
              </Button>
            </>
          )
        }
      />

      {warnings.length > 0 && (
        <Alert tone="warning" className="mb-5" title="Parsing warnings">
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-5">
          {profile && (
            <Card>
              <CardHeader title={profile.contact.name ?? "Parsed profile"} description={[profile.contact.email, profile.contact.phone, profile.contact.location].filter(Boolean).join(" · ")} />
              <CardBody className="space-y-5 text-sm">
                {profile.summary && <p className="text-muted-foreground">{profile.summary}</p>}
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Skills ({profile.skills.length})</div>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills.map((s) => (
                      <Badge key={s.name} tone={s.sections.some((x) => x !== "skills" && x !== "certifications") ? "info" : "neutral"} title={`Evidenced in: ${s.sections.join(", ") || "skills list"}`}>
                        {s.name}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">Blue: shown in your experience or projects. Grey: listed only.</p>
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">Experience</div>
                  <ul className="space-y-3">
                    {profile.experience.map((e) => (
                      <li key={e.id}>
                        <div className="font-medium">
                          {e.title} {e.company && <span className="font-normal text-muted-foreground">· {e.company}</span>}
                          {e.is_internship && <Badge className="ml-2">Internship</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {e.start_date ?? "?"} – {e.current ? "Present" : (e.end_date ?? "?")}
                        </div>
                        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-muted-foreground">
                          {e.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
                {profile.projects.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Projects</div>
                    <ul className="space-y-2">
                      {profile.projects.map((p) => (
                        <li key={p.id}>
                          <div className="font-medium">{p.name}</div>
                          <ul className="list-disc pl-5 text-muted-foreground">
                            {p.bullets.map((b, i) => (
                              <li key={i}>{b}</li>
                            ))}
                          </ul>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {profile.education.length > 0 && (
                  <div>
                    <div className="mb-2 text-xs font-medium text-muted-foreground">Education</div>
                    {profile.education.map((e) => (
                      <div key={e.id}>
                        {e.degree} {e.field && `in ${e.field}`} <span className="text-muted-foreground">· {e.institution}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Extracted text" description="What JobPilot (and a typical ATS parser) reads from your file." />
            <CardBody>
              <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{resume.data.raw_text_preview || "—"}</pre>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {mv && (
            <Card>
              <CardHeader title="Master version" action={<VersionStatusBadge status={mv.status} />} />
              <CardBody className="space-y-3">
                <div className="text-sm">
                  v{mv.version_number} · {mv.label}
                  <div className="text-xs text-muted-foreground">{fmtDateTime(mv.created_at)}</div>
                </div>
                <Meter label="Quality index" value={mv.quality_index} />
                <Meter label="Parser compatibility" value={mv.parser_score} />
                <Meter label="Round-trip fidelity" value={mv.round_trip_score} />
                <Meter label="Formatting" value={mv.formatting_score} />
              </CardBody>
            </Card>
          )}
          {file && (
            <Card>
              <CardHeader title="Uploaded file" />
              <CardBody className="space-y-1 text-sm">
                <div className="truncate font-medium">{file.filename}</div>
                <div className="text-xs text-muted-foreground">
                  {file.type.toUpperCase()} · {(file.size / 1024).toFixed(0)} KB · {fmtDateTime(file.uploaded_at)}
                </div>
                {layoutFlags.length > 0 && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 border-t pt-2 text-xs">
                    {layoutFlags.map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-muted-foreground">{humanize(k)}</dt>
                        <dd className="text-right">{typeof v === "boolean" ? (v ? "Yes" : "No") : String(v)}</dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardBody>
            </Card>
          )}
          <Card>
            <CardHeader title="Upload a new resume" description="Creates a new master version. Older versions are kept." />
            <CardBody>
              <Uploader compact />
            </CardBody>
          </Card>
          {!profile && <Empty title="No parsed profile" />}
        </div>
      </div>
    </>
  );
}
