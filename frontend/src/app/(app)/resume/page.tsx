"use client";

import { useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Gauge, Pencil, RefreshCw, Upload } from "lucide-react";
import { useState } from "react";

import { ResumeUploader } from "@/components/resume/uploader";
import { Badge, Button, ButtonLink, Callout, Card, CardBody, CardHeader, Chip, EmptyState, ErrorState, Meter, PageHeader, PageSkeleton, ScoreRing } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { ApiError, api, download } from "@/lib/api";
import { errorText } from "@/lib/errors";
import { useResume } from "@/lib/hooks";
import * as S from "@/lib/schemas";
import { fmtDateTime } from "@/lib/utils";

const num = (v: unknown) => (typeof v === "number" ? v : 0);

/** Parsing-risk checks derived from the layout the backend measured (text_extraction.py). */
function layoutRisks(layout: Record<string, unknown>): [string, boolean, string][] {
  if (layout.plain_text) return [];
  return [
    ["Multi-column layout", num(layout.multi_column_pages) > 0, "Columns are often read in the wrong order."],
    ["Tables", num(layout.tables) > 0, "Some parsers skip or scramble table cells."],
    ["Images or graphics", num(layout.images) + num(layout.graphics) > 0, "Text inside images can’t be read."],
    ["Text boxes", num(layout.text_boxes) > 0, "Text-box content is invisible to many parsers."],
    ["Text in header or footer", Array.isArray(layout.header_footer_text) ? layout.header_footer_text.length > 0 : !!layout.header_footer_text, "Contact details in headers are often missed."],
    ["Very small fonts", num(layout.small_font_ratio) > 0.1, "Fonts under 8.5pt can be hard to extract."],
    ["Scanned / image-based", !!layout.image_based, "Needs OCR; export a text-based PDF instead."],
  ];
}

function Risk({ present }: { present: boolean }) {
  return present ? <Badge tone="warning">⚠ Yes</Badge> : <Badge tone="success">✓ No</Badge>;
}

