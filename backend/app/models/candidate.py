from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, new_id, utcnow


class CandidateProfile(Base):
    __tablename__ = "candidate_profiles"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    full_name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320))
    phone: Mapped[str | None] = mapped_column(String(64))
    location: Mapped[str | None] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text)
    raw_resume_text: Mapped[str | None] = mapped_column(Text)
    resume_hash: Mapped[str | None] = mapped_column(String(64))
    structured_profile_json: Mapped[dict] = mapped_column(JSON, default=dict)
    parse_warnings_json: Mapped[list] = mapped_column(JSON, default=list)
    last_discovery_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class CandidateSkill(Base):
    __tablename__ = "candidate_skills"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    skill: Mapped[str] = mapped_column(String(128))
    category: Mapped[str] = mapped_column(String(64))
    proficiency: Mapped[str | None] = mapped_column(String(32))
    years_experience: Mapped[float | None] = mapped_column(Float)
    source: Mapped[str] = mapped_column(String(255))  # comma-separated resume sections


class CandidatePreferences(Base):
    __tablename__ = "candidate_preferences"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, index=True)
    preferences_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
