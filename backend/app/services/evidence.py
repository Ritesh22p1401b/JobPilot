"""Requirement ↔ candidate evidence mapping.

Produces, for every JD requirement, a status with the concrete resume evidence behind it.
The engine is deterministic; an LLM may only *explain* these results, never upgrade them.
"""

from __future__ import annotations

import re
from functools import lru_cache
from typing import Literal

from pydantic import BaseModel, Field
from rapidfuzz import fuzz

from app.schemas.jd import SKILL_CATEGORIES, JDAnalysis, Requirement
from app.schemas.preferences import Preferences
from app.schemas.profile import CandidateProfileData
from app.services.embeddings import most_similar, similarity
from app.services.skill_normalizer import extract_skills, is_known_skill, relation, unique_skills

EvidenceStatus = Literal[
    "SUPPORTED", "PARTIALLY_SUPPORTED", "SEMANTIC_MATCH", "RELATED_BUT_NOT_MATCH", "MISSING", "UNKNOWN", "CONFLICT"
]
MatchType = Literal["EXACT", "SEMANTIC", "RELATED", "MISSING", "UNKNOWN"]
Confidence = Literal["HIGH", "MEDIUM", "LOW"]
DEGREE_ORDER = ["high_school", "diploma", "associate", "bachelor", "master", "doctorate"]
STRONG_SECTIONS = {"experience", "projects"}


class EvidenceItem(BaseModel):
    section: str
    source_id: str | None = None
    text: str


class RequirementEvidence(BaseModel):
    requirement: str
    category: str
    tier: str
    importance: float
    source_span: str = ""
    skill: str | None = None
    status: EvidenceStatus
    match_type: MatchType
    matched: bool
    confidence: Confidence
    evidence: list[EvidenceItem] = Field(default_factory=list)
    evidence_skill: str | None = None
    note: str = ""


class EvidenceMatrix(BaseModel):
    items: list[RequirementEvidence]

    def by_category(self, *cats: str) -> list[RequirementEvidence]:
        return [i for i in self.items if i.category in cats]


@lru_cache(maxsize=8192)
def _skills_of(text: str) -> frozenset[str]:
    """Skills mentioned in a piece of resume text (memoised: bullets are checked against many requirements)."""
    return frozenset(unique_skills(extract_skills(text)))


def _skill_evidence(profile: CandidateProfileData, skill: str, limit: int = 3) -> list[EvidenceItem]:
    out: list[EvidenceItem] = []
    for exp in profile.experience:
        for b in exp.bullets:
            if skill in _skills_of(b):
                label = " at ".join(x for x in (exp.title, exp.company) if x)
                out.append(EvidenceItem(section="experience", source_id=exp.id, text=f"{label}: {b}" if label else b))
        if not exp.bullets and skill in exp.skills:
            out.append(EvidenceItem(section="experience", source_id=exp.id, text=exp.raw_header or exp.title or ""))
    for proj in profile.projects:
        texts = [proj.name + (f" ({proj.description})" if proj.description else ""), *proj.bullets]
        for t in texts:
            if skill in _skills_of(t):
                out.append(EvidenceItem(section="projects", source_id=proj.id, text=f"{proj.name}: {t}" if t != texts[0] else t))
                break
    for cert in profile.certifications:
        if skill in _skills_of(cert.name):
            out.append(EvidenceItem(section="certifications", source_id=cert.id, text=cert.name))
    entry = profile.skill(skill)
    if entry and "skills" in entry.sections:
        out.append(EvidenceItem(section="skills", text=f"Listed in Skills: {skill}"))
    if entry and "summary" in entry.sections and profile.summary:
        out.append(EvidenceItem(section="summary", text=profile.summary[:200]))
    return out[: limit + 2]


