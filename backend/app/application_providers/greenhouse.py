"""Greenhouse Job Board application submission (requires the employer's Job Board API key for that board)."""

from __future__ import annotations

import httpx

from app.application_providers.base import ApplicationPackage, SubmissionResult, ValidationResult
from app.config import get_settings

BASE = "https://boards-api.greenhouse.io/v1/boards"
STANDARD = {"first_name", "last_name", "email", "phone", "resume", "resume_text", "cover_letter", "cover_letter_text"}


class GreenhouseApplicationProvider:
    name = "greenhouse"

    def __init__(self, keys: dict[str, str] | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.keys = keys if keys is not None else get_settings().greenhouse_board_api_keys
        self._transport = transport

    def is_authorized(self, external_id: str) -> bool:
        board = external_id.partition(":")[0]
        return bool(self.keys.get(board))

    async def validate_application(self, external_id: str, package: ApplicationPackage) -> ValidationResult:
        board, _, job_id = external_id.partition(":")
        if not self.is_authorized(external_id):
            return ValidationResult(ok=False, errors=[f"No authorized Greenhouse API key for board '{board}'."])
        async with httpx.AsyncClient(timeout=20, transport=self._transport) as client:
            resp = await client.get(f"{BASE}/{board}/jobs/{job_id}", params={"questions": "true"})
        if resp.status_code != 200:
            return ValidationResult(ok=False, errors=[f"Could not load application questions (HTTP {resp.status_code})."])
        questions = resp.json().get("questions", [])
        missing = []
        for q in questions:
            if not q.get("required"):
                continue
            for f in q.get("fields", []):
                name = f.get("name")
                if name in ("resume", "resume_text") and package.resume_bytes:
                    continue
                if name in ("cover_letter", "cover_letter_text") and package.cover_letter:
                    continue
                if name in STANDARD and getattr(package, name, None):
                    continue
                if not package.answers.get(name):
                    missing.append(q.get("label") or name)
        return ValidationResult(ok=not missing, missing_required=missing, questions=questions)

    async def submit_application(self, external_id: str, package: ApplicationPackage) -> SubmissionResult:
        board, _, job_id = external_id.partition(":")
        key = self.keys.get(board)
        if not key:
            return SubmissionResult(ok=False, message="Not authorized for this board.")
        data = {"first_name": package.first_name, "last_name": package.last_name, "email": package.email}
        if package.phone:
            data["phone"] = package.phone
        if package.cover_letter:
            data["cover_letter_text"] = package.cover_letter
        data.update(package.answers)
        files = {"resume": (package.resume_filename, package.resume_bytes,
                            "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        async with httpx.AsyncClient(timeout=60, transport=self._transport) as client:
            resp = await client.post(f"{BASE}/{board}/jobs/{job_id}", data=data, files=files, auth=(key, ""))
        ok = resp.status_code in (200, 201)
        ref = None
        if ok:
            try:
                ref = str(resp.json().get("id") or resp.json().get("application_id") or "")
            except ValueError:
                ref = None
        return SubmissionResult(ok=ok, reference=ref, status_code=resp.status_code, message=resp.text[:300])
