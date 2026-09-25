"""Resume Evaluator / Evidence / Keyword agents: job-specific analyses used by Resume Lab."""

from __future__ import annotations

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.agents.resume_agents.resume_test_agent import run_version_tests
from app.models import CandidateProfile, Job, ResumeVersion
from app.services.ats.models import AssessmentReport
from app.services.evidence import EvidenceMatrix, build_evidence_matrix
from app.services.repository import ensure_job_analysis, get_prefs, persist_requirement_matches, profile_data


class EvaluationOutput(BaseModel):
    report: AssessmentReport


class ResumeEvaluatorAgent(BaseAgent):
    """Scores a resume version against a job across all quality dimensions (runs the full test suite)."""

    name = "resume_evaluator_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> EvaluationOutput:
        version = await db.get(ResumeVersion, payload["resume_version_id"])
        if version is None:
            raise ValueError("Resume version not found")
        candidate = await db.get(CandidateProfile, version.candidate_id)
        assert candidate is not None
        job = await db.get(Job, payload["job_id"]) if payload.get("job_id") else None
        prefs = await get_prefs(db, candidate.user_id)
        report = await run_version_tests(db, version, profile_data(candidate), job, prefs,
                                         payload.get("ats_profile", "generic"), persist=True)
        await db.commit()
        return EvaluationOutput(report=report)


class EvidenceOutput(BaseModel):
    job_id: str
    matrix: EvidenceMatrix


class EvidenceAgent(BaseAgent):
    """Maps each JD requirement to verified candidate evidence and persists requirement_matches."""

    name = "evidence_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> EvidenceOutput:
        candidate = await db.get(CandidateProfile, payload["candidate_id"])
        job = await db.get(Job, payload["job_id"])
        if candidate is None or job is None:
            raise ValueError("Candidate or job not found")
        analysis = await ensure_job_analysis(db, job)
        matrix = build_evidence_matrix(analysis, profile_data(candidate), await get_prefs(db, candidate.user_id))
        await persist_requirement_matches(db, job.id, candidate.id, matrix)
        await db.commit()
        return EvidenceOutput(job_id=job.id, matrix=matrix)
