"""Resume upload, versions, downloads and Resume Lab (analysis / tests / tailoring / comparison)."""

from __future__ import annotations

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, run_agent
from app.agents.resume_agent import ResumeAgent
from app.agents.resume_agents.resume_evaluator_agent import ResumeEvaluatorAgent
from app.agents.resume_agents.resume_test_agent import latest_tests
from app.api.deps import current_candidate, current_user, upload_limiter
from app.api.serializers import iso, task_out, version_out
from app.config import get_settings
from app.database import get_db, utcnow
from app.events.bus import publish
from app.models import CandidateProfile, Job, ResumeClaim, ResumeFile, ResumeVersion, User
from app.schemas.resume import ResumeContent
from app.services import storage
from app.services.ats.profiles import PROFILES
from app.services.repository import audit, master_version, profile_data
from app.services.resume_diff import diff_contents, regression_summary
from app.services.resume_document import TEMPLATES, render_docx, render_pdf, render_txt
from app.services.text_extraction import ExtractionError

router = APIRouter(prefix="/resume", tags=["resume"])
MIME = {"pdf": "application/pdf", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain; charset=utf-8", "json": "application/json"}


async def _owned_version(db: AsyncSession, candidate: CandidateProfile, version_id: str) -> ResumeVersion:
    v = await db.get(ResumeVersion, version_id)
    if v is None or v.candidate_id != candidate.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resume version not found")
    return v


@router.post("/upload", status_code=201, dependencies=[Depends(upload_limiter)])
async def upload_resume(file: UploadFile = File(...), user: User = Depends(current_user),
                        db: AsyncSession = Depends(get_db)) -> dict:
    settings = get_settings()
    data = await file.read(settings.max_upload_bytes + 1)
    if len(data) > settings.max_upload_bytes:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"File exceeds {settings.max_upload_bytes // (1024 * 1024)} MB limit")
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty file")
    agent = ResumeAgent(file.filename or "resume", data)
    ctx = AgentContext(user_id=user.id)
    try:
        out = await run_agent(agent, db, {"user_id": user.id, "filename": file.filename, "size": len(data)}, ctx)
    except ExtractionError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from exc
    await audit(db, user.id, "resume.uploaded", out.resume_version_id, {"size": len(data)})  # type: ignore[attr-defined]
    await db.commit()
    return out.model_dump()


@router.get("")
async def get_resume(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    mv = await master_version(db, candidate.id)
    rfile = await db.get(ResumeFile, mv.resume_file_id) if mv and mv.resume_file_id else None
    return {
        "candidate_id": candidate.id,
        "master_version": version_out(mv) if mv else None,
        "file": {"id": rfile.id, "filename": rfile.original_filename, "type": rfile.content_type, "size": rfile.size_bytes,
                 "uploaded_at": iso(rfile.created_at), "layout": rfile.layout_json} if rfile else None,
        "profile": candidate.structured_profile_json,
        "warnings": candidate.parse_warnings_json or [],
        "raw_text_preview": (candidate.raw_resume_text or "")[:6000],
    }


@router.post("/reparse")
async def reparse(user: User = Depends(current_user), candidate: CandidateProfile = Depends(current_candidate),
                  db: AsyncSession = Depends(get_db)) -> dict:
    rfile = (await db.execute(select(ResumeFile).where(ResumeFile.candidate_id == candidate.id, ResumeFile.is_current)
                              .order_by(ResumeFile.created_at.desc()))).scalars().first()
    if rfile is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No uploaded resume")
    data = storage.read_bytes(rfile.file_path)
    agent = ResumeAgent(rfile.original_filename, data)
    out = await run_agent(agent, db, {"user_id": user.id, "filename": rfile.original_filename, "reparse": True},
                          AgentContext(user_id=user.id))
    return out.model_dump()


@router.get("/templates")
async def templates() -> dict:
    return {"templates": [{"id": t.id, "name": t.name, "description": t.description, "section_order": list(t.section_order)}
                          for t in TEMPLATES.values()],
            "ats_profiles": [{"id": p.name, "description": p.description} for p in PROFILES.values()] +
            [{"id": "custom", "description": "User-defined weights (pass custom weights in the request)."}]}


@router.get("/versions")
async def versions(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db),
                   job_id: str | None = None) -> dict:
    q = select(ResumeVersion).where(ResumeVersion.candidate_id == candidate.id)
    if job_id:
        q = q.where(ResumeVersion.job_id == job_id)
    rows = (await db.execute(q.order_by(ResumeVersion.version_number.desc()))).scalars().all()
    jobs = {j.id: j for j in (await db.execute(select(Job).where(Job.id.in_([v.job_id for v in rows if v.job_id])))).scalars()}
    return {"versions": [{**version_out(v), "job_title": jobs[v.job_id].title if v.job_id in jobs else None,
                          "company": jobs[v.job_id].company if v.job_id in jobs else None} for v in rows]}


