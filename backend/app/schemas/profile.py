"""Structured candidate profile / resume content schemas (shared by parser, generator and matcher)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class Contact(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    location: str | None = None
    linkedin: str | None = None
    github: str | None = None
    portfolio: str | None = None
    other_links: list[str] = Field(default_factory=list)


class SkillEntry(BaseModel):
    name: str
    category: str = "other"
    sections: list[str] = Field(default_factory=list)  # where the skill is evidenced
    known: bool = True  # present in ontology


class ExperienceEntry(BaseModel):
    id: str
    company: str | None = None
    title: str | None = None
    location: str | None = None
    start_date: str | None = None  # YYYY-MM
    end_date: str | None = None  # YYYY-MM or None
    current: bool = False
    is_internship: bool = False
    bullets: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)
    raw_header: str | None = None


class EducationEntry(BaseModel):
    id: str
    institution: str | None = None
    degree: str | None = None
    degree_level: Literal["high_school", "diploma", "associate", "bachelor", "master", "doctorate", "other"] | None = None
    field: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    grade: str | None = None
    raw: str | None = None


class ProjectEntry(BaseModel):
    id: str
    name: str
    description: str | None = None
    url: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    bullets: list[str] = Field(default_factory=list)
    skills: list[str] = Field(default_factory=list)


class CertificationEntry(BaseModel):
    id: str
    name: str
    issuer: str | None = None
    date: str | None = None


class CandidateProfileData(BaseModel):
    contact: Contact = Field(default_factory=Contact)
    summary: str | None = None
    skills: list[SkillEntry] = Field(default_factory=list)
    experience: list[ExperienceEntry] = Field(default_factory=list)
    education: list[EducationEntry] = Field(default_factory=list)
    projects: list[ProjectEntry] = Field(default_factory=list)
    certifications: list[CertificationEntry] = Field(default_factory=list)
    achievements: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    sections_found: list[str] = Field(default_factory=list)
    total_experience_months: int = 0
    internship_months: int = 0
    job_titles: list[str] = Field(default_factory=list)
    domains: list[str] = Field(default_factory=list)
    target_roles: list[str] = Field(default_factory=list)
    soft_skills: list[str] = Field(default_factory=list)

    def skill_names(self) -> set[str]:
        return {s.name for s in self.skills}

    def skill(self, name: str) -> SkillEntry | None:
        return next((s for s in self.skills if s.name == name), None)

    @property
    def years_experience(self) -> float:
        return round(self.total_experience_months / 12, 1)

    def highest_degree_level(self) -> str | None:
        order = ["high_school", "diploma", "associate", "bachelor", "master", "doctorate"]
        levels = [e.degree_level for e in self.education if e.degree_level in order]
        return max(levels, key=order.index) if levels else None


class ProfileUpdate(BaseModel):
    """User edits to the verified profile (user-provided facts are verified by definition)."""

    contact: Contact | None = None
    summary: str | None = None
    skills: list[SkillEntry] | None = None
    experience: list[ExperienceEntry] | None = None
    education: list[EducationEntry] | None = None
    projects: list[ProjectEntry] | None = None
    certifications: list[CertificationEntry] | None = None
    target_roles: list[str] | None = None
    languages: list[str] | None = None
