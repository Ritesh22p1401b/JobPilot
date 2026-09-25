"""Event subscriptions: each event type is handled by exactly one specialised agent."""

from __future__ import annotations

from collections.abc import Callable

from sqlalchemy.ext.asyncio import AsyncSession

from app.agents.application_agent import ApplicationAgent
from app.agents.base import AgentContext, BaseAgent, run_agent
from app.agents.discovery_agent import DiscoveryAgent
from app.agents.job_analyst_agent import JobAnalystAgent
from app.agents.matching_agent import MatchingAgent
from app.agents.normalization_agent import NormalizationAgent
from app.agents.resume_agents.resume_optimizer_agent import ResumeOptimizerAgent
from app.agents.resume_agents.resume_test_agent import ResumeTestAgent
from app.models import EventTask

AGENT_FACTORIES: dict[str, Callable[[], BaseAgent]] = {
    "resume.uploaded": ResumeTestAgent,          # test the master resume, then profile.updated
    "profile.updated": MatchingAgent,            # re-score all known jobs against the new profile
    "discovery.requested": DiscoveryAgent,
    "jobs.collected": NormalizationAgent,
    "jobs.normalized": MatchingAgent,
    "matches.computed": JobAnalystAgent,
    "resume.tailor_requested": ResumeOptimizerAgent,
    "resume.version_created": ResumeTestAgent,
    "application.prepare_requested": ApplicationAgent,
}


def payload_for(task: EventTask) -> dict:
    payload = dict(task.payload_json or {})
    if task.event_type == "resume.uploaded":
        payload["emit_profile_updated"] = True
    return payload


async def dispatch(db: AsyncSession, task: EventTask) -> dict:
    factory = AGENT_FACTORIES.get(task.event_type)
    if factory is None:
        return {"skipped": f"no subscriber for {task.event_type}"}
    agent = factory()
    payload = payload_for(task)
    ctx = AgentContext(user_id=task.user_id, task_id=task.id)
    output = await run_agent(agent, db, payload, ctx, candidate_id=payload.get("candidate_id"), job_id=payload.get("job_id"))
    data = output.model_dump(mode="json")
    return {k: v for k, v in data.items() if k not in ("report", "matrix")}