@router.get("/{version_id}")
async def get_version(version_id: str, candidate: CandidateProfile = Depends(current_candidate),
                      db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    claims = (await db.execute(select(ResumeClaim).where(ResumeClaim.resume_version_id == v.id))).scalars().all()
    return {**version_out(v), "content": v.content_json, "changes": v.changes_json,
            "claims": [{"claim": c.claim_text, "section": c.section, "source_type": c.source_type, "source_id": c.source_id,
                        "original": c.original_text, "verified": c.verified, "confidence": c.confidence,
                        "reasons": c.reasons_json} for c in claims],
            "text_preview": render_txt(ResumeContent.model_validate(v.content_json)) if v.content_json else ""}


@router.get("/{version_id}/versions")
async def version_lineage(version_id: str, candidate: CandidateProfile = Depends(current_candidate),
                          db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    chain = [version_out(v)]
    seen = {v.id}
    while v.parent_version_id and v.parent_version_id not in seen:
        v = await db.get(ResumeVersion, v.parent_version_id)  # type: ignore[assignment]
        if v is None:
            break
        seen.add(v.id)
        chain.append(version_out(v))
    children = (await db.execute(select(ResumeVersion).where(ResumeVersion.parent_version_id == version_id))).scalars().all()
    return {"lineage": chain, "children": [version_out(c) for c in children]}


@router.get("/{version_id}/download")
async def download(version_id: str, format: str = Query("docx", pattern="^(docx|pdf|txt|json|original)$"),
                   candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> Response:
    v = await _owned_version(db, candidate, version_id)
    name = (profile_data(candidate).contact.name or "Resume").replace(" ", "_")
    if format == "original":
        rfile = await db.get(ResumeFile, v.resume_file_id) if v.resume_file_id else None
        if rfile is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "No original file for this version")
        return Response(storage.read_bytes(rfile.file_path), media_type=MIME[rfile.content_type],
                        headers={"Content-Disposition": f'attachment; filename="{rfile.original_filename}"'})
    content = ResumeContent.model_validate(v.content_json)
    if format == "docx":
        data = storage.read_bytes(v.file_path) if v.file_path else render_docx(content)
    elif format == "pdf":
        data = storage.read_bytes(v.pdf_path) if v.pdf_path else render_pdf(content)
    elif format == "txt":
        data = render_txt(content).encode()
    else:
        data = content.model_dump_json(indent=2).encode()
    return Response(data, media_type=MIME[format],
                    headers={"Content-Disposition": f'attachment; filename="{name}_v{v.version_number}.{format}"'})


class AnalyzeRequest(BaseModel):
    resume_version_id: str | None = None  # default: current master
    job_id: str | None = None
    ats_profile: str = "generic"


async def _analyze(body: AnalyzeRequest, candidate: CandidateProfile, db: AsyncSession) -> dict:
    version = (await _owned_version(db, candidate, body.resume_version_id) if body.resume_version_id
               else await master_version(db, candidate.id))
    if version is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No resume version")
    if body.job_id and await db.get(Job, body.job_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    out = await run_agent(ResumeEvaluatorAgent(), db, {"resume_version_id": version.id, "job_id": body.job_id,
                                                       "ats_profile": body.ats_profile},
                          AgentContext(user_id=candidate.user_id), candidate_id=candidate.id, job_id=body.job_id)
    return out.model_dump(mode="json")["report"]  # type: ignore[attr-defined]


@router.post("/analyze")
async def analyze(body: AnalyzeRequest, candidate: CandidateProfile = Depends(current_candidate),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """Job-Specific ATS Compatibility Assessment (full resume test suite)."""
    return await _analyze(body, candidate, db)


@router.post("/test")
async def test_resume(body: AnalyzeRequest, candidate: CandidateProfile = Depends(current_candidate),
                      db: AsyncSession = Depends(get_db)) -> dict:
    return await _analyze(body, candidate, db)


class TailorRequest(BaseModel):
    job_id: str
    template: str | None = None  # None = auto-select by role
    label: str | None = None
    use_llm: bool = True


@router.post("/tailor", status_code=202)
async def tailor_resume(body: TailorRequest, candidate: CandidateProfile = Depends(current_candidate),
                        db: AsyncSession = Depends(get_db)) -> dict:
    if await db.get(Job, body.job_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if body.template and body.template not in TEMPLATES:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown template")
    task = await publish(db, "resume.tailor_requested",
                         {"candidate_id": candidate.id, "job_id": body.job_id, "template": body.template,
                          "label": body.label, "use_llm": body.use_llm}, user_id=candidate.user_id)
    return {"task": task_out(task)}


class CompareRequest(BaseModel):
    version_ids: list[str] = Field(min_length=2, max_length=4)
    job_id: str | None = None


@router.post("/compare")
async def compare(body: CompareRequest, candidate: CandidateProfile = Depends(current_candidate),
                  db: AsyncSession = Depends(get_db)) -> dict:
    """A/B comparison of resume variants. Reports measurable differences only — never predicts interviews."""
    versions = [await _owned_version(db, candidate, vid) for vid in body.version_ids]
    rows = []
    for v in versions:
        report = await _analyze(AnalyzeRequest(resume_version_id=v.id, job_id=body.job_id), candidate, db)
        content = ResumeContent.model_validate(v.content_json)
        req: dict = next((t for t in report["tests"] if t["name"] == "requirement_coverage"), {})
        ach: dict = next((t for t in report["tests"] if t["name"] == "achievement_quality"), {})
        rows.append({
            "version": version_out(v),
            "quality_index": report["quality_index"],
            "keyword_alignment": report["keyword_alignment"],
            "requirement_coverage": report["requirement_coverage"],
            "required_coverage": (req.get("details") or {}).get("required_coverage"),
            "semantic_relevance": report["experience_relevance"],
            "parser_fidelity": report["round_trip_fidelity"],
            "achievement_strength": ach.get("score"),
            "words": len(render_txt(content).split()),
            "unsupported_claims": report["unsupported_claims"],
        })
    base = ResumeContent.model_validate(versions[0].content_json)
    diffs = [diff_contents(base, ResumeContent.model_validate(v.content_json)).model_dump() for v in versions[1:]]
    summary = []
    if body.job_id and rows:
        for r in rows:
            if r["required_coverage"] is not None:
                summary.append(f"{r['version']['label'] or 'v' + str(r['version']['version_number'])} covers "
                               f"{r['required_coverage']:.0f}% of explicitly identified required requirements.")
    return {"rows": rows, "diffs_vs_first": diffs, "summary": summary,
            "note": "These are measurable document differences. They do not predict which version will get more interviews."}


@router.get("/{version_id}/score")
async def score(version_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    return {**version_out(v), "report": v.last_report_json or None}


@router.get("/{version_id}/test-results")
async def test_results(version_id: str, candidate: CandidateProfile = Depends(current_candidate),
                       db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    tests = await latest_tests(db, v.id)
    return {"resume_version_id": v.id, "tests": [{"name": t.test_name, "status": t.status, "score": t.score,
                                                  "severity": t.severity, "critical": t.critical, "details": t.details_json,
                                                  "job_id": t.job_id, "created_at": iso(t.created_at)} for t in tests]}


@router.get("/{version_id}/diff")
async def diff(version_id: str, against: str | None = None, candidate: CandidateProfile = Depends(current_candidate),
               db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    other = await _owned_version(db, candidate, against) if against else (
        await db.get(ResumeVersion, v.parent_version_id) if v.parent_version_id else None)
    if other is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No version to compare against")
    claims = (await db.execute(select(ResumeClaim).where(ResumeClaim.resume_version_id == v.id))).scalars().all()
    verified = {c.claim_text: c.verified for c in claims}
    before, after = ResumeContent.model_validate(other.content_json), ResumeContent.model_validate(v.content_json)
    d = diff_contents(before, after, verified)
    scores = lambda x: {k: getattr(x, k) for k in ("quality_index", "parser_score", "round_trip_score", "keyword_score",  # noqa: E731
                                                     "requirement_score", "evidence_score", "formatting_score")}
    return {"from": version_out(other), "to": version_out(v), "diff": d.model_dump(),
            "regression": regression_summary(before, after, scores(other), scores(v))}


class ReviewRequest(BaseModel):
    notes: str | None = None


@router.post("/{version_id}/approve")
async def approve(version_id: str, body: ReviewRequest, candidate: CandidateProfile = Depends(current_candidate),
                  db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    if v.version_type == "MASTER":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Master versions do not need approval")
    unverified = (await db.execute(select(ResumeClaim).where(ResumeClaim.resume_version_id == v.id,
                                                             ResumeClaim.verified.is_(False)))).scalars().all()
    if unverified:
        raise HTTPException(status.HTTP_409_CONFLICT, f"{len(unverified)} unverified claim(s) must be removed before approval")
    v.status, v.approved_at, v.notes = "APPROVED", utcnow(), body.notes
    await audit(db, candidate.user_id, "resume.approved", v.id)
    await db.commit()
    return version_out(v)


@router.post("/{version_id}/reject")
async def reject(version_id: str, body: ReviewRequest, candidate: CandidateProfile = Depends(current_candidate),
                 db: AsyncSession = Depends(get_db)) -> dict:
    v = await _owned_version(db, candidate, version_id)
    if v.version_type == "MASTER":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Master versions cannot be rejected; upload a new resume instead")
    v.status, v.notes = "REJECTED", body.notes
    await audit(db, candidate.user_id, "resume.rejected", v.id)
    await db.commit()
    return version_out(v)
