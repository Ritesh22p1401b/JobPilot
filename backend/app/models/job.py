from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, new_id, utcnow


class JobSource(Base):
    __tablename__ = "job_sources"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    name: Mapped[str] = mapped_column(String(64), unique=True)
    type: Mapped[str] = mapped_column(String(32))  # ats_api | search_api | destination
    base_url: Mapped[str] = mapped_column(String(512))
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    configuration_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (UniqueConstraint("source", "external_id", name="uq_jobs_source_external"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    external_id: Mapped[str] = mapped_column(String(255))
    source: Mapped[str] = mapped_column(String(64), index=True)
    source_id: Mapped[str | None] = mapped_column(ForeignKey("job_sources.id", ondelete="SET NULL"))
    company: Mapped[str] = mapped_column(String(255))
    title: Mapped[str] = mapped_column(String(512))
    location: Mapped[str | None] = mapped_column(String(512))
    remote: Mapped[bool] = mapped_column(Boolean, default=False)
    work_mode: Mapped[str | None] = mapped_column(String(32))
    employment_type: Mapped[str | None] = mapped_column(String(32))
    seniority: Mapped[str | None] = mapped_column(String(32))
    salary_min: Mapped[float | None] = mapped_column(Float)
    salary_max: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(8))
    description: Mapped[str] = mapped_column(Text, default="")
    description_truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    application_url: Mapped[str | None] = mapped_column(String(1024))
    source_url: Mapped[str] = mapped_column(String(1024))
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    content_hash: Mapped[str] = mapped_column(String(64), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64), index=True)
    duplicate_of_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    alternate_sources_json: Mapped[list] = mapped_column(JSON, default=list)
    analysis_hash: Mapped[str | None] = mapped_column(String(64))  # content_hash the JD analysis was built from
    jd_analysis_json: Mapped[dict] = mapped_column(JSON, default=dict)
    raw_json: Mapped[dict] = mapped_column(JSON, default=dict)


class JobSkill(Base):
    __tablename__ = "job_skills"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64))
    required: Mapped[bool] = mapped_column(Boolean, default=False)


class JdRequirement(Base):
    __tablename__ = "jd_requirements"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    requirement: Mapped[str] = mapped_column(String(512))
    category: Mapped[str] = mapped_column(String(64))
    importance: Mapped[float] = mapped_column(Float, default=1.0)
    source_span: Mapped[str] = mapped_column(Text, default="")
    evidence_required: Mapped[bool] = mapped_column(Boolean, default=True)
    extracted_by: Mapped[str] = mapped_column(String(16), default="rules")  # rules | llm
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class RequirementMatch(Base):
    __tablename__ = "requirement_matches"
    __table_args__ = (UniqueConstraint("requirement_id", "candidate_id", name="uq_reqmatch"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    requirement_id: Mapped[str] = mapped_column(ForeignKey("jd_requirements.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(32))
    match_type: Mapped[str] = mapped_column(String(16))
    confidence: Mapped[str] = mapped_column(String(16))
    evidence_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class JobMatch(Base):
    __tablename__ = "job_matches"
    __table_args__ = (UniqueConstraint("job_id", "candidate_id", name="uq_job_match"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    overall_score: Mapped[float] = mapped_column(Float)
    skill_score: Mapped[float] = mapped_column(Float)
    role_score: Mapped[float] = mapped_column(Float)
    experience_score: Mapped[float] = mapped_column(Float)
    location_score: Mapped[float] = mapped_column(Float)
    education_score: Mapped[float] = mapped_column(Float)
    preference_score: Mapped[float] = mapped_column(Float)
    seniority_score: Mapped[float] = mapped_column(Float)
    semantic_similarity: Mapped[float | None] = mapped_column(Float)
    hard_filter_passed: Mapped[bool] = mapped_column(Boolean, default=True)
    hard_filter_reasons_json: Mapped[list] = mapped_column(JSON, default=list)
    matched_skills_json: Mapped[list] = mapped_column(JSON, default=list)
    missing_skills_json: Mapped[dict] = mapped_column(JSON, default=dict)
    breakdown_json: Mapped[dict] = mapped_column(JSON, default=dict)
    explanation: Mapped[str | None] = mapped_column(Text)
    explanation_source: Mapped[str | None] = mapped_column(String(16))  # rules | llm
    input_hash: Mapped[str] = mapped_column(String(64))
    resume_compatibility: Mapped[float | None] = mapped_column(Float)
    saved: Mapped[bool] = mapped_column(Boolean, default=False)
    dismissed: Mapped[bool] = mapped_column(Boolean, default=False)
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    run_count: Mapped[int] = mapped_column(Integer, default=1)
