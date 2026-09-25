from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, new_id, utcnow


class ResumeFile(Base):
    """An uploaded original resume. Originals are preserved byte-for-byte."""

    __tablename__ = "resume_files"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    original_filename: Mapped[str] = mapped_column(String(255))
    content_type: Mapped[str] = mapped_column(String(128))
    file_path: Mapped[str] = mapped_column(String(1024))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    is_current: Mapped[bool] = mapped_column(Boolean, default=True)
    layout_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResumeVersion(Base):
    """MASTER versions come from uploads; TAILORED/VARIANT versions are derived and never overwrite a master."""

    __tablename__ = "resume_versions"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"), index=True)
    parent_version_id: Mapped[str | None] = mapped_column(ForeignKey("resume_versions.id", ondelete="SET NULL"))
    resume_file_id: Mapped[str | None] = mapped_column(ForeignKey("resume_files.id", ondelete="SET NULL"))
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    version_type: Mapped[str] = mapped_column(String(16))  # MASTER | TAILORED | VARIANT
    label: Mapped[str | None] = mapped_column(String(255))
    template: Mapped[str] = mapped_column(String(64), default="ats_classic")
    status: Mapped[str] = mapped_column(String(24), default="DRAFT")  # DRAFT|NEEDS_REVIEW|APPROVED|REJECTED|FAILED
    content_json: Mapped[dict] = mapped_column(JSON, default=dict)
    changes_json: Mapped[dict] = mapped_column(JSON, default=dict)
    file_path: Mapped[str | None] = mapped_column(String(1024))  # generated DOCX
    pdf_path: Mapped[str | None] = mapped_column(String(1024))
    content_hash: Mapped[str | None] = mapped_column(String(64))
    quality_index: Mapped[float | None] = mapped_column(Float)
    parser_score: Mapped[float | None] = mapped_column(Float)
    keyword_score: Mapped[float | None] = mapped_column(Float)
    requirement_score: Mapped[float | None] = mapped_column(Float)
    evidence_score: Mapped[float | None] = mapped_column(Float)
    round_trip_score: Mapped[float | None] = mapped_column(Float)
    formatting_score: Mapped[float | None] = mapped_column(Float)
    last_report_json: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ResumeTest(Base):
    __tablename__ = "resume_tests"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    resume_version_id: Mapped[str] = mapped_column(ForeignKey("resume_versions.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str | None] = mapped_column(ForeignKey("jobs.id", ondelete="SET NULL"))
    run_id: Mapped[str] = mapped_column(String(32), index=True)
    test_name: Mapped[str] = mapped_column(String(64))
    status: Mapped[str] = mapped_column(String(16))  # PASS | WARN | FAIL | SKIP
    score: Mapped[float | None] = mapped_column(Float)
    severity: Mapped[str] = mapped_column(String(16), default="info")
    critical: Mapped[bool] = mapped_column(Boolean, default=False)
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class ResumeClaim(Base):
    __tablename__ = "resume_claims"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    resume_version_id: Mapped[str] = mapped_column(ForeignKey("resume_versions.id", ondelete="CASCADE"), index=True)
    claim_text: Mapped[str] = mapped_column(Text)
    section: Mapped[str] = mapped_column(String(32))
    source_type: Mapped[str] = mapped_column(String(32))
    source_id: Mapped[str | None] = mapped_column(String(64))
    original_text: Mapped[str | None] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean)
    confidence: Mapped[float] = mapped_column(Float)
    reasons_json: Mapped[list] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
