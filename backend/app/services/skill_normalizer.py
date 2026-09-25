"""Deterministic skill normalisation and extraction built on the controlled ontology."""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from app.services.skill_ontology import (
    CASE_SENSITIVE_ALIASES,
    LIST_ONLY_ALIASES,
    SKILLS,
    SOFT_SKILLS,
)

# Words that are also ordinary English; in prose they only count when capitalised.
_CAPITALISED_IN_PROSE = {
    "react", "swift", "rust", "excel", "express", "spring", "flask", "dart", "ruby", "jest", "helm", "spark",
    "airflow", "snowflake", "kafka", "tableau", "angular", "agile", "scrum", "kanban", "git", "linux", "go",
    "docker", "terraform", "ansible", "redis", "postman", "streamlit", "gradio", "keras", "jax", "yolo",
    "pandas", "polars", "vercel", "firebase", "supabase", "jira", "matlab", "elk", "ci/cd", "security", "shell",
    "statistics", "transformers", "embeddings", "rag", "serverless", "microservices", "monitoring",
    "observability", "containerization", "oracle", "cloud", "analytics",
}
_CASE_SENSITIVE_LIST_ONLY = {"Go", "R", "C", "CV", "TS", "DL", "RL"}

_BOUNDARY_BEFORE = r"(?<![A-Za-z0-9_+#.\-])"
_BOUNDARY_AFTER = r"(?![A-Za-z0-9_+#]|\.[A-Za-z0-9])"


@dataclass(frozen=True)
class SkillMention:
    skill: str
    text: str
    start: int
    end: int


def _norm_key(term: str) -> str:
    term = term.strip().lower()
    term = re.sub(r"\s+", " ", term)
    return term.strip(" .,:;()[]{}\"'")


@lru_cache
def _alias_index() -> dict[str, str]:
    index: dict[str, str] = {}
    for canonical, (_cat, aliases, _implies, _related) in SKILLS.items():
        index[_norm_key(canonical)] = canonical
        for alias in aliases:
            index.setdefault(_norm_key(alias), canonical)
    return index


@lru_cache
def _insensitive_regex() -> re.Pattern[str]:
    keys = sorted(_alias_index().keys(), key=len, reverse=True)
    alternation = "|".join(re.escape(k).replace(r"\ ", r"[\s\-]+") for k in keys)
    return re.compile(f"{_BOUNDARY_BEFORE}({alternation}){_BOUNDARY_AFTER}", re.IGNORECASE)


@lru_cache
def _sensitive_regex() -> re.Pattern[str]:
    keys = sorted(CASE_SENSITIVE_ALIASES.keys(), key=len, reverse=True)
    alternation = "|".join(re.escape(k) for k in keys)
    return re.compile(f"{_BOUNDARY_BEFORE}({alternation}){_BOUNDARY_AFTER}")


def normalize_skill(term: str) -> str | None:
    """Return the canonical skill name for a term, or None if unknown."""
    if not term:
        return None
    stripped = term.strip()
    if stripped in CASE_SENSITIVE_ALIASES:
        return CASE_SENSITIVE_ALIASES[stripped]
    key = _norm_key(term)
    if key in _alias_index():
        return _alias_index()[key]
    key2 = key.replace("-", " ")
    return _alias_index().get(key2)


def canonical_or_clean(term: str) -> str:
    """Canonical name if known, otherwise a tidied version of the original term."""
    return normalize_skill(term) or re.sub(r"\s+", " ", term).strip(" .,;:")


def skill_category(skill: str) -> str:
    spec = SKILLS.get(skill)
    return spec[0] if spec else "other"


def is_known_skill(skill: str) -> bool:
    return skill in SKILLS


def looks_like_list(line: str) -> bool:
    """Heuristic: comma/pipe separated list of short items (typical skills line)."""
    body = line.split(":", 1)[1] if ":" in line[:40] else line
    parts = [p.strip() for p in re.split(r"[,|;•·/]", body) if p.strip()]
    if len(parts) < 3:
        return False
    avg_words = sum(len(p.split()) for p in parts) / len(parts)
    return avg_words <= 3.2


