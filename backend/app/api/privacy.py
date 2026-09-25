"""Privacy controls: export and deletion of personal data."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.api.serializers import application_out, iso, notification_out, version_out
from app.database import get_db
from app.models import (
    AgentRun,
    Application,
    CandidatePreferences,
    CandidateProfile,
    EventTask,
    Notification,
    ResumeFile,
    ResumeVersion,
    User,
)
from app.services import storage
from app.services.repository import audit, get_candidate
from app.services.vector_store import CANDIDATES, get_vector_store

router = APIRouter(prefix="/privacy", tags=["privacy"])


@router.get("/export")
async def export(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> JSONResponse:
    candidate = await get_candidate(db, user.id)
    data: dict = {"user": {"id": user.id, "email": user.email, "created_at": iso(user.created_at)}}
    prefs = (await db.execute(select(CandidatePreferences).where(CandidatePreferences.user_id == user.id))).scalars().first()
    data["preferences"] = prefs.preferences_json if prefs else None
    if candidate:
        data["profile"] = candidate.structured_profile_json
        data["resume_versions"] = [{**version_out(v), "content": v.content_json} for v in (await db.execute(
            select(ResumeVersion).where(ResumeVersion.candidate_id == candidate.id))).scalars()]
        data["applications"] = [application_out(a) for a in (await db.execute(
            select(Application).where(Application.candidate_id == candidate.id))).scalars()]
    data["notifications"] = [notification_out(n) for n in (await db.execute(
        select(Notification).where(Notification.user_id == user.id))).scalars()]
    await audit(db, user.id, "privacy.export")
    await db.commit()
    return JSONResponse(data, headers={"Content-Disposition": 'attachment; filename="jobpilot_export.json"'})


@router.delete("/resumes")
async def delete_resumes(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Delete uploaded and generated resume files and all resume versions (profile is kept)."""
    candidate = await get_candidate(db, user.id)
    if candidate:
        await db.execute(delete(ResumeVersion).where(ResumeVersion.candidate_id == candidate.id))
        await db.execute(delete(ResumeFile).where(ResumeFile.candidate_id == candidate.id))
        candidate.raw_resume_text = None
    storage.delete_user_files(user.id)
    await audit(db, user.id, "privacy.delete_resumes")
    await db.commit()
    return {"deleted": "resumes"}


@router.delete("/applications")
async def delete_applications(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    candidate = await get_candidate(db, user.id)
    if candidate:
        await db.execute(delete(Application).where(Application.candidate_id == candidate.id))
    await audit(db, user.id, "privacy.delete_applications")
    await db.commit()
    return {"deleted": "applications"}


@router.delete("/profile")
async def delete_profile(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Delete the candidate profile and everything derived from it (resumes, matches, applications)."""
    candidate = await get_candidate(db, user.id)
    if candidate:
        await get_vector_store().delete(CANDIDATES, [candidate.id])
        await db.execute(delete(AgentRun).where(AgentRun.candidate_id == candidate.id))
        await db.execute(delete(CandidateProfile).where(CandidateProfile.id == candidate.id))
    storage.delete_user_files(user.id)
    await audit(db, user.id, "privacy.delete_profile")
    await db.commit()
    return {"deleted": "profile"}


@router.delete("/account")
async def delete_account(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    candidate = await get_candidate(db, user.id)
    if candidate:
        await get_vector_store().delete(CANDIDATES, [candidate.id])
        await db.execute(delete(AgentRun).where(AgentRun.candidate_id == candidate.id))
    await db.execute(delete(EventTask).where(EventTask.user_id == user.id))
    await db.execute(delete(User).where(User.id == user.id))
    storage.delete_user_files(user.id)
    await audit(db, None, "privacy.delete_account", user.id)
    await db.commit()
    return {"deleted": "account"}
