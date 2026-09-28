"""Truthful, job-specific resume tailoring.

Allowed: reorder sections/skills/bullets/projects, rewrite existing facts (verified), change the summary
(verified), choose a template. Forbidden: adding anything not in the master profile. The master content
is never mutated; a new ResumeContent is returned.
"""

from __future__ import annotations

import logging

from pydantic import BaseModel, Field

from app.schemas.jd import SKILL_CATEGORIES, JDAnalysis
from app.schemas.profile import CandidateProfileData
from app.schemas.resume import ResumeBullet, ResumeContent
from app.services.claim_verifier import profile_source_text, verify_generated_text, verify_rewrite
from app.services.embeddings import similarity
from app.services.evidence import EvidenceMatrix
from app.services.llm import LLMClient, LLMOutputError, LLMUnavailable
from app.services.prompts import RESUME_BULLET_REWRITER, RESUME_SUMMARY_WRITER
from app.services.resume_document import TEMPLATES
from app.services.skill_normalizer import extract_skills, implied_by, unique_skills

logger = logging.getLogger(__name__)
MAX_LLM_BULLETS = 8


class _Rewrite(BaseModel):
    index: int
    text: str


class _Rewrites(BaseModel):
    rewrites: list[_Rewrite] = Field(default_factory=list)


class _Summary(BaseModel):
    summary: str


class RejectedRewrite(BaseModel):
    source_id: str | None
    original: str
    proposed: str
    reasons: list[str]


class TailorResult(BaseModel):
    content: ResumeContent
    template: str
    llm_used: bool = False
    llm_error: str | None = None
    prompt_versions: list[str] = Field(default_factory=list)
    llm_model: str | None = None
    rewrites_attempted: int = 0
    rewrites_accepted: int = 0
    rejected_rewrites: list[RejectedRewrite] = Field(default_factory=list)
    summary_generated: bool = False
    notes: list[str] = Field(default_factory=list)


def relevance_weights(analysis: JDAnalysis, matrix: EvidenceMatrix) -> dict[str, float]:
    """JD skills the candidate genuinely has, weighted by requirement importance."""
    weights: dict[str, float] = {}
    for it in matrix.items:
        if it.category in SKILL_CATEGORIES and it.matched and it.skill:
            weights[it.skill] = max(weights.get(it.skill, 0), it.importance)
            if it.evidence_skill and it.evidence_skill != it.skill:
                weights[it.evidence_skill] = max(weights.get(it.evidence_skill, 0), it.importance * 0.8)
    return weights


def bullet_relevance(text: str, weights: dict[str, float], responsibilities: list[str]) -> float:
    skills = set(unique_skills(extract_skills(text)))
    expanded = set(skills)
    for s in skills:
        expanded |= implied_by(s)
    score = sum(w for s, w in weights.items() if s in expanded)
    if responsibilities:
        score += 0.5 * max(similarity(text, r) for r in responsibilities[:6])
    return score


def choose_template(analysis: JDAnalysis, profile: CandidateProfileData) -> str:
    title = analysis.role_title.lower()
    if profile.total_experience_months < 12 and not any(not e.is_internship for e in profile.experience):
        return "ats_entry_level"
    if any(k in title for k in ("machine learning", "ml ", "ai ", "llm", "data scientist", "nlp", "genai", "generative")) or title.startswith("ai"):
        return "ats_ai_ml"
    if "data analyst" in title or "analytics" in title:
        return "ats_data_analyst"
    if "backend" in title or "back-end" in title or "api" in title:
        return "ats_backend_engineer"
    if "engineer" in title or "developer" in title:
        return "ats_software_engineer"
    return "ats_technical"


def _fallback_summary(analysis: JDAnalysis, matrix: EvidenceMatrix, profile: CandidateProfileData) -> str | None:
    supported = [i.skill for i in matrix.items if i.category in SKILL_CATEGORIES and i.status == "SUPPORTED" and i.skill]
    if len(supported) < 2:
        return None
    lead = profile.job_titles[0] if profile.job_titles else "Engineer"
    return (f"{lead} with hands-on experience in {', '.join(supported[:5])}, "
            f"demonstrated through the work and projects below.")


