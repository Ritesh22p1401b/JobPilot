from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RawJob(BaseModel):
    """Provider output before normalisation. `description` may be HTML."""

    source: str
    external_id: str
    company: str
    title: str
    location: str | None = None
    description: str = ""
    description_truncated: bool = False
    url: str
    application_url: str | None = None
    posted_at: datetime | None = None
    salary_min: float | None = None
    salary_max: float | None = None
    currency: str | None = None
    employment_type: str | None = None
    remote: bool | None = None
    raw: dict = Field(default_factory=dict)


class NormalizedJob(BaseModel):
    job_id: str  # "<source>:<external_id>"
    source: str
    external_id: str
    company: str
    title: str
    location: str | None
    remote: bool
    work_mode: str | None
    employment_type: str | None
    seniority: str | None
    salary_min: float | None
    salary_max: float | None
    currency: str | None
    description: str
    description_truncated: bool = False
    skills: list[str] = Field(default_factory=list)
    requirements: list[str] = Field(default_factory=list)
    url: str
    application_url: str | None
    posted_at: datetime | None
    content_hash: str
    fingerprint: str
    raw: dict = Field(default_factory=dict)
