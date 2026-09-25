from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.profile import CertificationEntry, Contact, EducationEntry


class ResumeBullet(BaseModel):
    text: str
    source_type: Literal["experience", "project", "summary", "achievement"]
    source_id: str | None = None
    source_index: int | None = None  # index of the original bullet within its source entry
    original_text: str | None = None
    verified: bool = True
    rewrite_rejected_reasons: list[str] = Field(default_factory=list)


class ResumeExperienceBlock(BaseModel):
    source_id: str
    title: str | None = None
    company: str | None = None
    location: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    current: bool = False
    is_internship: bool = False
    bullets: list[ResumeBullet] = Field(default_factory=list)


class ResumeProjectBlock(BaseModel):
    source_id: str
    name: str
    description: str | None = None
    url: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    bullets: list[ResumeBullet] = Field(default_factory=list)


class ResumeContent(BaseModel):
    contact: Contact
    summary: str | None = None
    summary_source: Literal["original", "generated", "none"] = "none"
    skills: dict[str, list[str]] = Field(default_factory=dict)  # category label -> skills (all verified)
    experience: list[ResumeExperienceBlock] = Field(default_factory=list)
    projects: list[ResumeProjectBlock] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    certifications: list[CertificationEntry] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    section_order: list[str] = Field(default_factory=lambda: ["summary", "skills", "experience", "projects",
                                                              "education", "certifications", "achievements"])
    template: str = "ats_classic"

    def all_bullets(self) -> list[ResumeBullet]:
        return [b for e in self.experience for b in e.bullets] + [b for p in self.projects for b in p.bullets]


class TemplateInfo(BaseModel):
    id: str
    name: str
    description: str
    section_order: list[str]


class ResumeVersionOut(BaseModel):
    id: str
    version_number: int
    version_type: str
    label: str | None
    job_id: str | None
    parent_version_id: str | None
    template: str
    status: str
    quality_index: float | None
    parser_score: float | None
    keyword_score: float | None
    requirement_score: float | None
    evidence_score: float | None
    round_trip_score: float | None
    formatting_score: float | None
    created_at: str
    approved_at: str | None = None
    has_docx: bool = False
    has_pdf: bool = False
