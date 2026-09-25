"""Lever postings application submission (requires the employer-controlled postings API key)."""

from __future__ import annotations

import httpx

from app.application_providers.base import ApplicationPackage, SubmissionResult, ValidationResult
from app.config import get_settings

BASE = "https://api.lever.co/v0/postings"


class LeverApplicationProvider:
    name = "lever"

    def __init__(self, keys: dict[str, str] | None = None, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.keys = keys if keys is not None else get_settings().lever_posting_api_keys
        self._transport = transport

    def is_authorized(self, external_id: str) -> bool:
        return bool(self.keys.get(external_id.partition(":")[0]))

    async def validate_application(self, external_id: str, package: ApplicationPackage) -> ValidationResult:
        if not self.is_authorized(external_id):
            return ValidationResult(ok=False, errors=["No authorized Lever API key for this site."])
        missing = [f for f in ("email",) if not getattr(package, f)]
        if not package.resume_bytes:
            missing.append("resume")
        return ValidationResult(ok=not missing, missing_required=missing)

    async def submit_application(self, external_id: str, package: ApplicationPackage) -> SubmissionResult:
        site, _, posting_id = external_id.partition(":")
        key = self.keys.get(site)
        if not key:
            return SubmissionResult(ok=False, message="Not authorized for this site.")
        data = {"name": f"{package.first_name} {package.last_name}".strip(), "email": package.email}
        if package.phone:
            data["phone"] = package.phone
        if package.cover_letter:
            data["comments"] = package.cover_letter
        for label, url in package.urls.items():
            data[f"urls[{label}]"] = url
        files = {"resume": (package.resume_filename, package.resume_bytes, "application/octet-stream")}
        async with httpx.AsyncClient(timeout=60, transport=self._transport) as client:
            resp = await client.post(f"{BASE}/{site}/{posting_id}", params={"key": key}, data=data, files=files)
        ok = resp.status_code in (200, 201)
        ref = None
        if ok:
            try:
                ref = str(resp.json().get("applicationId") or "")
            except ValueError:
                ref = None
        return SubmissionResult(ok=ok, reference=ref, status_code=resp.status_code, message=resp.text[:300])