async def tailor(master: CandidateProfileData, master_content: ResumeContent, analysis: JDAnalysis,
                 matrix: EvidenceMatrix, template: str | None = None, llm: LLMClient | None = None,
                 use_llm: bool = True) -> TailorResult:
    content = master_content.model_copy(deep=True)
    tpl_id = template if template in TEMPLATES else choose_template(analysis, master)
    content.template = tpl_id
    content.section_order = list(TEMPLATES[tpl_id].section_order)
    result = TailorResult(content=content, template=tpl_id)
    weights = relevance_weights(analysis, matrix)
    resp = analysis.responsibilities

    # 1. Skills: relevant categories first, relevant skills first within each category.
    def skill_key(s: str) -> float:
        expanded = {s} | set(implied_by(s))
        return -max((w for k, w in weights.items() if k in expanded), default=0.0)

    ordered = {cat: sorted(items, key=skill_key) for cat, items in content.skills.items()}
    content.skills = dict(sorted(ordered.items(), key=lambda kv: min((skill_key(s) for s in kv[1]), default=0)))

    # 2. Bullets within each experience entry (entries stay chronological) and 3. projects by relevance.
    scored: list[tuple[float, ResumeBullet]] = []
    for block in content.experience:
        rel = [(bullet_relevance(b.text, weights, resp), b) for b in block.bullets]
        block.bullets = [b for _, b in sorted(rel, key=lambda x: -x[0])]
        scored.extend(rel)
    proj_scores = []
    for proj in content.projects:
        rel = [(bullet_relevance(b.text, weights, resp), b) for b in proj.bullets]
        proj.bullets = [b for _, b in sorted(rel, key=lambda x: -x[0])]
        scored.extend(rel)
        head = bullet_relevance(f"{proj.name} {proj.description or ''}", weights, [])
        proj_scores.append((head + sum(s for s, _ in rel), proj))
    content.projects = [p for _, p in sorted(proj_scores, key=lambda x: -x[0])]

    # 4. Optional LLM rewrites of the most relevant bullets, each verified against its source bullet.
    if use_llm and llm is not None and await llm.is_enabled():
        result.llm_used = True
        candidates = [b for s, b in sorted(scored, key=lambda x: -x[0]) if s > 0][:MAX_LLM_BULLETS]
        if candidates:
            terms = ", ".join(sorted(weights, key=lambda k: -weights[k])[:12])
            listing = "\n".join(f"{i}: {b.text}" for i, b in enumerate(candidates))
            try:
                parsed, meta = await llm.structured(RESUME_BULLET_REWRITER, _Rewrites, title=analysis.role_title,
                                                    terms=terms, bullets=listing)
                result.prompt_versions.append(meta["prompt_version"])
                result.llm_model = meta.get("model")
                for rw in parsed.rewrites:
                    if not 0 <= rw.index < len(candidates):
                        continue
                    bullet = candidates[rw.index]
                    proposed = rw.text.strip().lstrip("•-* ").strip()
                    if not proposed or proposed == bullet.text:
                        continue
                    result.rewrites_attempted += 1
                    ok, reasons = verify_rewrite(bullet.original_text or bullet.text, proposed)
                    if ok:
                        bullet.text = proposed
                        result.rewrites_accepted += 1
                    else:
                        bullet.rewrite_rejected_reasons = reasons
                        result.rejected_rewrites.append(RejectedRewrite(source_id=bullet.source_id,
                                                                        original=bullet.text, proposed=proposed, reasons=reasons))
            except (LLMUnavailable, LLMOutputError) as exc:
                result.llm_error = str(exc)[:300]
                logger.warning("bullet rewrite skipped: %s", exc)

        # 5. Summary (verified); keep the original if generation fails verification.
        supported = [i.skill for i in matrix.items if i.category in SKILL_CATEGORIES and i.matched and i.skill]
        facts = {
            "name": master.contact.name, "titles_held": master.job_titles[:4], "years_experience": master.years_experience,
            "internship_months": master.internship_months, "skills_relevant_to_job": supported[:12],
            "existing_summary": master.summary, "education": [e.degree for e in master.education if e.degree][:2],
            "projects": [p.name for p in master.projects][:4],
        }
        try:
            import json

            parsed_s, meta = await llm.structured(RESUME_SUMMARY_WRITER, _Summary, title=analysis.role_title,
                                                  facts_json=json.dumps(facts))
            result.prompt_versions.append(meta["prompt_version"])
            result.llm_model = meta.get("model")
            ok, reasons = verify_generated_text(parsed_s.summary, master, profile_source_text(master))
            if ok and parsed_s.summary.strip():
                content.summary = parsed_s.summary.strip()
                content.summary_source = "generated"
                result.summary_generated = True
            else:
                result.notes.append("Generated summary rejected by claim verification: " + "; ".join(reasons))
        except (LLMUnavailable, LLMOutputError) as exc:
            result.llm_error = result.llm_error or str(exc)[:300]
    if not content.summary:
        fb = _fallback_summary(analysis, matrix, master)
        if fb:
            ok, _ = verify_generated_text(fb, master, profile_source_text(master))
            if ok:
                content.summary = fb
                content.summary_source = "generated"
                result.summary_generated = True
    if not result.llm_used:
        result.notes.append("LLM not configured: tailoring used deterministic reordering only.")
    return result
