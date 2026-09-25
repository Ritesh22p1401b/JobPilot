"""Common provider interface. Every job source implements JobProvider."""

from __future__ import annotations

import re
from typing import Protocol, runtime_checkable

from app.schemas.job import RawJob

_GENERIC = {"engineer", "developer", "dev", "specialist", "the", "and", "of", "for", "in", "a", "an", "role", "job"}
_SYNONYMS = {"developer": "engineer", "dev": "engineer", "sde": "software engineer", "swe": "software engineer",
             "ml": "machine learning", "ai/ml": "ai machine learning", "genai": "generative ai",
             "back-end": "backend", "back end": "backend", "front-end": "frontend", "front end": "frontend",
             "fullstack": "full stack", "full-stack": "full stack", "llm": "llm", "nlp": "nlp"}
_CITY_ALIASES = {"bangalore": "bengaluru", "gurgaon": "gurugram", "bombay": "mumbai", "new delhi": "delhi"}


@runtime_checkable
class JobProvider(Protocol):
    name: str

    async def search(self, query: str, location: str | None = None, page: int = 1) -> list[RawJob]: ...

    async def get_job(self, external_id: str) -> RawJob | None: ...

    async def aclose(self) -> None: ...


def _tokens(text: str) -> list[str]:
    t = text.lower()
    for k, v in _SYNONYMS.items():
        t = re.sub(rf"(?<![a-z]){re.escape(k)}(?![a-z])", v, t)
    return re.findall(r"[a-z0-9+#.]+", t)


def title_matches(query: str, title: str) -> bool:
    """Local title filter for ATS boards that have no search endpoint (Greenhouse, Lever)."""
    q = [t for t in _tokens(query) if t not in _GENERIC]
    tt = set(_tokens(title))
    if not q:
        return bool(tt & {"engineer"})
    return all(t in tt for t in q)


def location_matches(location_filter: str | None, job_location: str | None) -> bool:
    if not location_filter or location_filter.lower() == "remote":
        return True
    if not job_location:
        return True
    loc = job_location.lower()
    want = location_filter.lower()
    for k, v in _CITY_ALIASES.items():
        loc = loc.replace(k, v)
        want = want.replace(k, v)
    return want in loc or "remote" in loc or "anywhere" in loc
