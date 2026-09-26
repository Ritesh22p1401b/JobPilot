from __future__ import annotations

import hashlib
from datetime import timedelta
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field, HttpUrl
from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, run_agent
from app.agents.normalization_agent import NormalizationAgent
from app.api.deps import agent_limiter, current_candidate
from app.api.serializers import job_out, match_out, task_out
from app.database import get_db, utcnow
from app.events.bus import publish
from app.models import CandidateProfile, Job, JobMatch, JobSkill
from app.providers.registry import destination_links
from app.schemas.job import RawJob
from app.services.evidence import build_evidence_matrix
from app.services.repository import ensure_job_analysis, get_prefs, profile_data

router = APIRouter(tags=["jobs"])


@router.get("/jobs")
async def list_jobs(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db),
                    q: str | None = None, source: str | None = None, min_score: float | None = None,
                    saved: bool | None = None, include_filtered: bool = False, include_dismissed: bool = False,
                    remote: bool | None = None, sort: str = Query("score", pattern="^(score|recent|salary)$"),
                    location: str | None = None, company: str | None = None, skill: str | None = None,
                    employment_type: str | None = None, seniority: str | None = None,
                    posted_within_days: int | None = Query(None, ge=1, le=365), min_salary: float | None = None,
                    page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100)) -> dict:
    stmt = (select(Job, JobMatch).outerjoin(JobMatch, and_(JobMatch.job_id == Job.id, JobMatch.candidate_id == candidate.id))
            .where(Job.duplicate_of_id.is_(None)))
    if q:
        like = f"%{q.lower()}%"
        stmt = stmt.where(or_(func.lower(Job.title).like(like), func.lower(Job.company).like(like),
                              func.lower(Job.location).like(like)))
    if source:
        stmt = stmt.where(Job.source == source)
    if remote is not None:
        stmt = stmt.where(Job.remote.is_(remote))
    if location:
        stmt = stmt.where(func.lower(Job.location).like(f"%{location.lower()}%"))
    if company:
        stmt = stmt.where(func.lower(Job.company) == company.lower())
    if employment_type:
        stmt = stmt.where(Job.employment_type == employment_type)
    if seniority:
        stmt = stmt.where(Job.seniority == seniority)
    if skill:
        stmt = stmt.where(Job.id.in_(select(JobSkill.job_id).where(func.lower(JobSkill.skill) == skill.lower())))
    if posted_within_days:
        since = utcnow() - timedelta(days=posted_within_days)
        stmt = stmt.where(func.coalesce(Job.posted_at, Job.first_seen_at) >= since)
    if min_salary is not None:
        stmt = stmt.where(func.coalesce(Job.salary_max, Job.salary_min) >= min_salary)
    if min_score is not None:
        stmt = stmt.where(JobMatch.overall_score >= min_score)
    if saved:
        stmt = stmt.where(JobMatch.saved.is_(True))
    if not include_filtered:
        stmt = stmt.where(or_(JobMatch.id.is_(None), JobMatch.hard_filter_passed.is_(True)))
    if not include_dismissed:
        stmt = stmt.where(or_(JobMatch.id.is_(None), JobMatch.dismissed.is_(False)))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar() or 0
    orders: dict[str, list[Any]] = {
        "score": [JobMatch.overall_score.desc().nullslast(), Job.first_seen_at.desc()],
        "recent": [func.coalesce(Job.posted_at, Job.first_seen_at).desc()],
        "salary": [func.coalesce(Job.salary_max, Job.salary_min).desc().nullslast(), JobMatch.overall_score.desc().nullslast()],
    }
    order = orders[sort]
    rows = (await db.execute(stmt.order_by(*order).offset((page - 1) * page_size).limit(page_size))).all()
    return {"total": total, "page": page, "page_size": page_size, "jobs": [job_out(j, m) for j, m in rows]}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    match = (await db.execute(select(JobMatch).where(JobMatch.job_id == job.id, JobMatch.candidate_id == candidate.id))).scalars().first()
    analysis = await ensure_job_analysis(db, job)
    await db.commit()
    matrix = build_evidence_matrix(analysis, profile_data(candidate), await get_prefs(db, candidate.user_id))
    return {**job_out(job, match, include_description=True), "analysis": analysis.model_dump(mode="json"),
            "requirement_matrix": [i.model_dump() for i in matrix.items],
            "destination_links": destination_links(job.title, job.location)}


class SearchRequest(BaseModel):
    queries: list[str] = Field(default_factory=list, max_length=6)
    locations: list[str] = Field(default_factory=list, max_length=4)


