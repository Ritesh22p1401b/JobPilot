"""Authorized application submission.

Submission is only possible through provider APIs where the credentials are *authorized for that workflow*
(e.g. a Greenhouse Job Board API key or Lever postings key issued by the employer). There is no generic
"submit anywhere" browser automation; every other destination falls back to assisted application.
"""

from __future__ import annotations

from typing import Protocol

from pydantic import BaseModel, Field


class ApplicationPackage(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str | None = None
    resume_filename: str
    resume_bytes: bytes
    cover_letter: str | None = None
    answers: dict[str, str] = Field(default_factory=dict)  # provider field name -> approved answer
    urls: dict[str, str] = Field(default_factory=dict)


class ValidationResult(BaseModel):
    ok: bool
    missing_required: list[str] = Field(default_factory=list)
    errors: list[str] = Field(default_factory=list)
    questions: list[dict] = Field(default_factory=list)


class SubmissionResult(BaseModel):
    ok: bool
    reference: str | None = None
    status_code: int | None = None
    message: str = ""


class ApplicationProvider(Protocol):
    name: str

    def is_authorized(self, external_id: str) -> bool: ...

    async def validate_application(self, external_id: str, package: ApplicationPackage) -> ValidationResult: ...

    async def submit_application(self, external_id: str, package: ApplicationPackage) -> SubmissionResult: ...