def extract_skills(text: str, list_context: bool | None = None) -> list[SkillMention]:
    """Find ontology skills in text. Returns mentions in order of appearance (deduplicated by span)."""
    if not text:
        return []
    mentions: list[SkillMention] = []
    for line_match in re.finditer(r"[^\n]+", text):
        line = line_match.group(0)
        offset = line_match.start()
        in_list = looks_like_list(line) if list_context is None else list_context
        taken: list[tuple[int, int]] = []
        for m in _insensitive_regex().finditer(line):
            raw = m.group(1)
            key = _norm_key(raw)
            key = re.sub(r"[\s\-]+", " ", key) if key not in _alias_index() else key
            canonical = _alias_index().get(key) or _alias_index().get(_norm_key(raw).replace("-", " "))
            if canonical is None:
                continue
            if key in LIST_ONLY_ALIASES and not in_list:
                continue
            if not in_list and key in _CAPITALISED_IN_PROSE and not raw[:1].isupper():
                continue
            taken.append((m.start(1), m.end(1)))
            mentions.append(SkillMention(canonical, raw, offset + m.start(1), offset + m.end(1)))
        for m in _sensitive_regex().finditer(line):
            raw = m.group(1)
            if any(s <= m.start(1) < e for s, e in taken):
                continue
            if raw in _CASE_SENSITIVE_LIST_ONLY and not in_list:
                continue
            if raw == "R" and line[m.end(1): m.end(1) + 1] == "&":
                continue
            mentions.append(SkillMention(CASE_SENSITIVE_ALIASES[raw], raw, offset + m.start(1), offset + m.end(1)))
    mentions.sort(key=lambda x: x.start)
    return mentions


def unique_skills(mentions: list[SkillMention]) -> list[str]:
    seen: dict[str, None] = {}
    for mention in mentions:
        seen.setdefault(mention.skill, None)
    return list(seen)


@lru_cache
def implied_by(skill: str) -> frozenset[str]:
    """Transitive closure of skills that `skill` demonstrates (excluding itself)."""
    out: set[str] = set()
    stack = list(SKILLS.get(skill, ("", [], [], []))[2])
    while stack:
        cur = stack.pop()
        if cur in out or cur == skill:
            continue
        out.add(cur)
        stack.extend(SKILLS.get(cur, ("", [], [], []))[2])
    return frozenset(out)


@lru_cache
def related_to(skill: str) -> frozenset[str]:
    rel = set(SKILLS.get(skill, ("", [], [], []))[3])
    for other, (_c, _a, _i, related) in SKILLS.items():
        if skill in related:
            rel.add(other)
    rel.discard(skill)
    return frozenset(rel)


def relation(required: str, candidate_skills: set[str]) -> tuple[str, str | None]:
    """Classify how a candidate's skills satisfy a required skill.

    Returns (match_type, evidence_skill):
      EXACT    – same canonical skill (aliases already normalised, e.g. Postgres == PostgreSQL)
      SEMANTIC – candidate has a narrower skill that genuinely implies the requirement (PyTorch -> Deep Learning)
      RELATED  – only an adjacent technology is present (Docker vs Kubernetes). NOT a match.
      MISSING  – no evidence.
    """
    req = normalize_skill(required) or required
    if req in candidate_skills:
        return "EXACT", req
    for cand in sorted(candidate_skills):
        if req in implied_by(cand):
            return "SEMANTIC", cand
    related = related_to(req)
    for cand in sorted(candidate_skills):
        if cand in related:
            return "RELATED", cand
    return "MISSING", None


def extract_soft_skills(text: str) -> list[str]:
    lowered = text.lower()
    return [s for s in SOFT_SKILLS if re.search(rf"\b{re.escape(s)}\b", lowered)]
