from __future__ import annotations

from datetime import timedelta

from sqlalchemy import update

from app.database import as_utc, utcnow
from app.events import handlers
from app.events.bus import claim_next, publish
from app.models import EventTask
from app.workers import worker


async def test_dedup_and_claim(db):
    t1 = await publish(db, "discovery.requested", {"candidate_id": "c1"}, dedup_key="discovery:c1")
    t2 = await publish(db, "discovery.requested", {"candidate_id": "c1"}, dedup_key="discovery:c1")
    assert t1.id == t2.id
    claimed = await claim_next(db)
    assert claimed is not None and claimed.id == t1.id and claimed.status == "RUNNING" and claimed.attempts == 1
    assert await claim_next(db) is None


async def test_transient_failures_retry_with_backoff_then_fail(db, monkeypatch):
    calls = {"n": 0}

    async def boom(_db, _task):
        calls["n"] += 1
        raise RuntimeError("transient provider outage")

    monkeypatch.setattr(worker, "dispatch", boom)
    task = await publish(db, "discovery.requested", {"candidate_id": "c1"}, max_attempts=2)
    assert await worker.process_one()
    await db.refresh(task)
    assert task.status == "PENDING" and task.attempts == 1 and "transient" in task.last_error
    assert as_utc(task.run_after) > utcnow()  # backoff scheduled
    assert not await worker.process_one()  # not yet due
    await db.execute(update(EventTask).where(EventTask.id == task.id).values(run_after=utcnow() - timedelta(seconds=1)))
    await db.commit()
    assert await worker.process_one()
    await db.refresh(task)
    assert task.status == "FAILED" and calls["n"] == 2


async def test_non_retryable_errors_fail_immediately(db, monkeypatch):
    async def bad_input(_db, _task):
        raise ValueError("Candidate not found")

    monkeypatch.setattr(worker, "dispatch", bad_input)
    task = await publish(db, "profile.updated", {"candidate_id": "missing"})
    await worker.process_one()
    await db.refresh(task)
    assert task.status == "FAILED" and task.attempts == 1


def test_every_event_has_exactly_one_subscriber_or_is_terminal():
    from app.events.bus import EVENT_TYPES

    assert set(handlers.AGENT_FACTORIES) <= EVENT_TYPES
    # application.submit_requested is only ever triggered by an explicit user action (API), never by an agent.
    assert EVENT_TYPES - set(handlers.AGENT_FACTORIES) == {"application.submit_requested"}
