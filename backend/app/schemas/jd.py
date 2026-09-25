from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

RequirementCategory = Literal[
    "REQUIRED_SKILL",
    "PREFERRED_SKILL",
    "NICE_TO_HAVE",
    "REQUIRED_EXPERIENCE",
    "PREFERRED_EXPERIENCE",
    "EDUCATION",
    "CERTIFICATION",
    "JOB_TITLE",
    "RESPONSIBILITY",
    "LOCATION",
    "WORK_MODE",
    "EMPLOYMENT_TYPE",
    "WORK_AUTHORIZATION",
    "LANGUAGE",
    "DOMAIN",
    "SOFT_SKILL",
    "OTHER",
]
SKILL_CATEGORIES = {"REQUIRED_SKILL", "PREFERRED_SKILL", "NICE_TO_HAVE"}
Tier = Literal["REQUIRED", "PREFERRED", "NICE_TO_HAVE", "RESPONSIBILITY", "CONTEXT", "UNSPECIFIED"]


class Requirement(BaseModel):
    requirement: str
    category: RequirementCategory
    tier: Tier = "UNSPECIFIED"
    importance: float = 1.0
    evidence_required: bool = True
    source_span: str = ""
    skill: str | None = None  # canonical skill name for skill requirements
    min_years: float | None = None
    max_years: float | None = None
    degree_level: str | None = None
    extracted_by: Literal["rules", "llm"] = "rules"


class JDAnalysis(BaseModel):
    role_title: str
    seniority: str = "unspecified"
    required_skills: list[str] = Field(default_factory=list)
    preferred_skills: list[str] = Field(default_factory=list)
    nice_to_have_skills: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    experience_requirements: list[str] = Field(default_factory=list)
    responsibilities: list[str] = Field(default_factory=list)
    keywords: list[str] = Field(default_factory=list)
    domain_terms: list[str] = Field(default_factory=list)
    soft_skills: list[str] = Field(default_factory=list)
    min_years: float | None = None
    max_years: float | None = None
    work_mode: str | None = None
    employment_type: str | None = None
    sponsorship: str | None = None  # available | not_available | None (unknown)
    has_explicit_sections: bool = False
    requirements: list[Requirement] = Field(default_factory=list)
    analyzer_version: str = "rules:v1"
