"""JD Analysis Agent: deterministic extraction, optionally enriched by the LLM under strict span verification."""

from __future__ import annotations

import logging
import re

from pydantic import BaseModel, Field
from rapidfuzz import fuzz
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.models import Job
from app.schemas.jd import JDAnalysis, Requirement
from app.services.jd_parser import TIER_IMPORTANCE
from app.services.llm import LLMOutputError, LLMUnavailable, get_llm
from app.services.prompts import JD_REQUIREMENT_EXTRACTOR
from app.services.repository import ensure_job_analysis
from app.services.skill_normalizer import normalize_skill

logger = logging.getLogger(__name__)
ALLOWED = {"REQUIRED_SKILL", "PREFERRED_SKILL", "NICE_TO_HAVE", "REQUIRED_EXPERIENCE", "PREFERRED_EXPERIENCE",
           "EDUCATION", "CERTIFICATION", "LANGUAGE", "WORK_AUTHORIZATION", "OTHER"}
_NICE = re.compile(r"nice[\s-]to[\s-]have|a plus|bonus|good to have", re.I)
_PREF = re.compile(r"preferred|preferably|ideally|desired", re.I)


class _LLMReq(BaseModel):
    requirement: str
    category: str
    source_span: str = ""


class _LLMReqs(BaseModel):
    requirements: list[_LLMReq] = Field(default_factory=list)


def _span_in_text(span: str, text: str) -> bool:
    s = re.sub(r"\s+", " ", span).strip().lower()
    t = re.sub(r"\s+", " ", text).lower()
    if len(s) < 3:
        return False
    return s in t or fuzz.partial_ratio(s, t) >= 92


def validate_llm_requirements(items: list[_LLMReq], analysis: JDAnalysis, description: str) -> list[Requirement]:
    """Keep only LLM requirements whose span is verbatim in the JD and whose term appears in that span."""
    existing = {(r.skill or r.requirement).lower() for r in analysis.requirements}
    accepted: list[Requirement] = []
    for it in items:
        cat = it.category.upper().strip()
        if cat not in ALLOWED or not it.requirement.strip() or not _span_in_text(it.source_span, description):
            continue
        term = it.requirement.strip()
        canonical = normalize_skill(term)
        if term.lower() not in it.source_span.lower() and not (canonical and canonical.lower() in it.source_span.lower()) \
                and fuzz.partial_ratio(term.lower(), it.source_span.lower()) < 90:
            continue
        key = (canonical or term).lower()
        if key in existing:
            continue
        # Inline cues in the verified span override the LLM's tier when they disagree.
        if cat.endswith("_SKILL") or cat == "NICE_TO_HAVE":
            if _NICE.search(it.source_span):
                cat = "NICE_TO_HAVE"
            elif _PREF.search(it.source_span) and cat == "REQUIRED_SKILL":
                cat = "PREFERRED_SKILL"
        tier = {"REQUIRED_SKILL": "REQUIRED", "PREFERRED_SKILL": "PREFERRED", "NICE_TO_HAVE": "NICE_TO_HAVE",
                "REQUIRED_EXPERIENCE": "REQUIRED", "PREFERRED_EXPERIENCE": "PREFERRED"}.get(cat, "UNSPECIFIED")
        existing.add(key)
        accepted.append(Requirement(
            requirement=canonical or term[:120], category=cat, tier=tier, importance=TIER_IMPORTANCE.get(tier, 0.8),  # type: ignore[arg-type]
            source_span=it.source_span[:400], skill=(canonical or term[:60]) if cat in ("REQUIRED_SKILL", "PREFERRED_SKILL", "NICE_TO_HAVE") else None,
            extracted_by="llm", evidence_required=cat not in ("WORK_AUTHORIZATION", "OTHER"),
        ))
    return accepted


async def enrich_with_llm(analysis: JDAnalysis, title: str, description: str) -> JDAnalysis:
    llm = get_llm()
    if not description.strip() or not await llm.is_enabled():
        return analysis
    try:
        parsed, _meta = await llm.structured(JD_REQUIREMENT_EXTRACTOR, _LLMReqs, title=title, description=description[:6000])
    except (LLMUnavailable, LLMOutputError) as exc:
        logger.warning("JD LLM enrichment skipped: %s", exc)
        return analysis
    extra = validate_llm_requirements(parsed.requirements, analysis, description)
    enriched = analysis.model_copy(deep=True)
    enriched.requirements.extend(extra)
    for r in extra:
        if r.skill:
            {"REQUIRED_SKILL": enriched.required_skills, "PREFERRED_SKILL": enriched.preferred_skills,
             "NICE_TO_HAVE": enriched.nice_to_have_skills}[r.category].append(r.skill)
            enriched.keywords.append(r.skill)
    enriched.analyzer_version = analysis.analyzer_version + "+llm"
    return enriched


class JDAnalysisOutput(BaseModel):
    job_id: str
    requirements: int
    llm_added: int
    analyzer_version: str


class JDAnalysisAgent(BaseAgent):
    name = "jd_analysis_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> JDAnalysisOutput:
        job = await db.get(Job, payload["job_id"])
        if job is None:
            raise ValueError("Job not found")
        analysis = await ensure_job_analysis(db, job, llm_enrich=bool(payload.get("llm", True)))
        await db.commit()
        return JDAnalysisOutput(job_id=job.id, requirements=len(analysis.requirements),
                                llm_added=sum(1 for r in analysis.requirements if r.extracted_by == "llm"),
                                analyzer_version=analysis.analyzer_version)
