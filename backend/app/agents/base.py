"""Agent base class, run tracking (agent_runs) and event emission context."""

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, ClassVar

from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import utcnow
from app.events.bus import publish
from app.logging_config import log_event, redact, run_id_var
from app.models import AgentRun
from app.observability import AGENT_LATENCY, AGENT_RUNS

logger = logging.getLogger(__name__)


@dataclass
class PendingEvent:
    event_type: str
    payload: dict
    dedup_key: str | None = None


@dataclass
class AgentContext:
    user_id: str | None = None
    task_id: str | None = None
    events: list[PendingEvent] = field(default_factory=list)
    llm_meta: list[dict] = field(default_factory=list)

    def emit(self, event_type: str, payload: dict, dedup_key: str | None = None) -> None:
        self.events.append(PendingEvent(event_type, payload, dedup_key))

    def record_llm(self, meta: dict) -> None:
        self.llm_meta.append(meta)


class BaseAgent:
    name: ClassVar[str] = "agent"

    async def execute(self, db: AsyncSession, payload: dict, ctx: AgentContext) -> BaseModel:  # pragma: no cover
        raise NotImplementedError


def _trim(value: Any, limit: int = 20000) -> Any:
    import json

    text = json.dumps(value, default=str)
    if len(text) <= limit:
        return value
    return {"truncated": True, "preview": text[:limit]}


def _input_summary(payload: dict) -> dict:
    summary = dict(redact({k: v for k, v in payload.items() if k != "raw_jobs"}))
    if "raw_jobs" in payload:
        summary["raw_jobs"] = len(payload["raw_jobs"])
    return summary


async def run_agent(agent: BaseAgent, db: AsyncSession, payload: dict, ctx: AgentContext,
                    candidate_id: str | None = None, job_id: str | None = None, publish_events: bool = True) -> BaseModel:
    run = AgentRun(agent_name=agent.name, candidate_id=candidate_id, job_id=job_id, task_id=ctx.task_id, status="RUNNING",
                   input_json=_trim(_input_summary(payload)))
    db.add(run)
    await db.commit()
    token = run_id_var.set(run.id)
    started = time.monotonic()
    try:
        output = await agent.execute(db, payload, ctx)
    except Exception as exc:
        await db.rollback()
        latency = int((time.monotonic() - started) * 1000)
        run = await db.get(AgentRun, run.id)  # type: ignore[assignment]
        if run is not None:
            run.status = "FAILED"
            run.error = f"{type(exc).__name__}: {exc}"[:4000]
            run.completed_at = utcnow()
            run.latency_ms = latency
            await db.commit()
        AGENT_RUNS.labels(agent.name, "failed").inc()
        log_event(logger, "agent_failed", logging.ERROR, agent=agent.name, error=str(exc)[:300], latency_ms=latency)
        raise
    finally:
        run_id_var.reset(token)
    latency = int((time.monotonic() - started) * 1000)
    run.status = "SUCCEEDED"
    produced_candidate = getattr(output, "candidate_id", None)
    if run.candidate_id is None and isinstance(produced_candidate, str):
        run.candidate_id = produced_candidate  # e.g. the Resume Agent creates the candidate during its run
    run.output_json = _trim(output.model_dump(mode="json"))
    run.completed_at = utcnow()
    run.latency_ms = latency
    if ctx.llm_meta:
        run.model = ctx.llm_meta[-1].get("model")
        run.prompt_version = ",".join(sorted({m.get("prompt_version", "") for m in ctx.llm_meta if m.get("prompt_version")}))
        usage: dict[str, int] = {}
        for m in ctx.llm_meta:
            for k, v in (m.get("usage") or {}).items():
                if isinstance(v, int):
                    usage[k] = usage.get(k, 0) + v
        usage["llm_latency_ms"] = sum(int(m.get("latency_ms", 0)) for m in ctx.llm_meta)
        run.token_usage_json = usage
    AGENT_RUNS.labels(agent.name, "succeeded").inc()
    AGENT_LATENCY.labels(agent.name).observe(latency / 1000)
    log_event(logger, "agent_succeeded", agent=agent.name, latency_ms=latency)
    if publish_events:
        for ev in ctx.events:
            await publish(db, ev.event_type, ev.payload, user_id=ctx.user_id, dedup_key=ev.dedup_key,
                          parent_id=ctx.task_id, commit=False)
        ctx.events.clear()
    await db.commit()
    return output
