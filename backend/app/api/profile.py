from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.resume_agent import create_master_version
from app.api.deps import current_candidate, current_user
from app.database import get_db
from app.events.bus import publish
from app.models import CandidateProfile, User
from app.schemas.preferences import Preferences
from app.schemas.profile import ProfileUpdate
from app.schemas.resume import ResumeContent
from app.services.dates import merged_months
from app.services.repository import audit, get_prefs, master_version, profile_data, save_prefs, sync_candidate_skills
from app.services.resume_diff import regression_summary
from app.services.skill_normalizer import normalize_skill, skill_category

router = APIRouter(tags=["profile"])


@router.get("/profile")
async def get_profile(candidate: CandidateProfile = Depends(current_candidate)) -> dict:
    return {"candidate_id": candidate.id, "profile": candidate.structured_profile_json,
            "warnings": candidate.parse_warnings_json or []}


@router.patch("/profile")
async def update_profile(body: ProfileUpdate, candidate: CandidateProfile = Depends(current_candidate),
                         db: AsyncSession = Depends(get_db)) -> dict:
    """User edits are verified facts. Each edit produces a new MASTER version with a regression summary."""
    profile = profile_data(candidate)
    updates = body.model_dump(exclude_unset=True)
    for key, _value in updates.items():
        setattr(profile, key, getattr(body, key))
    for s in profile.skills:
        canonical = normalize_skill(s.name)
        if canonical:
            s.name, s.category, s.known = canonical, skill_category(canonical), True
        if not s.sections:
            s.sections = ["skills"]
    profile.total_experience_months = merged_months([(e.start_date, e.end_date) for e in profile.experience if not e.is_internship])
    profile.internship_months = merged_months([(e.start_date, e.end_date) for e in profile.experience if e.is_internship])
    profile.job_titles = list(dict.fromkeys(e.title for e in profile.experience if e.title))
    candidate.structured_profile_json = profile.model_dump(mode="json")
    c = profile.contact
    candidate.full_name, candidate.email, candidate.phone, candidate.location, candidate.summary = (
        c.name, c.email, c.phone, c.location, profile.summary)
    await sync_candidate_skills(db, candidate, profile)
    prev = await master_version(db, candidate.id)
    new = await create_master_version(db, candidate, profile, prev.resume_file_id if prev else None,
                                      prev.id if prev else None, label="Master – profile edit")
    regression = None
    if prev is not None:
        old_scores = {k: getattr(prev, k) for k in ("quality_index", "parser_score", "round_trip_score")}
        regression = regression_summary(ResumeContent.model_validate(prev.content_json),
                                        ResumeContent.model_validate(new.content_json), old_scores, {})
        new.changes_json = {"regression": regression, "edited_fields": list(updates)}
    await audit(db, candidate.user_id, "profile.updated", candidate.id, {"fields": list(updates)})
    await db.commit()
    # Re-test the new master (regression) and re-score jobs in the background.
    await publish(db, "resume.uploaded", {"candidate_id": candidate.id, "resume_version_id": new.id},
                  user_id=candidate.user_id)
    return {"profile": candidate.structured_profile_json, "master_version_id": new.id, "regression": regression}


@router.get("/preferences")
async def get_preferences(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    return (await get_prefs(db, user.id)).model_dump(mode="json")


@router.put("/preferences")
async def put_preferences(body: Preferences, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    if body.auto_apply and body.application_mode != "AUTHORIZED_AUTO_APPLY":
        body.auto_apply = False  # auto-apply requires the explicit AUTHORIZED_AUTO_APPLY mode
    await save_prefs(db, user.id, body)
    await audit(db, user.id, "preferences.updated", None, {"auto_apply": body.auto_apply, "mode": body.application_mode})
    await db.commit()
    from app.services.repository import get_candidate

    candidate = await get_candidate(db, user.id)
    if candidate:
        await publish(db, "profile.updated", {"candidate_id": candidate.id}, user_id=user.id,
                      dedup_key=f"profile.updated:{candidate.id}")
    return body.model_dump(mode="json")
