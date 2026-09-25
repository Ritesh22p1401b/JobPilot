"""Data-access helpers shared by agents and API routes."""

from __future__ import annotations

from sqlalchemy import delete, func, insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import new_id, utcnow
from app.models import (
    AuditLog,
    CandidatePreferences,
    CandidateProfile,
    CandidateSkill,
    JdRequirement,
    Job,
    JobSkill,
    Notification,
    RequirementMatch,
    ResumeVersion,
)
from app.schemas.jd import SKILL_CATEGORIES, JDAnalysis
from app.schemas.preferences import Preferences
from app.schemas.profile import CandidateProfileData
from app.services.evidence import EvidenceMatrix
from app.services.jd_parser import analyze_job_description
from app.services.matcher import JobFacts


async def get_candidate(db: AsyncSession, user_id: str) -> CandidateProfile | None:
    return (await db.execute(select(CandidateProfile).where(CandidateProfile.user_id == user_id))).scalars().first()


def profile_data(candidate: CandidateProfile) -> CandidateProfileData:
    return CandidateProfileData.model_validate(candidate.structured_profile_json or {})


async def get_prefs(db: AsyncSession, user_id: str) -> Preferences:
    row = (await db.execute(select(CandidatePreferences).where(CandidatePreferences.user_id == user_id))).scalars().first()
    return Preferences.model_validate(row.preferences_json) if row else Preferences()


async def save_prefs(db: AsyncSession, user_id: str, prefs: Preferences) -> None:
    row = (await db.execute(select(CandidatePreferences).where(CandidatePreferences.user_id == user_id))).scalars().first()
    data = prefs.model_dump(mode="json")
    if row is None:
        db.add(CandidatePreferences(user_id=user_id, preferences_json=data))
    else:
        row.preferences_json = data
    await db.commit()


async def master_version(db: AsyncSession, candidate_id: str) -> ResumeVersion | None:
    return (await db.execute(
        select(ResumeVersion).where(ResumeVersion.candidate_id == candidate_id, ResumeVersion.version_type == "MASTER")
        .order_by(ResumeVersion.version_number.desc()).limit(1)
    )).scalars().first()


async def next_version_number(db: AsyncSession, candidate_id: str) -> int:
    n = (await db.execute(select(func.max(ResumeVersion.version_number)).where(ResumeVersion.candidate_id == candidate_id))).scalar()
    return (n or 0) + 1


async def sync_candidate_skills(db: AsyncSession, candidate: CandidateProfile, profile: CandidateProfileData) -> None:
    from app.services.dates import merged_months

    await db.execute(delete(CandidateSkill).where(CandidateSkill.candidate_id == candidate.id))
    for s in profile.skills:
        months = merged_months([(e.start_date, e.end_date) for e in profile.experience if s.name in e.skills])
        db.add(CandidateSkill(candidate_id=candidate.id, skill=s.name, category=s.category,
                              years_experience=round(months / 12, 1) if months else None, source=",".join(s.sections)))


async def ensure_job_analysis(db: AsyncSession, job: Job, llm_enrich: bool = False) -> JDAnalysis:
    """JD analysis is cached per content hash (idempotent); requirements are persisted with source spans."""
    if job.analysis_hash == job.content_hash and job.jd_analysis_json:
        cached = JDAnalysis.model_validate(job.jd_analysis_json)
        if not llm_enrich or cached.analyzer_version.endswith("+llm"):
            return cached
    analysis = analyze_job_description(job.title, job.description)
    if llm_enrich:
        from app.agents.resume_agents.jd_analysis_agent import enrich_with_llm

        analysis = await enrich_with_llm(analysis, job.title, job.description)
    job.jd_analysis_json = analysis.model_dump(mode="json")
    job.analysis_hash = job.content_hash
    job.seniority = analysis.seniority if analysis.seniority != "unspecified" else job.seniority
    await db.execute(delete(JdRequirement).where(JdRequirement.job_id == job.id))
    await db.execute(delete(JobSkill).where(JobSkill.job_id == job.id))
    for r in analysis.requirements:
        db.add(JdRequirement(job_id=job.id, requirement=r.requirement[:512], category=r.category, importance=r.importance,
                             source_span=r.source_span, evidence_required=r.evidence_required, extracted_by=r.extracted_by,
                             details_json={"tier": r.tier, "skill": r.skill, "min_years": r.min_years,
                                           "degree_level": r.degree_level}))
        if r.category in SKILL_CATEGORIES and r.skill:
            from app.services.skill_normalizer import skill_category

            db.add(JobSkill(job_id=job.id, skill=r.skill, category=skill_category(r.skill),
                            required=r.category == "REQUIRED_SKILL"))
    await db.flush()
    return analysis


async def persist_requirement_matches(db: AsyncSession, job_id: str, candidate_id: str, matrix: EvidenceMatrix) -> None:
    await persist_requirement_matches_bulk(db, candidate_id, {job_id: matrix})


_CHUNK = 500  # keeps IN (...) lists well under driver parameter limits


async def persist_requirement_matches_bulk(db: AsyncSession, candidate_id: str, matrices: dict[str, EvidenceMatrix]) -> None:
    """Replace the candidate's requirement matches for many jobs: one load, one delete and one insert per chunk."""
    job_ids = list(matrices)
    by_key: dict[tuple[str, str, str], str] = {}
    for i in range(0, len(job_ids), _CHUNK):
        rows = await db.execute(select(JdRequirement.id, JdRequirement.job_id, JdRequirement.category, JdRequirement.requirement)
                                .where(JdRequirement.job_id.in_(job_ids[i: i + _CHUNK])))
        by_key.update({(job_id, category, requirement): rid for rid, job_id, category, requirement in rows})
    req_ids = list(by_key.values())
    for i in range(0, len(req_ids), _CHUNK):
        await db.execute(delete(RequirementMatch).where(RequirementMatch.candidate_id == candidate_id,
                                                        RequirementMatch.requirement_id.in_(req_ids[i: i + _CHUNK])))
    values = []
    for job_id, matrix in matrices.items():
        for it in matrix.items:
            rid = by_key.get((job_id, it.category, it.requirement[:512]))
            if rid is not None:
                values.append({"id": new_id(), "requirement_id": rid, "candidate_id": candidate_id, "status": it.status,
                               "match_type": it.match_type, "confidence": it.confidence,
                               "evidence_json": [e.model_dump() for e in it.evidence], "created_at": utcnow()})
    for i in range(0, len(values), _CHUNK):
        await db.execute(insert(RequirementMatch), values[i: i + _CHUNK])


def job_facts(job: Job) -> JobFacts:
    return JobFacts(title=job.title, company=job.company, location=job.location, remote=job.remote, work_mode=job.work_mode,
                    employment_type=job.employment_type, salary_min=job.salary_min, salary_max=job.salary_max,
                    currency=job.currency, seniority=job.seniority, description=job.description)


async def audit(db: AsyncSession, user_id: str | None, action: str, target: str | None = None, details: dict | None = None) -> None:
    db.add(AuditLog(user_id=user_id, action=action, target=target, details_json=details or {}))


async def notify(db: AsyncSession, user_id: str, kind: str, title: str, body: str, data: dict | None = None) -> Notification:
    n = Notification(user_id=user_id, kind=kind, title=title, body=body, data_json=data or {})
    db.add(n)
    return n