def _match_skill(req: Requirement, profile: CandidateProfileData) -> RequirementEvidence:
    base = dict(requirement=req.requirement, category=req.category, tier=req.tier, importance=req.importance,
                source_span=req.source_span, skill=req.skill)
    skill = req.skill or req.requirement
    cand_skills = profile.skill_names()

    if not is_known_skill(skill):
        # Free-text skill (e.g. from LLM extraction). Exact textual presence, then embedding similarity.
        known_text = " ".join([s for s in cand_skills] + [b for e in profile.experience for b in e.bullets]
                              + [b for p in profile.projects for b in p.bullets])
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(skill)}(?![A-Za-z0-9])", known_text, re.I):
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="MEDIUM",
                                       evidence=[EvidenceItem(section="resume", text=f"'{skill}' appears in the resume")])
        best = max(((s, similarity(skill, s)) for s in cand_skills), key=lambda x: x[1], default=(None, 0.0))
        if best[0] and best[1] >= 0.9:
            return RequirementEvidence(**base, status="SEMANTIC_MATCH", match_type="SEMANTIC", matched=True,
                                       confidence="LOW", evidence_skill=best[0],
                                       note=f"Semantically similar to '{best[0]}' (similarity {best[1]:.2f}).")
        return RequirementEvidence(**base, status="MISSING", match_type="MISSING", matched=False, confidence="MEDIUM",
                                   note="No evidence found in the resume.")

    match_type, evidence_skill = relation(skill, cand_skills)
    if match_type == "EXACT":
        ev = _skill_evidence(profile, skill)
        strong = any(e.section in STRONG_SECTIONS for e in ev)
        if strong:
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="HIGH",
                                       evidence=ev, evidence_skill=skill)
        return RequirementEvidence(**base, status="PARTIALLY_SUPPORTED", match_type="EXACT", matched=True,
                                   confidence="MEDIUM", evidence=ev, evidence_skill=skill,
                                   note="Listed, but not demonstrated in experience or project bullets.")
    if match_type == "SEMANTIC":
        ev = _skill_evidence(profile, evidence_skill or "")
        return RequirementEvidence(**base, status="SEMANTIC_MATCH", match_type="SEMANTIC", matched=True,
                                   confidence="MEDIUM", evidence=ev, evidence_skill=evidence_skill,
                                   note=f"Demonstrated through {evidence_skill}, which is a form of {skill}.")
    if match_type == "RELATED":
        return RequirementEvidence(**base, status="RELATED_BUT_NOT_MATCH", match_type="RELATED", matched=False,
                                   confidence="HIGH", evidence_skill=evidence_skill,
                                   note=f"Candidate has {evidence_skill}, which is related to but not the same as {skill}.")
    return RequirementEvidence(**base, status="MISSING", match_type="MISSING", matched=False, confidence="HIGH",
                               note="No evidence in the resume.")


def _match_experience(req: Requirement, profile: CandidateProfileData) -> RequirementEvidence:
    base = dict(requirement=req.requirement, category=req.category, tier=req.tier, importance=req.importance,
                source_span=req.source_span)
    needed = req.min_years or 0
    dated = [e for e in profile.experience if e.start_date]
    if not profile.experience or not dated:
        if needed == 0:
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="MEDIUM",
                                       note="Entry-level role.")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW",
                                   note="No dated work experience found in the resume.")
    full = profile.total_experience_months / 12
    with_interns = (profile.total_experience_months + profile.internship_months) / 12
    ev = [EvidenceItem(section="experience", source_id=e.id,
                       text=f"{e.title or ''} {('at ' + e.company) if e.company else ''} ({e.start_date} – {e.end_date or 'present'})".strip())
          for e in dated[:4]]
    detail = f"{full:.1f} years full-time" + (f" + {profile.internship_months / 12:.1f} years internships" if profile.internship_months else "")
    if full >= needed:
        return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="HIGH",
                                   evidence=ev, note=f"{detail}; requirement is {needed:g}+ years.")
    if with_interns >= needed or full >= needed * 0.5:
        return RequirementEvidence(**base, status="PARTIALLY_SUPPORTED", match_type="EXACT", matched=False,
                                   confidence="MEDIUM", evidence=ev, note=f"{detail}; requirement is {needed:g}+ years.")
    return RequirementEvidence(**base, status="MISSING", match_type="MISSING", matched=False, confidence="HIGH",
                               evidence=ev, note=f"{detail}; requirement is {needed:g}+ years.")


def _match_education(req: Requirement, profile: CandidateProfileData) -> RequirementEvidence:
    base = dict(requirement=req.requirement, category=req.category, tier=req.tier, importance=req.importance,
                source_span=req.source_span)
    highest = profile.highest_degree_level()
    if not profile.education or highest is None:
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW",
                                   note="No degree found in the resume.")
    needed = req.degree_level or "bachelor"
    ev = [EvidenceItem(section="education", source_id=e.id, text=" – ".join(x for x in (e.degree, e.field, e.institution) if x))
          for e in profile.education if e.degree]
    if DEGREE_ORDER.index(highest) >= DEGREE_ORDER.index(needed):
        return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="HIGH", evidence=ev)
    return RequirementEvidence(**base, status="MISSING", match_type="MISSING", matched=False, confidence="HIGH", evidence=ev,
                               note=f"Highest degree found: {highest}; requirement: {needed}.")


