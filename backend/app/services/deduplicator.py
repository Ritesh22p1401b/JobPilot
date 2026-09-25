"""Job deduplication.

1. Primary key: source + external_id (exact upsert).
2. Fallback fingerprint: normalised company + title + location + description hash.
3. Fuzzy matching (secondary): same normalised company, near-identical title and location,
   and highly similar description. Only used when 1 and 2 do not match.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from rapidfuzz import fuzz

from app.schemas.job import NormalizedJob
from app.services.normalizer import normalize_text_key


@dataclass
class ExistingJob:
    id: str
    source: str
    external_id: str
    company: str
    title: str
    location: str | None
    fingerprint: str
    description: str


@dataclass
class DedupDecision:
    kind: str  # "same_record" | "fingerprint_duplicate" | "fuzzy_duplicate" | "new"
    existing_id: str | None = None
    score: float | None = None


def _plain(text: str) -> str:
    """Formatting-insensitive text for comparison (bullets, punctuation and whitespace removed)."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9+#]+", " ", text.lower())).strip()


# Source preference when choosing a canonical record (richer descriptions first).
SOURCE_PRIORITY = {"greenhouse": 0, "lever": 1, "adzuna": 5}


def decide(job: NormalizedJob, candidates: list[ExistingJob]) -> DedupDecision:
    for c in candidates:
        if c.source == job.source and c.external_id == job.external_id:
            return DedupDecision("same_record", c.id)
    for c in candidates:
        if c.fingerprint == job.fingerprint:
            return DedupDecision("fingerprint_duplicate", c.id, 100.0)
    company = normalize_text_key(job.company)
    for c in candidates:
        if normalize_text_key(c.company) != company or c.source == job.source:
            continue
        title_score = fuzz.token_sort_ratio(normalize_text_key(c.title), normalize_text_key(job.title))
        if title_score < 92:
            continue
        loc_score = fuzz.token_set_ratio(normalize_text_key(c.location), normalize_text_key(job.location))
        if job.location and c.location and loc_score < 70:
            continue
        # Aggregators (e.g. Adzuna) truncate descriptions: look for the shorter text inside the longer one.
        short, long_ = sorted((_plain(c.description), _plain(job.description)), key=len)
        desc_score = fuzz.partial_ratio(short[:1000], long_[:6000]) if len(short) > 80 else 90
        if desc_score >= 80:
            return DedupDecision("fuzzy_duplicate", c.id, round((title_score + desc_score) / 2, 1))
    return DedupDecision("new")
