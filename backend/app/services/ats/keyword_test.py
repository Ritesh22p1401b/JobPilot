"""Keyword alignment: EXACT / SEMANTIC / RELATED / MISSING, with placement analysis and stuffing detection."""

from __future__ import annotations

import re

from app.schemas.jd import SKILL_CATEGORIES, JDAnalysis
from app.schemas.profile import CandidateProfileData
from app.services.ats.models import Issue, KeywordResult, TestResult
from app.services.ats.profiles import ATSProfile
from app.services.skill_normalizer import extract_skills, relation

EVIDENCE_SECTIONS = {"experience", "projects"}


def run_keyword_test(analysis: JDAnalysis, doc_profile: CandidateProfileData, text: str, ats: ATSProfile) -> tuple[TestResult, list[KeywordResult]]:
    rules = ats.matching_rules
    skills_in_doc = doc_profile.skill_names()
    counts: dict[str, int] = {}
    for m in extract_skills(text):
        counts[m.skill] = counts.get(m.skill, 0) + 1

    results: list[KeywordResult] = []
    total = earned = 0.0
    for req in analysis.requirements:
        if req.category not in SKILL_CATEGORIES or not req.skill:
            continue
        kind, via = relation(req.skill, skills_in_doc)
        entry = doc_profile.skill(req.skill) if kind == "EXACT" else doc_profile.skill(via) if via else None
        sections = entry.sections if entry and kind in ("EXACT", "SEMANTIC") else []
        classification = {"EXACT": "EXACT_MATCH", "SEMANTIC": "SEMANTIC_MATCH", "RELATED": "RELATED_TERM"}.get(kind, "MISSING")
        results.append(KeywordResult(keyword=req.skill, category=req.category, importance=req.importance,
                                     classification=classification, resume_present=kind in ("EXACT", "SEMANTIC"),  # type: ignore[arg-type]
                                     evidence_sections=sections, related_to=via if kind in ("SEMANTIC", "RELATED") else None,
                                     occurrences=counts.get(req.skill, 0)))
        total += req.importance
        if kind == "EXACT":
            placement = 1.0 if set(sections) & EVIDENCE_SECTIONS else 0.8
            earned += req.importance * rules.get("exact_skill_weight", 1.0) * placement
        elif kind == "SEMANTIC":
            earned += req.importance * rules.get("semantic_skill_weight", 0.7)

    issues: list[Issue] = []
    for k in results:
        if k.classification == "EXACT_MATCH" and not set(k.evidence_sections) & EVIDENCE_SECTIONS:
            issues.append(Issue(type="MISSING_EVIDENCE", severity="warning" if k.category == "REQUIRED_SKILL" else "info",
                                message=f"{k.keyword} appears in the target job but is only listed in "
                                        f"{', '.join(k.evidence_sections) or 'the resume'} without project/experience evidence."))
        if k.classification == "MISSING" and k.category == "REQUIRED_SKILL":
            issues.append(Issue(type="MISSING_KEYWORD", severity="warning",
                                message=f"Required skill '{k.keyword}' has no evidence in this resume. Do not add it unless you have it."))
        if k.classification == "RELATED_TERM":
            issues.append(Issue(type="RELATED_ONLY", severity="info",
                                message=f"'{k.keyword}' is requested; the resume shows related '{k.related_to}', which is not equivalent."))
    words = max(len(text.split()), 1)
    for skill, n in counts.items():
        if n >= 8 or (n >= 5 and n / words > 0.02):
            issues.append(Issue(type="KEYWORD_STUFFING", severity="warning",
                                message=f"'{skill}' appears {n} times; repetition without new evidence reads as keyword stuffing."))
    score = round(100 * earned / total, 1) if total else None
    status = "SKIP" if score is None else "PASS" if score >= 80 else "WARN" if score >= 50 else "FAIL"
    return TestResult(name="keyword_coverage", status=status, score=score,
                      details={"exact": sum(1 for k in results if k.classification == "EXACT_MATCH"),
                               "semantic": sum(1 for k in results if k.classification == "SEMANTIC_MATCH"),
                               "related": sum(1 for k in results if k.classification == "RELATED_TERM"),
                               "missing": sum(1 for k in results if k.classification == "MISSING")},
                      issues=issues), results


def detect_stuffing(text: str) -> bool:
    return bool(re.search(r"(\b\w+\b)(?:[,\s]+\1\b){3,}", text, re.I))