def _match_generic(req: Requirement, profile: CandidateProfileData, prefs: Preferences | None) -> RequirementEvidence:
    base = dict(requirement=req.requirement, category=req.category, tier=req.tier, importance=req.importance,
                source_span=req.source_span)
    cat = req.category
    if cat == "CERTIFICATION":
        best = max(((c, fuzz.token_set_ratio(req.requirement, c.name)) for c in profile.certifications),
                   key=lambda x: x[1], default=(None, 0))
        if best[0] and best[1] >= 80:
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="HIGH",
                                       evidence=[EvidenceItem(section="certifications", source_id=best[0].id, text=best[0].name)])
        return RequirementEvidence(**base, status="MISSING", match_type="MISSING", matched=False, confidence="MEDIUM")
    if cat == "LANGUAGE":
        if any(req.requirement.lower() in lang.lower() for lang in profile.languages):
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="HIGH")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW",
                                   note="Language proficiency not stated in the resume.")
    if cat == "SOFT_SKILL":
        if req.requirement.lower() in (s.lower() for s in profile.soft_skills):
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="MEDIUM")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW",
                                   note="Soft skills are rarely stated explicitly; not counted as missing.")
    if cat == "DOMAIN":
        if req.requirement in profile.domains:
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="MEDIUM")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW")
    if cat == "WORK_AUTHORIZATION":
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW",
                                   note="Work authorization must be confirmed by the candidate; never inferred.")
    if cat == "WORK_MODE":
        if prefs and prefs.work_modes:
            ok = req.requirement in prefs.work_modes
            return RequirementEvidence(**base, status="SUPPORTED" if ok else "CONFLICT", match_type="EXACT" if ok else "MISSING",
                                       matched=ok, confidence="HIGH", note="Compared with your work-mode preferences.")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW")
    if cat == "EMPLOYMENT_TYPE":
        if prefs and prefs.employment_types:
            ok = req.requirement in prefs.employment_types
            return RequirementEvidence(**base, status="SUPPORTED" if ok else "CONFLICT", match_type="EXACT" if ok else "MISSING",
                                       matched=ok, confidence="HIGH", note="Compared with your employment-type preferences.")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW")
    if cat == "JOB_TITLE":
        titles = profile.job_titles + profile.target_roles + (prefs.target_titles if prefs else [])
        title_sim = max((fuzz.token_set_ratio(req.requirement.lower(), t.lower()) for t in titles), default=0.0)
        if title_sim >= 85:
            return RequirementEvidence(**base, status="SUPPORTED", match_type="EXACT", matched=True, confidence="HIGH")
        if title_sim >= 60:
            return RequirementEvidence(**base, status="PARTIALLY_SUPPORTED", match_type="SEMANTIC", matched=False, confidence="MEDIUM")
        return RequirementEvidence(**base, status="MISSING", match_type="MISSING", matched=False, confidence="MEDIUM")
    if cat == "RESPONSIBILITY":
        skills = unique_skills(extract_skills(req.requirement))
        bullets = [(e.id, "experience", b) for e in profile.experience for b in e.bullets] + [
            (p.id, "projects", b) for p in profile.projects for b in p.bullets]
        hit = most_similar(req.requirement, [b for _, _, b in bullets])
        top = (*bullets[hit[0]], hit[1]) if hit else None
        covered = [s for s in skills if relation(s, profile.skill_names())[0] in ("EXACT", "SEMANTIC")]
        ev = [EvidenceItem(section=top[1], source_id=top[0], text=top[2])] if top else []
        if skills and len(covered) >= max(1, len(skills) / 2):
            return RequirementEvidence(**base, status="PARTIALLY_SUPPORTED", match_type="SEMANTIC", matched=True,
                                       confidence="MEDIUM", evidence=ev,
                                       note=f"Related experience with {', '.join(covered)}.")
        return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW", evidence=ev)
    return RequirementEvidence(**base, status="UNKNOWN", match_type="UNKNOWN", matched=False, confidence="LOW")


def build_evidence_matrix(analysis: JDAnalysis, profile: CandidateProfileData, prefs: Preferences | None = None) -> EvidenceMatrix:
    items: list[RequirementEvidence] = []
    for req in analysis.requirements:
        if req.category in SKILL_CATEGORIES:
            items.append(_match_skill(req, profile))
        elif req.category in ("REQUIRED_EXPERIENCE", "PREFERRED_EXPERIENCE"):
            items.append(_match_experience(req, profile))
        elif req.category == "EDUCATION":
            items.append(_match_education(req, profile))
        else:
            items.append(_match_generic(req, profile, prefs))
    order = {"REQUIRED_SKILL": 0, "REQUIRED_EXPERIENCE": 1, "EDUCATION": 2, "PREFERRED_SKILL": 3,
             "PREFERRED_EXPERIENCE": 4, "NICE_TO_HAVE": 5, "CERTIFICATION": 6}
    items.sort(key=lambda i: (order.get(i.category, 10), -i.importance))
    return EvidenceMatrix(items=items)
