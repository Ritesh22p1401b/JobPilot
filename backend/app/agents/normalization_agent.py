"""Job Normalization + Deduplication Agent.

RawJob -> NormalizedJob -> jobs table. Primary key (source, external_id); fingerprint fallback;
fuzzy matching as a secondary mechanism. Unchanged content (same hash) is reused (idempotent).
Duplicates are stored with `duplicate_of_id` so every source URL is preserved.
"""

from __future__ import annotations

import asyncio

from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.database import utcnow
from app.models import Job, JobSource
from app.observability import JOBS_DEDUPLICATED
from app.schemas.job import RawJob
from app.services.deduplicator import SOURCE_PRIORITY, ExistingJob, decide
from app.services.embeddings import embed_texts
from app.services.matcher import job_embedding_text
from app.services.normalizer import normalize_job
from app.services.repository import ensure_job_analysis
from app.services.vector_store import JOBS, get_vector_store


class NormalizationOutput(BaseModel):
    received: int
    created: int
    updated: int
    unchanged: int
    duplicates: int
    invalid: int
    job_ids: list[str]


class NormalizationAgent(BaseAgent):
    name = "normalization_agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> NormalizationOutput:
        sources = {s.name: s.id for s in (await db.execute(select(JobSource))).scalars()}
        created = updated = unchanged = duplicates = invalid = 0
        touched: list[str] = []
        to_embed: list[Job] = []
        store = get_vector_store()
        for raw_dict in payload.get("raw_jobs", []):
            try:
                raw = RawJob.model_validate(raw_dict)
                nj = normalize_job(raw)
            except Exception:  # noqa: BLE001 - malformed provider record
                invalid += 1
                continue
            if not nj.title or not nj.url:
                invalid += 1
                continue
            candidates_q = select(Job).where(or_(
                (Job.source == nj.source) & (Job.external_id == nj.external_id),
                Job.fingerprint == nj.fingerprint,
                (func.lower(Job.company) == nj.company.lower()) & (Job.source != nj.source),
            )).limit(200)
            existing_rows = list((await db.execute(candidates_q)).scalars())
            decision = decide(nj, [ExistingJob(j.id, j.source, j.external_id, j.company, j.title, j.location, j.fingerprint,
                                               j.description) for j in existing_rows])
            now = utcnow()
            if decision.kind == "same_record":
                job = next(j for j in existing_rows if j.id == decision.existing_id)
                job.last_seen_at = now
                if job.content_hash == nj.content_hash:
                    unchanged += 1
                    if job.duplicate_of_id is None:
                        touched.append(job.id)
                    continue
                for field in ("company", "title", "location", "remote", "work_mode", "employment_type", "salary_min",
                              "salary_max", "currency", "description", "description_truncated", "application_url",
                              "content_hash", "fingerprint"):
                    setattr(job, field, getattr(nj, field))
                job.source_url = nj.url
                job.raw_json = nj.raw
                updated += 1
            else:
                job = Job(external_id=nj.external_id, source=nj.source, source_id=sources.get(nj.source), company=nj.company,
                          title=nj.title, location=nj.location, remote=nj.remote, work_mode=nj.work_mode,
                          employment_type=nj.employment_type, seniority=nj.seniority, salary_min=nj.salary_min,
                          salary_max=nj.salary_max, currency=nj.currency, description=nj.description,
                          description_truncated=nj.description_truncated, application_url=nj.application_url,
                          source_url=nj.url, posted_at=nj.posted_at, first_seen_at=now, last_seen_at=now,
                          content_hash=nj.content_hash, fingerprint=nj.fingerprint, raw_json=nj.raw)
                db.add(job)
                await db.flush()
                if decision.kind in ("fingerprint_duplicate", "fuzzy_duplicate"):
                    duplicates += 1
                    JOBS_DEDUPLICATED.labels(decision.kind).inc()
                    canonical = next(j for j in existing_rows if j.id == decision.existing_id)
                    if canonical.duplicate_of_id:
                        canonical = await db.get(Job, canonical.duplicate_of_id) or canonical
                    # Prefer the richer source (ATS over aggregator) as canonical.
                    if SOURCE_PRIORITY.get(job.source, 3) < SOURCE_PRIORITY.get(canonical.source, 3):
                        canonical.duplicate_of_id = job.id
                        job.alternate_sources_json = (canonical.alternate_sources_json or []) + [
                            {"source": canonical.source, "url": canonical.source_url, "job_id": canonical.id}]
                        canonical.alternate_sources_json = []
                        canonical = job
                    else:
                        job.duplicate_of_id = canonical.id
                        canonical.alternate_sources_json = (canonical.alternate_sources_json or []) + [
                            {"source": job.source, "url": job.source_url, "job_id": job.id, "match": decision.kind}]
                    if canonical.id not in touched:
                        touched.append(canonical.id)
                    continue
                created += 1
            await ensure_job_analysis(db, job)
            to_embed.append(job)
            if job.duplicate_of_id is None:
                touched.append(job.id)
        await db.commit()
        if to_embed:  # one batched model call for all new/changed jobs
            vectors = await asyncio.to_thread(embed_texts, [job_embedding_text(j.title, j.company, j.description) for j in to_embed])
            for j, vec in zip(to_embed, vectors, strict=True):
                await store.upsert(JOBS, j.id, vec, {"source": j.source, "company": j.company, "title": j.title})
        touched = list(dict.fromkeys(touched))
        if touched and payload.get("candidate_id"):
            ctx.emit("jobs.normalized", {"candidate_id": payload["candidate_id"], "job_ids": touched})
        return NormalizationOutput(received=len(payload.get("raw_jobs", [])), created=created, updated=updated,
                                   unchanged=unchanged, duplicates=duplicates, invalid=invalid, job_ids=touched)
