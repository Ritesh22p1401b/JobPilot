from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.application_agent import (
    ApplicationError,
    ApproveRequest,
    add_event,
    approve_application,
    get_or_create_application,
    submit_application,
)
from app.api.deps import agent_limiter, current_candidate
from app.api.serializers import application_out, task_out
from app.database import get_db, utcnow
from app.events.bus import publish
from app.models import Application, ApplicationEvent, CandidateProfile, Job, JobMatch
from app.models.application import APPLICATION_STATUSES

router = APIRouter(prefix="/applications", tags=["applications"])


async def _owned(db: AsyncSession, candidate: CandidateProfile, app_id: str) -> Application:
    app = await db.get(Application, app_id)
    if app is None or app.candidate_id != candidate.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Application not found")
    return app


async def _by_job(db: AsyncSession, candidate: CandidateProfile, job_id: str) -> Application:
    app = (await db.execute(select(Application).where(Application.candidate_id == candidate.id,
                                                      Application.job_id == job_id))).scalars().first()
    if app is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No application for this job; prepare it first")
    return app


@router.get("")
async def list_applications(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    rows = (await db.execute(select(Application, Job, JobMatch).join(Job, Job.id == Application.job_id)
                             .outerjoin(JobMatch, and_(JobMatch.job_id == Job.id, JobMatch.candidate_id == candidate.id))
                             .where(Application.candidate_id == candidate.id)
                             .order_by(Application.updated_at.desc()))).all()
    return {"applications": [application_out(a, j, match=m) for a, j, m in rows], "statuses": list(APPLICATION_STATUSES)}


@router.get("/{application_id}")
async def get_application(application_id: str, candidate: CandidateProfile = Depends(current_candidate),
                          db: AsyncSession = Depends(get_db)) -> dict:
    app = await _owned(db, candidate, application_id)
    job = await db.get(Job, app.job_id)
    events = (await db.execute(select(ApplicationEvent).where(ApplicationEvent.application_id == app.id)
                               .order_by(ApplicationEvent.created_at))).scalars().all()
    match = (await db.execute(select(JobMatch).where(JobMatch.job_id == app.job_id,
                                                     JobMatch.candidate_id == candidate.id))).scalars().first()
    return application_out(app, job, list(events), match)


@router.post("/{job_id}/save", status_code=201)
async def save(job_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    app = await get_or_create_application(db, candidate.id, job, "user")
    await db.commit()
    return application_out(app, job)


@router.post("/{job_id}/prepare", status_code=202, dependencies=[Depends(agent_limiter)])
async def prepare(job_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    app = await get_or_create_application(db, candidate.id, job, "user")
    add_event(db, app, "user", "prepare_requested", app.status, app.status)
    await db.commit()
    task = await publish(db, "application.prepare_requested", {"candidate_id": candidate.id, "job_id": job.id},
                         user_id=candidate.user_id, dedup_key=f"prepare:{candidate.id}:{job.id}")
    return {"application_id": app.id, "task": task_out(task)}


@router.post("/{job_id}/approve")
async def approve(job_id: str, body: ApproveRequest, candidate: CandidateProfile = Depends(current_candidate),
                  db: AsyncSession = Depends(get_db)) -> dict:
    app = await _by_job(db, candidate, job_id)
    if not app.answers_json and not app.cover_letter:
        raise HTTPException(status.HTTP_409_CONFLICT, "Prepare the application before approving it")
    await approve_application(db, app, body)
    await db.commit()
    return application_out(app)


@router.post("/{job_id}/submit")
async def submit(job_id: str, candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    app = await _by_job(db, candidate, job_id)
    try:
        result = await submit_application(db, app)
    except ApplicationError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    await db.commit()
    return {"result": result.model_dump(), "application": application_out(app)}


class ApplicationPatch(BaseModel):
    status: str | None = None
    notes: str | None = None


# Status changes a user may make manually (e.g. after applying on the employer site).
MANUAL_TRANSITIONS = {"SAVED", "READY", "APPLIED", "ASSESSMENT", "INTERVIEW", "REJECTED", "WITHDRAWN", "OFFER"}


@router.patch("/{application_id}")
async def patch(application_id: str, body: ApplicationPatch, candidate: CandidateProfile = Depends(current_candidate),
                db: AsyncSession = Depends(get_db)) -> dict:
    app = await _owned(db, candidate, application_id)
    prev = app.status
    if body.status:
        if body.status not in MANUAL_TRANSITIONS:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid status. Allowed: {sorted(MANUAL_TRANSITIONS)}")
        app.status = body.status
        if body.status == "APPLIED" and app.applied_at is None:
            app.applied_at = utcnow()
    if body.notes is not None:
        app.notes = body.notes
    add_event(db, app, "user", "status_changed" if body.status else "notes_updated", prev, app.status, notes=body.notes)
    await db.commit()
    return application_out(app)
