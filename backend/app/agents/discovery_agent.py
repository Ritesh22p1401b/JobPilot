"""Job Discovery Agent: generates queries from the profile/preferences and queries approved providers only.

A failing provider never stops the pipeline; its error is recorded and the others continue.
"""

from __future__ import annotations

import asyncio
import logging

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.base import AgentContext, BaseAgent
from app.database import utcnow
from app.models import CandidateProfile
from app.observability import JOBS_DISCOVERED, PROVIDER_ERRORS
from app.providers.base import JobProvider
from app.providers.registry import build_providers
from app.schemas.job import RawJob
from app.schemas.preferences import Preferences
from app.schemas.profile import CandidateProfileData
from app.services.repository import get_prefs, profile_data

logger = logging.getLogger(__name__)
BATCH = 40
MAX_QUERIES = 4
MAX_LOCATIONS = 3


class ProviderStats(BaseModel):
    count: int = 0
    errors: list[str] = Field(default_factory=list)


class DiscoveryOutput(BaseModel):
    queries: list[str]
    locations: list[str | None]
    providers: dict[str, ProviderStats]
    total_raw: int
    batches: int


def generate_queries(profile: CandidateProfileData, prefs: Preferences) -> list[str]:
    titles = prefs.target_titles or profile.target_roles
    queries = list(dict.fromkeys(t.strip() for t in titles if t.strip()))[:MAX_QUERIES]
    queries += [k for k in prefs.search_keywords if k not in queries][:2]
    return queries or ["Software Engineer"]


def generate_locations(profile: CandidateProfileData, prefs: Preferences) -> list[str | None]:
    locs: list[str | None] = [loc for loc in prefs.locations[:MAX_LOCATIONS] if loc]
    if not locs and profile.contact.location:
        locs = [profile.contact.location.split(",")[0].strip()]
    return locs or [None]


class DiscoveryAgent(BaseAgent):
    name = "discovery_agent"

    def __init__(self, providers: list[JobProvider] | None = None) -> None:
        self._providers = providers

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> DiscoveryOutput:
        candidate = await db.get(CandidateProfile, payload["candidate_id"])
        if candidate is None:
            raise ValueError("Candidate not found")
        profile = profile_data(candidate)
        prefs = await get_prefs(db, candidate.user_id)
        queries = payload.get("queries") or generate_queries(profile, prefs)
        locations = payload.get("locations") or generate_locations(profile, prefs)
        providers = self._providers if self._providers is not None else await build_providers(db)

        stats: dict[str, ProviderStats] = {}
        seen: dict[tuple[str, str], RawJob] = {}

        async def run_provider(p: JobProvider) -> None:
            st = stats.setdefault(p.name, ProviderStats())
            # ATS boards have no server-side search: one pass per query; location filtering happens in matching.
            locs = locations if p.name == "adzuna" else [None]
            for q in queries:
                for loc in locs:
                    try:
                        jobs = await p.search(q, loc)
                    except Exception as exc:  # noqa: BLE001 - isolate provider failures
                        PROVIDER_ERRORS.labels(p.name).inc()
                        st.errors.append(f"{q}/{loc}: {str(exc)[:200]}")
                        logger.warning("provider %s failed for %s/%s: %s", p.name, q, loc, exc)
                        continue
                    for j in jobs:
                        key = (j.source, j.external_id)
                        if key not in seen:
                            seen[key] = j
                            st.count += 1
            st.errors.extend(getattr(p, "errors", []) or [])

        try:
            await asyncio.gather(*(run_provider(p) for p in providers))
        finally:
            if self._providers is None:
                for p in providers:
                    await p.aclose()
        for name, st in stats.items():
            JOBS_DISCOVERED.labels(name).inc(st.count)

        raw = [j.model_dump(mode="json") for j in seen.values()]
        batches = [raw[i: i + BATCH] for i in range(0, len(raw), BATCH)]
        for i, batch in enumerate(batches):
            ctx.emit("jobs.collected", {"candidate_id": candidate.id, "raw_jobs": batch, "batch": i, "batches": len(batches)})
        candidate.last_discovery_at = utcnow()
        await db.commit()
        return DiscoveryOutput(queries=queries, locations=locations, providers=stats, total_raw=len(raw), batches=len(batches))
