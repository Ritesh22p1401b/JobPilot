from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Severity = Literal["error", "warning", "info"]
TestStatus = Literal["PASS", "WARN", "FAIL", "SKIP"]


class Issue(BaseModel):
    type: str
    severity: Severity
    message: str


class TestResult(BaseModel):
    name: str
    status: TestStatus
    score: float | None = None
    critical: bool = False
    severity: Severity = "info"
    details: dict = Field(default_factory=dict)
    issues: list[Issue] = Field(default_factory=list)


class KeywordResult(BaseModel):
    keyword: str
    category: str
    importance: float
    classification: Literal["EXACT_MATCH", "SEMANTIC_MATCH", "RELATED_TERM", "MISSING", "CONFLICT"]
    resume_present: bool
    evidence_sections: list[str] = Field(default_factory=list)
    related_to: str | None = None
    occurrences: int = 0


class AssessmentReport(BaseModel):
    resume_version_id: str | None = None
    job_id: str | None = None
    ats_profile: str
    assessment: Literal["STRONG", "GOOD", "FAIR", "WEAK", "NEEDS_REVIEW"]
    quality_index: float
    parser_compatibility: float
    requirement_coverage: float | None
    keyword_alignment: float | None
    experience_evidence: float | None
    experience_relevance: float | None
    formatting_compatibility: float
    round_trip_fidelity: float | None
    unsupported_claims: int = 0
    component_weights: dict[str, float] = Field(default_factory=dict)
    score_explanations: dict[str, str] = Field(default_factory=dict)
    tests: list[TestResult] = Field(default_factory=list)
    issues: list[Issue] = Field(default_factory=list)
    recommendations: list[str] = Field(default_factory=list)
    keywords: list[KeywordResult] = Field(default_factory=list)
    requirement_matrix: list[dict] = Field(default_factory=list)
    extracted_text_preview: str = ""
    critical_failures: list[str] = Field(default_factory=list)
    disclaimer: str = ""