@router.post("/jobs/search", status_code=202, dependencies=[Depends(agent_limiter)])
async def search_jobs(body: SearchRequest, candidate: CandidateProfile = Depends(current_candidate),
                      db: AsyncSession = Depends(get_db)) -> dict:
    task = await publish(db, "discovery.requested", {"candidate_id": candidate.id, "queries": body.queries or None,
                                                     "locations": body.locations or None},
                         user_id=candidate.user_id, dedup_key=f"discovery:{candidate.id}")
    links = destination_links(body.queries[0] if body.queries else "jobs", body.locations[0] if body.locations else None)
    return {"task": task_out(task), "destination_links": links,
            "note": "LinkedIn/Indeed are not scraped; use the destination links to search there yourself."}


class ManualJob(BaseModel):
    """A job the user found themselves (e.g. on LinkedIn) and pastes in. User-driven, no scraping."""

    title: str = Field(min_length=2, max_length=300)
    company: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=30, max_length=50000)
    url: HttpUrl
    location: str | None = None


@router.post("/jobs/import", status_code=201)
async def import_job(body: ManualJob, candidate: CandidateProfile = Depends(current_candidate),
                     db: AsyncSession = Depends(get_db)) -> dict:
    ext = hashlib.sha256(f"{candidate.id}:{body.url}".encode()).hexdigest()[:24]
    raw = RawJob(source="manual", external_id=ext, company=body.company, title=body.title, location=body.location,
                 description=body.description, url=str(body.url), application_url=str(body.url), posted_at=utcnow(),
                 raw={"imported_by": candidate.user_id})
    out = await run_agent(NormalizationAgent(), db, {"raw_jobs": [raw.model_dump(mode="json")], "candidate_id": candidate.id},
                          AgentContext(user_id=candidate.user_id), candidate_id=candidate.id)
    job_id = out.job_ids[0] if out.job_ids else None  # type: ignore[attr-defined]
    if job_id is None:
        existing = (await db.execute(select(Job).where(Job.source == "manual", Job.external_id == ext))).scalars().first()
        job_id = existing.duplicate_of_id or existing.id if existing else None
    return {"job_id": job_id, "normalization": out.model_dump()}


async def _match(db: AsyncSession, candidate: CandidateProfile, job_id: str) -> JobMatch:
    m = (await db.execute(select(JobMatch).where(JobMatch.job_id == job_id, JobMatch.candidate_id == candidate.id))).scalars().first()
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No match computed for this job yet")
    return m


@router.post("/jobs/{job_id}/save")
async def save_job(job_id: str, saved: bool = True, candidate: CandidateProfile = Depends(current_candidate),
                   db: AsyncSession = Depends(get_db)) -> dict:
    m = await _match(db, candidate, job_id)
    m.saved = saved
    if saved:
        from app.agents.application_agent import get_or_create_application

        job = await db.get(Job, job_id)
        assert job is not None
        await get_or_create_application(db, candidate.id, job, "user")
    await db.commit()
    return match_out(m)


@router.post("/jobs/{job_id}/dismiss")
async def dismiss_job(job_id: str, dismissed: bool = True, candidate: CandidateProfile = Depends(current_candidate),
                      db: AsyncSession = Depends(get_db)) -> dict:
    m = await _match(db, candidate, job_id)
    m.dismissed = dismissed
    await db.commit()
    return match_out(m)


@router.get("/matches")
async def list_matches(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db),
                       min_score: float = 0, limit: int = Query(50, le=200)) -> dict:
    rows = (await db.execute(select(JobMatch, Job).join(Job, Job.id == JobMatch.job_id)
                             .where(JobMatch.candidate_id == candidate.id, JobMatch.overall_score >= min_score,
                                    JobMatch.hard_filter_passed.is_(True))
                             .order_by(JobMatch.overall_score.desc()).limit(limit))).all()
    return {"matches": [{**match_out(m), "job": job_out(j)} for m, j in rows]}


@router.get("/matches/{match_id}")
async def get_match(match_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    m = await db.get(JobMatch, match_id)
    if m is None or m.candidate_id != candidate.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found")
    job = await db.get(Job, m.job_id)
    return {**match_out(m), "job": job_out(job) if job else None}


@router.post("/matches/{match_id}/explain")
async def explain(match_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    """Generate the LLM explanation on demand (explains, never alters, the computed result)."""
    from app.agents.job_analyst_agent import explain_match
    from app.services.llm import LLMOutputError, LLMUnavailable

    m = await db.get(JobMatch, match_id)
    if m is None or m.candidate_id != candidate.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Match not found")
    job = await db.get(Job, m.job_id)
    assert job is not None
    try:
        ok = await explain_match(db, m, job, candidate, None)
    except (LLMUnavailable, LLMOutputError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, f"LLM unavailable: {exc}") from exc
    if not ok:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "LLM is not configured")
    await db.commit()
    return match_out(m)
