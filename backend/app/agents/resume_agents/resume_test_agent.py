"""Resume Test Agent: runs the full resume test suite (document-level) and persists results.

MASTER versions are tested on the original uploaded file against the verified profile.
TAILORED versions are tested on the generated DOCX *and* PDF (round-trip), with claim verification.
"""

from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.database import new_id
from app.models import Job, ResumeFile, ResumeTest, ResumeVersion
from app.schemas.preferences import Preferences
from app.schemas.profile import (
    CandidateProfileData,
    EducationEntry,
    ExperienceEntry,
    ProjectEntry,
    SkillEntry,
)
from app.schemas.resume import ResumeContent
from app.services import storage
from app.services.ats.models import AssessmentReport
from app.services.ats.parser_test import round_trip
from app.services.ats.report_builder import assess_document
from app.services.claim_verifier import verify_document
from app.services.repository import ensure_job_analysis, get_prefs, notify, profile_data
from app.services.resume_parser import parse_resume
from app.services.skill_normalizer import skill_category
from app.services.text_extraction import ExtractionError, extract


def profile_from_content(content: ResumeContent, master: CandidateProfileData) -> CandidateProfileData:
    """The profile a correct parser should recover from a generated resume (round-trip reference)."""
    skills = [SkillEntry(name=s, category=skill_category(s)) for items in content.skills.values() for s in items]
    return CandidateProfileData(
        contact=content.contact,
        summary=content.summary,
        skills=skills,
        experience=[ExperienceEntry(id=b.source_id, company=b.company, title=b.title, location=b.location,
                                    start_date=b.start_date, end_date=b.end_date, current=b.current,
                                    is_internship=b.is_internship, bullets=[x.text for x in b.bullets])
                    for b in content.experience],
        education=[EducationEntry(**e.model_dump()) for e in content.education],
        projects=[ProjectEntry(id=p.source_id, name=p.name, description=p.description, bullets=[x.text for x in p.bullets])
                  for p in content.projects],
        certifications=content.certifications,
        total_experience_months=master.total_experience_months,
        internship_months=master.internship_months,
    )


async def run_version_tests(db: AsyncSession, version: ResumeVersion, master: CandidateProfileData, job: Job | None,
                            prefs: Preferences | None, ats_profile: str = "generic", persist: bool = True) -> AssessmentReport:
    analysis = await ensure_job_analysis(db, job) if job else None
    jd_text = job.description if job else ""
    claim_checks = None
    pdf_bytes: bytes | None = None
    if version.version_type == "MASTER":
        rfile = await db.get(ResumeFile, version.resume_file_id) if version.resume_file_id else None
        if rfile is None:
            raise ValueError("Master version has no uploaded file")
        filename = f"resume.{rfile.content_type}"
        data = storage.read_bytes(rfile.file_path)
        reference = master
    else:
        content = ResumeContent.model_validate(version.content_json)
        if not version.file_path:
            raise ValueError("Generated version has no document")
        filename, data = "resume.docx", storage.read_bytes(version.file_path)
        pdf_bytes = storage.read_bytes(version.pdf_path) if version.pdf_path else None
        reference = profile_from_content(content, master)
        claim_checks = verify_document(content, master)

    report = assess_document(filename, data, master=master, reference=reference, analysis=analysis, jd_text=jd_text,
                             prefs=prefs, ats_profile=ats_profile, claim_checks=claim_checks)
    if pdf_bytes is not None:
        try:
            pdf_doc = extract("resume.pdf", pdf_bytes)
            rt_pdf = round_trip(reference, parse_resume(pdf_doc.text).profile)
            rt_pdf.name = "round_trip_parsing_pdf"
            report.tests.append(rt_pdf)
            if rt_pdf.score is not None and (report.round_trip_fidelity is None or rt_pdf.score < report.round_trip_fidelity):
                report.round_trip_fidelity = rt_pdf.score
            if rt_pdf.critical and rt_pdf.status == "FAIL":
                report.critical_failures.append(rt_pdf.name)
                report.assessment = "NEEDS_REVIEW"
        except ExtractionError as exc:
            report.critical_failures.append(f"pdf_extraction: {exc}")
            report.assessment = "NEEDS_REVIEW"
    report.resume_version_id = version.id
    report.job_id = job.id if job else None

    if persist:
        run_id = new_id()
        for t in report.tests:
            db.add(ResumeTest(resume_version_id=version.id, job_id=report.job_id, run_id=run_id, test_name=t.name,
                              status=t.status, score=t.score, severity=t.severity, critical=t.critical,
                              details_json={**t.details, "issues": [i.model_dump() for i in t.issues]}))
        version.quality_index = report.quality_index
        version.parser_score = report.parser_compatibility
        version.keyword_score = report.keyword_alignment
        version.requirement_score = report.requirement_coverage
        version.evidence_score = report.experience_evidence
        version.round_trip_score = report.round_trip_fidelity
        version.formatting_score = report.formatting_compatibility
        version.last_report_json = {**report.model_dump(mode="json"), "run_id": run_id}
        if version.version_type != "MASTER":
            if report.critical_failures or report.unsupported_claims:
                version.status = "NEEDS_REVIEW"
            elif version.status in ("DRAFT", "NEEDS_REVIEW"):
                version.status = "DRAFT"
    return report


class ResumeTestOutput(BaseModel):
    resume_version_id: str
    assessment: str
    quality_index: float
    critical_failures: list[str]
    status: str


class ResumeTestAgent(BaseAgent):
    name = "resume_test_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> ResumeTestOutput:
        version = await db.get(ResumeVersion, payload["resume_version_id"])
        if version is None:
            raise ValueError("Resume version not found")
        from app.models import CandidateProfile

        candidate = await db.get(CandidateProfile, version.candidate_id)
        assert candidate is not None
        master = profile_data(candidate)
        job = await db.get(Job, payload["job_id"]) if payload.get("job_id") else (
            await db.get(Job, version.job_id) if version.job_id else None)
        prefs = await get_prefs(db, candidate.user_id)
        report = await run_version_tests(db, version, master, job, prefs, payload.get("ats_profile", "generic"))
        if version.version_type == "TAILORED":
            await notify(db, candidate.user_id, "resume_ready", "Tailored resume ready for review",
                         f"'{version.label}' scored {report.quality_index:.0f}/100 on the compatibility assessment"
                         + (" and needs review." if version.status == "NEEDS_REVIEW" else ". Review the changes before using it."),
                         {"resume_version_id": version.id, "job_id": version.job_id})
        await db.commit()
        if payload.get("emit_profile_updated"):
            ctx.emit("profile.updated", {"candidate_id": candidate.id}, dedup_key=f"profile.updated:{candidate.id}")
        return ResumeTestOutput(resume_version_id=version.id, assessment=report.assessment,
                                quality_index=report.quality_index, critical_failures=report.critical_failures,
                                status=version.status)


async def latest_tests(db: AsyncSession, version_id: str) -> list[ResumeTest]:
    run = (await db.execute(select(ResumeTest.run_id).where(ResumeTest.resume_version_id == version_id)
                            .order_by(ResumeTest.created_at.desc()).limit(1))).scalar()
    if not run:
        return []
    return list((await db.execute(select(ResumeTest).where(ResumeTest.run_id == run))).scalars())
