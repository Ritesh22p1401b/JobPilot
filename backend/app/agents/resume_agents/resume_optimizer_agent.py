"""Resume Optimizer Agent: creates a truthful, job-specific TAILORED version (never modifies the master)."""

from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.agents.resume_agent import content_hash
from app.models import CandidateProfile, Job, ResumeClaim, ResumeVersion
from app.schemas.resume import ResumeContent
from app.services import storage
from app.services.claim_verifier import verify_document
from app.services.evidence import build_evidence_matrix
from app.services.llm import get_llm
from app.services.repository import ensure_job_analysis, get_prefs, master_version, next_version_number, profile_data
from app.services.resume_diff import diff_contents
from app.services.resume_document import content_from_profile, render_docx, render_pdf
from app.services.tailoring import tailor


class TailorOutput(BaseModel):
    resume_version_id: str
    job_id: str
    template: str
    rewrites_accepted: int
    rewrites_rejected: int
    llm_used: bool
    changes: dict = Field(default_factory=dict)


async def create_tailored_version(db: AsyncSession, candidate: CandidateProfile, job: Job, template: str | None,
                                  label: str | None, ctx: AgentContext | None = None, use_llm: bool = True) -> ResumeVersion:
    master = profile_data(candidate)
    mv = await master_version(db, candidate.id)
    if mv is None:
        raise ValueError("Upload a resume first")
    master_content = ResumeContent.model_validate(mv.content_json) if mv.content_json else content_from_profile(master)
    llm = get_llm()
    llm_on = use_llm and await llm.is_enabled()
    analysis = await ensure_job_analysis(db, job, llm_enrich=llm_on)
    prefs = await get_prefs(db, candidate.user_id)
    matrix = build_evidence_matrix(analysis, master, prefs)
    result = await tailor(master, master_content, analysis, matrix, template=template, llm=llm, use_llm=llm_on)
    content = result.content

    # Safety net: anything that still fails verification reverts to the verified original.
    checks = verify_document(content, master)
    failed = {c.claim for c in checks if not c.verified}
    if failed:
        for b in content.all_bullets():
            if b.text in failed and b.original_text:
                b.text = b.original_text
        if content.summary in failed:
            content.summary = master_content.summary
            content.summary_source = master_content.summary_source
        checks = verify_document(content, master)

    data = content.model_dump(mode="json")
    docx_bytes = render_docx(content)
    pdf_bytes = render_pdf(content)
    diff = diff_contents(master_content, content)
    version = ResumeVersion(
        candidate_id=candidate.id, job_id=job.id, parent_version_id=mv.id,
        version_number=await next_version_number(db, candidate.id), version_type="TAILORED",
        label=label or f"{job.title} – {job.company}"[:255], template=content.template, status="DRAFT",
        content_json=data, content_hash=content_hash(data),
        file_path=storage.save_bytes(candidate.user_id, "generated", docx_bytes, "docx"),
        pdf_path=storage.save_bytes(candidate.user_id, "generated", pdf_bytes, "pdf"),
        changes_json={"diff": diff.model_dump(mode="json"),
                      "tailoring": result.model_dump(mode="json", exclude={"content"}),
                      "master_version_id": mv.id},
    )
    db.add(version)
    await db.flush()
    for c in checks:
        db.add(ResumeClaim(resume_version_id=version.id, claim_text=c.claim, section=c.section, source_type=c.source_type,
                           source_id=c.source_id, original_text=c.original, verified=c.verified, confidence=c.confidence,
                           reasons_json=c.reasons))
    if ctx is not None:
        ctx.llm_meta.extend({"prompt_version": p, "model": None} for p in result.prompt_versions)
    return version


class ResumeOptimizerAgent(BaseAgent):
    name = "resume_optimizer_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> TailorOutput:
        candidate = await db.get(CandidateProfile, payload["candidate_id"])
        job = await db.get(Job, payload["job_id"])
        if candidate is None or job is None:
            raise ValueError("Candidate or job not found")
        version = await create_tailored_version(db, candidate, job, payload.get("template"), payload.get("label"), ctx,
                                                use_llm=payload.get("use_llm", True))
        await db.commit()
        ctx.emit("resume.version_created", {"resume_version_id": version.id, "job_id": job.id})
        tail = version.changes_json.get("tailoring", {})
        return TailorOutput(resume_version_id=version.id, job_id=job.id, template=version.template,
                            rewrites_accepted=tail.get("rewrites_accepted", 0),
                            rewrites_rejected=len(tail.get("rejected_rewrites", [])), llm_used=tail.get("llm_used", False),
                            changes=version.changes_json.get("diff", {}).get("counts", {}))
