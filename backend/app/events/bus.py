"""Durable event bus on PostgreSQL (no Redis required).

Agents never call each other. They publish typed events; workers claim events with
`SELECT ... FOR UPDATE SKIP LOCKED`, run the subscribed agent, and the agent publishes follow-ups.
Failed events are retried with exponential backoff up to `max_attempts`.
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import utcnow
from app.models import EventTask

EVENT_TYPES = {
    "resume.uploaded",
    "profile.updated",
    "discovery.requested",
    "jobs.collected",
    "jobs.normalized",
    "matches.computed",
    "resume.tailor_requested",
    "resume.version_created",
    "application.prepare_requested",
    "application.submit_requested",
}
STALE_AFTER = timedelta(minutes=15)


async def publish(db: AsyncSession, event_type: str, payload: dict, user_id: str | None = None,
                  dedup_key: str | None = None, parent_id: str | None = None, max_attempts: int = 3,
                  commit: bool = True) -> EventTask:
    if event_type not in EVENT_TYPES:
        raise ValueError(f"Unknown event type {event_type}")
    if dedup_key:
        existing = (await db.execute(
            select(EventTask).where(EventTask.dedup_key == dedup_key, EventTask.status.in_(["PENDING", "RUNNING"]))
        )).scalars().first()
        if existing:
            return existing
    task = EventTask(event_type=event_type, payload_json=payload, user_id=user_id, dedup_key=dedup_key,
                     parent_id=parent_id, max_attempts=max_attempts)
    db.add(task)
    if commit:
        await db.commit()
    else:
        await db.flush()
    return task


async def claim_next(db: AsyncSession) -> EventTask | None:
    now = utcnow()
    stmt = (
        select(EventTask)
        .where(or_(
            and_(EventTask.status == "PENDING", EventTask.run_after <= now),
            and_(EventTask.status == "RUNNING", EventTask.updated_at < now - STALE_AFTER),  # crashed worker
        ))
        .order_by(EventTask.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    task = (await db.execute(stmt)).scalars().first()
    if task is None:
        await db.rollback()
        return None
    task.status = "RUNNING"
    task.attempts += 1
    task.updated_at = now
    await db.commit()
    return task


async def complete(db: AsyncSession, task_id: str, result: dict) -> None:
    await db.execute(update(EventTask).where(EventTask.id == task_id)
                     .values(status="DONE", result_json=result, updated_at=utcnow(), last_error=None))
    await db.commit()


async def fail(db: AsyncSession, task: EventTask, error: str, retryable: bool = True) -> None:
    exhausted = task.attempts >= task.max_attempts or not retryable
    values: dict = {"last_error": error[:4000], "updated_at": utcnow()}
    if exhausted:
        values["status"] = "FAILED"
    else:
        values["status"] = "PENDING"
        values["run_after"] = utcnow() + timedelta(seconds=5 * 2 ** (task.attempts - 1))
    await db.execute(update(EventTask).where(EventTask.id == task.id).values(**values))
    await db.commit()
