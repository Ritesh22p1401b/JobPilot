from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, new_id, utcnow

APPLICATION_STATUSES = (
    "SAVED",
    "READY",
    "APPROVAL_REQUIRED",
    "APPLIED",
    "ASSESSMENT",
    "INTERVIEW",
    "REJECTED",
    "WITHDRAWN",
    "OFFER",
)


class Application(Base):
    __tablename__ = "applications"
    __table_args__ = (UniqueConstraint("candidate_id", "job_id", name="uq_application_candidate_job"),)

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    candidate_id: Mapped[str] = mapped_column(ForeignKey("candidate_profiles.id", ondelete="CASCADE"), index=True)
    job_id: Mapped[str] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(24), default="SAVED")
    mode: Mapped[str] = mapped_column(String(32), default="ASSISTED_APPLICATION")
    applied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    application_url: Mapped[str | None] = mapped_column(String(1024))
    resume_version_id: Mapped[str | None] = mapped_column(ForeignKey("resume_versions.id", ondelete="SET NULL"))
    cover_letter: Mapped[str | None] = mapped_column(Text)
    cover_letter_source: Mapped[str | None] = mapped_column(String(16))
    answers_json: Mapped[list] = mapped_column(JSON, default=list)
    package_json: Mapped[dict] = mapped_column(JSON, default=dict)
    submission_reference: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class ApplicationEvent(Base):
    """Immutable audit trail for every application action."""

    __tablename__ = "application_events"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=new_id)
    application_id: Mapped[str] = mapped_column(ForeignKey("applications.id", ondelete="CASCADE"), index=True)
    actor: Mapped[str] = mapped_column(String(64))  # user | agent:<name>
    action: Mapped[str] = mapped_column(String(64))
    from_status: Mapped[str | None] = mapped_column(String(24))
    to_status: Mapped[str | None] = mapped_column(String(24))
    details_json: Mapped[dict] = mapped_column(JSON, default=dict)
    notes: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
