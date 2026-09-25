"""RawJob -> NormalizedJob conversion."""

from __future__ import annotations

import hashlib
import re

from app.schemas.job import NormalizedJob, RawJob
from app.services.html_text import html_to_text
from app.services.jd_parser import infer_seniority
from app.services.skill_normalizer import extract_skills, unique_skills

_EMPLOYMENT_MAP = {
    "full_time": ["full time", "full-time", "fulltime", "permanent", "full_time"],
    "part_time": ["part time", "part-time", "part_time"],
    "contract": ["contract", "contractor", "freelance", "temporary contract"],
    "internship": ["intern", "internship"],
    "temporary": ["temporary", "temp"],
}


def normalize_text_key(value: str | None) -> str:
    if not value:
        return ""
    v = value.lower()
    v = re.sub(r"\b(inc|llc|ltd|limited|pvt|private|corp|corporation|co|gmbh|technologies|technology|labs)\b\.?", " ", v)
    v = re.sub(r"[^a-z0-9 ]", " ", v)
    return re.sub(r"\s+", " ", v).strip()


def normalize_employment_type(value: str | None, title: str) -> str | None:
    probe = f"{value or ''}".lower()
    for key, variants in _EMPLOYMENT_MAP.items():
        if any(v in probe for v in variants):
            return key
    if re.search(r"\bintern(ship)?\b", title, re.I):
        return "internship"
    if re.search(r"\bcontract\b", title, re.I):
        return "contract"
    return None


def detect_work_mode(title: str, location: str | None, text: str, remote_flag: bool | None) -> tuple[bool, str | None]:
    blob = f"{title} {location or ''}".lower()
    if "hybrid" in blob:
        return False, "hybrid"
    if remote_flag or re.search(r"\bremote\b|\bwork from home\b|\banywhere\b", blob):
        return True, "remote"
    head = text[:1500].lower()
    if re.search(r"\bhybrid\b", head):
        return False, "hybrid"
    if re.search(r"\bfully remote\b|\b100% remote\b|\bremote[- ]first\b|\bthis (?:role|position) is remote\b", head):
        return True, "remote"
    if re.search(r"\bon[- ]?site\b|\bin[- ]office\b", head):
        return False, "onsite"
    return False, None


def description_hash(text: str) -> str:
    core = re.sub(r"\s+", " ", text.lower()).strip()[:5000]
    return hashlib.sha256(core.encode()).hexdigest()


def fingerprint(company: str, title: str, location: str | None, description: str) -> str:
    key = "|".join([normalize_text_key(company), normalize_text_key(title), normalize_text_key(location),
                    description_hash(description)[:16]])
    return hashlib.sha256(key.encode()).hexdigest()


def normalize_job(raw: RawJob) -> NormalizedJob:
    text = html_to_text(raw.description)
    remote, work_mode = detect_work_mode(raw.title, raw.location, text, raw.remote)
    employment = normalize_employment_type(raw.employment_type, raw.title)
    skills = unique_skills(extract_skills(text))
    title = re.sub(r"\s+", " ", raw.title).strip()
    company = re.sub(r"\s+", " ", raw.company).strip()
    content_hash = hashlib.sha256(
        "|".join([company, title, raw.location or "", text, str(raw.salary_min), str(raw.salary_max)]).encode()
    ).hexdigest()
    return NormalizedJob(
        job_id=f"{raw.source}:{raw.external_id}",
        source=raw.source,
        external_id=raw.external_id,
        company=company,
        title=title,
        location=(raw.location or "").strip() or None,
        remote=remote,
        work_mode=work_mode,
        employment_type=employment,
        seniority=infer_seniority(title, None),
        salary_min=raw.salary_min,
        salary_max=raw.salary_max,
        currency=raw.currency,
        description=text,
        description_truncated=raw.description_truncated,
        skills=skills,
        url=raw.url,
        application_url=raw.application_url or raw.url,
        posted_at=raw.posted_at,
        content_hash=content_hash,
        fingerprint=fingerprint(company, title, raw.location, text),
        raw=raw.raw,
    )
