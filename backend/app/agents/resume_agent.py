"""Resume Agent: ingests an uploaded resume into a verified candidate profile and an immutable MASTER version."""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel, Field
from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.models import CandidateProfile, ResumeFile, ResumeVersion
from app.schemas.profile import CandidateProfileData
from app.services import storage
from app.services.repository import get_candidate, next_version_number, sync_candidate_skills
from app.services.resume_document import content_from_profile
from app.services.resume_parser import parse_resume
from app.services.text_extraction import extract


class ResumeIngestOutput(BaseModel):
    candidate_id: str
    resume_version_id: str
    resume_file_id: str
    warnings: list[str] = Field(default_factory=list)
    skills: int = 0
    experience_entries: int = 0
    target_roles: list[str] = Field(default_factory=list)


def content_hash(obj: dict) -> str:
    return hashlib.sha256(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


async def create_master_version(db: AsyncSession, candidate: CandidateProfile, profile: CandidateProfileData,
                                resume_file_id: str | None, parent_id: str | None, label: str,
                                changes: dict | None = None) -> ResumeVersion:
    content = content_from_profile(profile, "ats_classic")
    data = content.model_dump(mode="json")
    version = ResumeVersion(
        candidate_id=candidate.id, version_type="MASTER", version_number=await next_version_number(db, candidate.id),
        label=label, template=content.template, status="APPROVED", content_json=data, content_hash=content_hash(data),
        resume_file_id=resume_file_id, parent_version_id=parent_id, changes_json=changes or {},
    )
    db.add(version)
    await db.flush()
    return version


class ResumeAgent(BaseAgent):
    name = "resume_agent"

    def __init__(self, filename: str, data: bytes) -> None:
        self.filename = filename
        self.data = data

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> ResumeIngestOutput:
        user_id = payload["user_id"]
        doc = extract(self.filename, self.data)  # raises ExtractionError on invalid/unsupported files
        parsed = parse_resume(doc.text)
        profile = parsed.profile
        warnings = parsed.warnings + doc.warnings

        candidate = await get_candidate(db, user_id)
        if candidate is None:
            candidate = CandidateProfile(user_id=user_id)
            db.add(candidate)
            await db.flush()
        c = profile.contact
        candidate.full_name, candidate.email, candidate.phone, candidate.location = c.name, c.email, c.phone, c.location
        candidate.summary = profile.summary
        candidate.raw_resume_text = doc.text
        candidate.resume_hash = storage.sha256(self.data)
        candidate.structured_profile_json = profile.model_dump(mode="json")
        candidate.parse_warnings_json = warnings
        await sync_candidate_skills(db, candidate, profile)

        await db.execute(update(ResumeFile).where(ResumeFile.candidate_id == candidate.id).values(is_current=False))
        rel = storage.save_bytes(user_id, "uploads", self.data, doc.file_type)
        rfile = ResumeFile(candidate_id=candidate.id, original_filename=self.filename[:255], content_type=doc.file_type,
                           file_path=rel, size_bytes=len(self.data), sha256=candidate.resume_hash, is_current=True,
                           layout_json={**doc.layout, "page_count": doc.page_count})
        db.add(rfile)
        await db.flush()
        prev = None
        from app.services.repository import master_version

        prev = await master_version(db, candidate.id)
        version = await create_master_version(db, candidate, profile, rfile.id, prev.id if prev else None,
                                              label=f"Master – {self.filename[:80]}")
        await db.commit()
        ctx.emit("resume.uploaded", {"candidate_id": candidate.id, "resume_version_id": version.id,
                                     "previous_version_id": prev.id if prev else None})
        return ResumeIngestOutput(candidate_id=candidate.id, resume_version_id=version.id, resume_file_id=rfile.id,
                                  warnings=warnings, skills=len(profile.skills), experience_entries=len(profile.experience),
                                  target_roles=profile.target_roles)
