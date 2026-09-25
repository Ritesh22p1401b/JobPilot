"""Job Matching Agent: deterministic scoring + embedding similarity. Idempotent per input hash."""

from __future__ import annotations

from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.database import new_id
from app.models import CandidateProfile, Job, JobMatch
from app.observability import JOBS_MATCHED
from app.services.embeddings import cosine, embed_text, embed_texts
from app.services.evidence import EvidenceMatrix, build_evidence_matrix
from app.services.matcher import (
    candidate_embedding_text,
    compute_match,
    job_embedding_text,
    match_input_hash,
    norm_title,
)
from app.services.repository import (
    ensure_job_analysis,
    get_prefs,
    job_facts,
    persist_requirement_matches_bulk,
    profile_data,
)
from app.services.vector_store import CANDIDATES, JOBS, get_vector_store


class MatchingOutput(BaseModel):
    evaluated: int
    recomputed: int
    reused: int
    passed_filters: int
    above_threshold: int
    new_high_match_ids: list[str] = Field(default_factory=list)


class MatchingAgent(BaseAgent):
    name = "matching_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> MatchingOutput:
        candidate = await db.get(CandidateProfile, payload["candidate_id"])
        if candidate is None:
            raise ValueError("Candidate not found")
        profile = profile_data(candidate)
        prefs = await get_prefs(db, candidate.user_id)
        store = get_vector_store()
        cand_vec = embed_text(candidate_embedding_text(profile, prefs))
        await store.upsert(CANDIDATES, candidate.id, cand_vec, {"user_id": candidate.user_id})

        q = select(Job).where(Job.duplicate_of_id.is_(None))
        if payload.get("job_ids"):
            q = q.where(Job.id.in_(payload["job_ids"]))
        jobs = list((await db.execute(q)).scalars())
        existing = {m.job_id: m for m in (await db.execute(
            select(JobMatch).where(JobMatch.candidate_id == candidate.id, JobMatch.job_id.in_([j.id for j in jobs]))
        )).scalars()} if jobs else {}

        # Pre-compute everything the scorer embeds in a few batched model calls.
        analyses = {job.id: await ensure_job_analysis(db, job) for job in jobs}
        bullets = [b for e in profile.experience for b in e.bullets] + [b for p in profile.projects for b in p.bullets]
        warm = bullets + [r for a in analyses.values() for r in a.responsibilities]
        warm += [norm_title(j.title) for j in jobs] + [norm_title(t) for t in (prefs.target_titles + profile.target_roles)]
        if warm:
            embed_texts([w for w in warm if w.strip()])
        job_vectors = await store.get_vectors(JOBS, [j.id for j in jobs])
        missing_vec = [j for j in jobs if j.id not in job_vectors]
        if missing_vec:
            for job, vec in zip(missing_vec, embed_texts([job_embedding_text(j.title, j.company, j.description) for j in missing_vec]),
                                strict=True):
                job_vectors[job.id] = vec
                await store.upsert(JOBS, job.id, vec, {"source": job.source, "company": job.company, "title": job.title})

        recomputed = reused = passed = above = 0
        new_high: list[str] = []
        matrices: dict[str, EvidenceMatrix] = {}
        excluded = {c.lower() for c in prefs.excluded_companies}
        for job in jobs:
            analysis = analyses[job.id]
            ih = match_input_hash(profile, prefs, job.content_hash, analysis.analyzer_version)
            m = existing.get(job.id)
            if m is not None and m.input_hash == ih:
                reused += 1
                passed += int(m.hard_filter_passed)
                above += int(m.hard_filter_passed and m.overall_score >= prefs.minimum_match_score)
                continue
            sim = cosine(cand_vec, job_vectors[job.id])
            matrix = build_evidence_matrix(analysis, profile, prefs)
            result = compute_match(job_facts(job), analysis, matrix, profile, prefs, semantic_similarity=sim)
            if job.company.lower() in excluded:
                result.hard_filter_passed = False
            was_high = m is not None and m.hard_filter_passed and m.overall_score >= prefs.minimum_match_score
            fields = dict(
                overall_score=result.overall_score, skill_score=result.skill_score, role_score=result.role_score,
                experience_score=result.experience_score, location_score=result.location_score,
                education_score=result.education_score, preference_score=result.preference_score,
                seniority_score=result.seniority_score, semantic_similarity=result.semantic_similarity,
                hard_filter_passed=result.hard_filter_passed, hard_filter_reasons_json=result.hard_filter_reasons,
                matched_skills_json=result.matched_skills,
                missing_skills_json={"required": result.missing_required_skills, "preferred": result.missing_preferred_skills,
                                     "nice_to_have": result.missing_nice_to_have_skills,
                                     "related_not_matched": result.related_not_matched,
                                     "weak_evidence": result.weak_evidence_skills},
                breakdown_json={k: v.model_dump() for k, v in result.components.items()},
                input_hash=ih,
            )
            if m is None:
                m = JobMatch(id=new_id(), job_id=job.id, candidate_id=candidate.id, explanation=result.explanation,
                             explanation_source="rules", **fields)
                db.add(m)
            else:
                for k, v in fields.items():
                    setattr(m, k, v)
                m.explanation, m.explanation_source = result.explanation, "rules"
                m.run_count += 1
            matrices[job.id] = matrix
            recomputed += 1
            JOBS_MATCHED.inc()
            if result.hard_filter_passed:
                passed += 1
                if result.overall_score >= prefs.minimum_match_score:
                    above += 1
                    if not was_high and not m.notified:
                        new_high.append(m.id)
        await persist_requirement_matches_bulk(db, candidate.id, matrices)
        await db.commit()
        if new_high:
            ctx.emit("matches.computed", {"candidate_id": candidate.id, "match_ids": new_high})
        return MatchingOutput(evaluated=len(jobs), recomputed=recomputed, reused=reused, passed_filters=passed,
                              above_threshold=above, new_high_match_ids=new_high)
