"""Job Analyst Agent: LLM explanations for the top shortlisted matches, master-resume compatibility,
notifications, and (only if explicitly enabled and authorized) auto-apply hand-off.

Cost control: the LLM runs only for the top-N matches above the threshold (LLM_MAX_JOBS_PER_RUN).
"""

from __future__ import annotations

import json
import logging

from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.agents.resume_agents.resume_test_agent import run_version_tests
from app.application_providers.registry import get_application_provider
from app.config import get_settings
from app.database import utcnow
from app.models import Application, CandidateProfile, Job, JobMatch
from app.services.evidence import build_evidence_matrix
from app.services.llm import LLMOutputError, LLMUnavailable, get_llm
from app.services.prompts import JOB_MATCH_EXPLAINER
from app.services.repository import ensure_job_analysis, get_prefs, master_version, notify, profile_data

logger = logging.getLogger(__name__)


class _Explanation(BaseModel):
    match_summary: str
    recommendation_reason: str = ""
    experience_alignment: str = ""
    application_strategy: list[str] = Field(default_factory=list)


class AnalystOutput(BaseModel):
    analysed: int
    llm_explained: int
    compatibility_scored: int
    auto_apply_queued: int
    llm_error: str | None = None


async def explain_match(db: AsyncSession, match: JobMatch, job: Job, candidate: CandidateProfile, ctx: AgentContext | None) -> bool:
    llm = get_llm()
    if not await llm.is_enabled():
        return False
    analysis = await ensure_job_analysis(db, job)
    matrix = build_evidence_matrix(analysis, profile_data(candidate), await get_prefs(db, candidate.user_id))
    compact_matrix = [{"requirement": i.requirement, "category": i.category, "status": i.status,
                       "evidence": i.evidence[0].text[:160] if i.evidence else None}
                      for i in matrix.items if i.category not in ("RESPONSIBILITY", "DOMAIN", "JOB_TITLE")][:30]
    match_json = {"overall_score": match.overall_score, "components": match.breakdown_json,
                  "matched_skills": match.matched_skills_json, "missing": match.missing_skills_json,
                  "hard_filter_passed": match.hard_filter_passed, "hard_filter_reasons": match.hard_filter_reasons_json}
    exp, meta = await llm.structured(JOB_MATCH_EXPLAINER, _Explanation, title=job.title, company=job.company,
                                     match_json=json.dumps(match_json, default=str), matrix_json=json.dumps(compact_matrix))
    if ctx:
        ctx.record_llm(meta)
    strategy = "\n".join(f"• {s}" for s in exp.application_strategy[:4])
    match.explanation = "\n\n".join(x for x in (exp.match_summary, exp.recommendation_reason, exp.experience_alignment, strategy) if x)
    match.explanation_source = "llm"
    return True


class JobAnalystAgent(BaseAgent):
    name = "job_analyst_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> AnalystOutput:
        settings = get_settings()
        candidate = await db.get(CandidateProfile, payload["candidate_id"])
        if candidate is None:
            raise ValueError("Candidate not found")
        prefs = await get_prefs(db, candidate.user_id)
        matches = list((await db.execute(select(JobMatch).where(JobMatch.id.in_(payload.get("match_ids", [])))
                                         .order_by(JobMatch.overall_score.desc()))).scalars())
        explained = scored = queued = 0
        llm_error = None
        mv = await master_version(db, candidate.id)
        master = profile_data(candidate)
        for i, m in enumerate(matches):
            job = await db.get(Job, m.job_id)
            if job is None:
                continue
            if i < settings.llm_max_jobs_per_run and llm_error is None:
                try:
                    explained += int(await explain_match(db, m, job, candidate, ctx))
                except (LLMUnavailable, LLMOutputError) as exc:
                    llm_error = str(exc)[:300]
            if mv is not None and i < 25:
                try:
                    report = await run_version_tests(db, mv, master, job, prefs, persist=False)
                    m.resume_compatibility = report.quality_index
                    scored += 1
                except Exception as exc:  # noqa: BLE001 - compatibility is best-effort here
                    logger.warning("compatibility scoring failed: %s", exc)
            m.notified = True
        await db.commit()

        if matches:
            top = [m for m in matches if m.overall_score >= 85]
            strong = [m for m in matches if (m.resume_compatibility or 0) >= 90 and not (m.missing_skills_json or {}).get("required")]
            body = f"{len(matches)} new jobs matched your profile (score ≥ {prefs.minimum_match_score:.0f})."
            if top:
                body += f" {len(top)} have a match score above 85."
            if strong:
                body += f" {len(strong)} also have resume compatibility above 90 with no missing required skills."
            if prefs.notify_in_app:
                await notify(db, candidate.user_id, "new_matches", "New job matches", body,
                             {"match_ids": [m.id for m in matches][:50]})
            if prefs.notify_email:
                from app.services.notifications import send_email

                await send_email(candidate.email, "JobPilot: new job matches", body)

        # Auto-apply: opt-in, AUTHORIZED mode, threshold, authorized provider, daily limit.
        if prefs.auto_apply and prefs.application_mode == "AUTHORIZED_AUTO_APPLY":
            start_of_day = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
            today = (await db.execute(select(func.count()).select_from(Application).where(
                Application.candidate_id == candidate.id, Application.applied_at >= start_of_day))).scalar() or 0
            budget = max(0, prefs.daily_application_limit - today)
            for m in matches:
                if budget <= 0:
                    break
                job = await db.get(Job, m.job_id)
                if job is None or not m.hard_filter_passed or m.overall_score < prefs.auto_apply_minimum_score:
                    continue
                provider = get_application_provider(job.source)
                if provider is None or not provider.is_authorized(job.external_id):
                    continue
                ctx.emit("application.prepare_requested", {"candidate_id": candidate.id, "job_id": job.id, "auto": True},
                         dedup_key=f"apply:{candidate.id}:{job.id}")
                queued += 1
                budget -= 1
        await db.commit()
        return AnalystOutput(analysed=len(matches), llm_explained=explained, compatibility_scored=scored,
                             auto_apply_queued=queued, llm_error=llm_error)