export default function ResumePage() {
  const resume = useResume();
  const qc = useQueryClient();
  const toast = useToast();
  const [replacing, setReplacing] = useState(false);
  const [reparsing, setReparsing] = useState(false);
  const noResume = resume.error instanceof ApiError && resume.error.status === 409;

  if (resume.isLoading) return <PageSkeleton rows={3} />;
  if (noResume)
    return (
      <>
        <PageHeader title="Base Resume" description="Your uploaded resume becomes your base resume. JobPilot never modifies it." />
        <Card className="p-6">
          <ResumeUploader />
        </Card>
      </>
    );
  if (resume.error || !resume.data) return <ErrorState error={resume.error} onRetry={() => resume.refetch()} />;

  const { master_version: mv, file, profile, warnings } = resume.data;
  const layout = (file?.layout ?? {}) as Record<string, unknown>;
  const risks = layoutRisks(layout);

  const reparse = async () => {
    setReparsing(true);
    try {
      await api(S.Ok, "POST", "/resume/reparse");
      void qc.invalidateQueries({ queryKey: ["resume"] });
      toast({ tone: "success", title: "Resume re-parsed" });
    } catch (e) {
      toast({ tone: "error", title: "Couldn’t re-parse", body: errorText(e) });
    } finally {
      setReparsing(false);
    }
  };

  const demonstrated = profile?.skills.filter((s) => s.sections.some((x) => x !== "skills" && x !== "certifications")) ?? [];
  const listedOnly = profile?.skills.filter((s) => !demonstrated.includes(s)) ?? [];

  return (
    <>
      <PageHeader
        title="Base Resume"
        description="Your complete, verified resume and the single source of truth for everything JobPilot does. It is never modified by AI; tailoring always creates a separate version."
        action={
          <>
            <Button variant="secondary" onClick={() => setReplacing(true)}>
              <Upload className="h-4 w-4" /> Replace
            </Button>
            <ButtonLink href="/profile" variant="secondary">
              <Pencil className="h-4 w-4" /> Edit facts
            </ButtonLink>
            {mv && (
              <ButtonLink href="/ats">
                <Gauge className="h-4 w-4" /> ATS scan
              </ButtonLink>
            )}
          </>
        }
      />
      <Dialog open={replacing} onClose={() => setReplacing(false)} title="Upload a new resume" description="Creates a new base version. Earlier versions and tailored resumes are kept.">
        <ResumeUploader
          onDone={() => {
            setReplacing(false);
            toast({ tone: "success", title: "New base resume uploaded", body: "Jobs are being re-scored in the background." });
          }}
        />
      </Dialog>

      {warnings.length > 0 && (
        <Callout tone="warning" className="mb-5" title="Please check these parsed details">
          <ul className="list-disc pl-4">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Callout>
      )}

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-5">
          {profile ? (
            <Card>
              <CardHeader title={profile.contact.name ?? "Your profile"} description={[profile.contact.email, profile.contact.phone, profile.contact.location].filter(Boolean).join(" · ")} />
              <CardBody className="space-y-6">
                {profile.summary && <p className="text-sm leading-relaxed text-subtle">{profile.summary}</p>}
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Skills shown in your experience or projects ({demonstrated.length})</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {demonstrated.map((s) => (
                      <Chip key={s.name} tone="success" title={`Evidenced in: ${s.sections.join(", ")}`}>
                        ✓ {s.name}
                      </Chip>
                    ))}
                    {!demonstrated.length && <span className="text-sm text-muted">None found in bullets.</span>}
                  </div>
                </div>
                {listedOnly.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Listed only ({listedOnly.length})</div>
                    <div className="flex flex-wrap gap-1.5">
                      {listedOnly.map((s) => (
                        <Chip key={s.name}>{s.name}</Chip>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-muted">These count as weaker evidence. Mention them in a real bullet where you’ve used them.</p>
                  </div>
                )}
                <div>
                  <div className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Experience</div>
                  <ol className="space-y-4">
                    {profile.experience.map((e) => (
                      <li key={e.id} className="border-l-2 border-border pl-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="font-medium">
                            {e.title} {e.company && <span className="font-normal text-subtle">· {e.company}</span>}
                            {e.is_internship && <Badge className="ml-2">Internship</Badge>}
                          </div>
                          <span className="text-xs text-muted">
                            {e.start_date ?? "?"} – {e.current ? "Present" : (e.end_date ?? "?")}
                          </span>
                        </div>
                        <ul className="mt-1.5 list-disc space-y-1 pl-5 text-[13px] text-subtle">
                          {e.bullets.map((b, i) => (
                            <li key={i}>{b}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ol>
                </div>
                {profile.projects.length > 0 && (
                  <div>
                    <div className="mb-3 text-[11px] font-semibold tracking-wider text-muted uppercase">Projects</div>
                    <div className="space-y-3">
                      {profile.projects.map((p) => (
                        <div key={p.id}>
                          <div className="font-medium">{p.name}</div>
                          <ul className="mt-1 list-disc space-y-1 pl-5 text-[13px] text-subtle">
                            {p.bullets.map((b, i) => (
                              <li key={i}>{b}</li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {profile.education.length > 0 && (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">Education</div>
                    {profile.education.map((e) => (
                      <div key={e.id} className="text-sm">
                        {[e.degree, e.field && `in ${e.field}`].filter(Boolean).join(" ")} <span className="text-subtle">· {e.institution}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardBody>
            </Card>
          ) : (
            <EmptyState title="No parsed profile" />
          )}
          <Card>
            <CardHeader title="Extracted text" description="What JobPilot, and a typical ATS parser, reads from your file." />
            <CardBody>
              <pre className="scrollbar-thin max-h-96 overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-xs whitespace-pre-wrap text-subtle">{resume.data.raw_text_preview || "—"}</pre>
            </CardBody>
          </Card>
        </div>

        <aside className="space-y-5">
          {mv && (
            <Card className="p-5">
              <div className="flex items-center gap-4">
                <ScoreRing score={mv.quality_index} size={84} label="ATS" />
                <div>
                  <div className="font-medium">Base resume · v{mv.version_number}</div>
                  <div className="text-xs text-muted">{fmtDateTime(mv.created_at)}</div>
                </div>
              </div>
              <div className="mt-5 space-y-3">
                <Meter label="Parser compatibility" value={mv.parser_score} />
                <Meter label="Round-trip fidelity" value={mv.round_trip_score} />
                <Meter label="Formatting" value={mv.formatting_score} />
              </div>
              <div className="mt-5 flex flex-wrap gap-1.5">
                {mv.has_original && (
                  <Button size="sm" variant="secondary" onClick={() => download(`/resume/${mv.id}/download?format=original`, file?.filename ?? "resume")}>
                    <Download className="h-3.5 w-3.5" /> Original
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => download(`/resume/${mv.id}/download?format=docx`, "resume.docx")}>
                  <Download className="h-3.5 w-3.5" /> ATS-safe DOCX
                </Button>
                <Button size="sm" variant="secondary" onClick={() => download(`/resume/${mv.id}/download?format=pdf`, "resume.pdf")}>
                  <Download className="h-3.5 w-3.5" /> PDF
                </Button>
              </div>
            </Card>
          )}
          {file && (
            <Card>
              <CardHeader
                title="Uploaded file"
                icon={<FileText className="h-4 w-4" />}
                action={
                  <Button size="sm" variant="ghost" onClick={reparse} loading={reparsing}>
                    <RefreshCw className="h-3.5 w-3.5" /> Re-parse
                  </Button>
                }
              />
              <CardBody className="space-y-3 text-sm">
                <div>
                  <div className="truncate font-medium">{file.filename}</div>
                  <div className="text-xs text-muted">
                    {file.type.toUpperCase()} · {(file.size / 1024).toFixed(0)} KB · {fmtDateTime(file.uploaded_at)}
                  </div>
                </div>
                {risks.length > 0 ? (
                  <div>
                    <div className="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">ATS layout risks</div>
                    <dl className="space-y-1.5">
                      {risks.map(([label, present, why]) => (
                        <div key={label} className="flex items-center justify-between gap-2 text-[13px]" title={why}>
                          <dt className="text-subtle">{label}</dt>
                          <dd>
                            <Risk present={present} />
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {risks.some(([, p]) => p) && <p className="mt-2 text-xs text-muted">JobPilot’s generated DOCX/PDF avoid these risks; download the ATS-safe DOCX to use when applying.</p>}
                  </div>
                ) : (
                  <p className="text-[13px] text-subtle">Plain text: no layout risks.</p>
                )}
              </CardBody>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
