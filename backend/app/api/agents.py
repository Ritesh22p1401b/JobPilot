from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import agent_limiter, current_candidate, current_user
from app.api.serializers import iso, task_out
from app.database import get_db
from app.events.bus import publish
from app.models import AgentRun, CandidateProfile, EventTask, Job, User

router = APIRouter(tags=["agents"])


@router.post("/agents/discover", status_code=202, dependencies=[Depends(agent_limiter)])
async def discover(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    task = await publish(db, "discovery.requested", {"candidate_id": candidate.id}, user_id=candidate.user_id,
                         dedup_key=f"discovery:{candidate.id}")
    return {"task": task_out(task)}


@router.post("/agents/match", status_code=202, dependencies=[Depends(agent_limiter)])
async def match(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db)) -> dict:
    task = await publish(db, "profile.updated", {"candidate_id": candidate.id}, user_id=candidate.user_id,
                         dedup_key=f"profile.updated:{candidate.id}")
    return {"task": task_out(task)}


class ApplicationAgentRequest(BaseModel):
    job_id: str


@router.post("/agents/application", status_code=202, dependencies=[Depends(agent_limiter)])
async def application(body: ApplicationAgentRequest, candidate: CandidateProfile = Depends(current_candidate),
                      db: AsyncSession = Depends(get_db)) -> dict:
    if await db.get(Job, body.job_id) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    task = await publish(db, "application.prepare_requested", {"candidate_id": candidate.id, "job_id": body.job_id},
                         user_id=candidate.user_id, dedup_key=f"prepare:{candidate.id}:{body.job_id}")
    return {"task": task_out(task)}


@router.get("/tasks/{task_id}")
async def get_task(task_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    task = await db.get(EventTask, task_id)
    if task is None or task.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Task not found")
    children = (await db.execute(select(EventTask).where(EventTask.parent_id == task.id))).scalars().all()
    return {**task_out(task), "children": [task_out(c) for c in children]}


@router.get("/tasks")
async def list_tasks(user: User = Depends(current_user), db: AsyncSession = Depends(get_db), active_only: bool = False) -> dict:
    q = select(EventTask).where(EventTask.user_id == user.id)
    if active_only:
        q = q.where(EventTask.status.in_(["PENDING", "RUNNING"]))
    rows = (await db.execute(q.order_by(EventTask.created_at.desc()).limit(50))).scalars().all()
    return {"tasks": [task_out(t) for t in rows]}


@router.get("/agents/runs")
async def runs(candidate: CandidateProfile = Depends(current_candidate), db: AsyncSession = Depends(get_db), limit: int = 50) -> dict:
    rows = (await db.execute(select(AgentRun).where(AgentRun.candidate_id == candidate.id)
                             .order_by(AgentRun.started_at.desc()).limit(min(limit, 200)))).scalars().all()
    return {"runs": [{"id": r.id, "agent": r.agent_name, "status": r.status, "job_id": r.job_id, "error": r.error,
                      "latency_ms": r.latency_ms, "model": r.model, "prompt_version": r.prompt_version,
                      "token_usage": r.token_usage_json, "started_at": iso(r.started_at), "output": r.output_json}
                     for r in rows]}
