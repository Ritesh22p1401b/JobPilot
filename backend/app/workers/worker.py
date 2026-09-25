"""Background worker + scheduler.

Run standalone:   python -m app.workers.worker
Or embedded in the API process (EMBEDDED_WORKER=true, the default for local development).
"""

from __future__ import annotations

import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select

from app.config import get_settings
from app.database import as_utc, get_sessionmaker, utcnow
from app.events.bus import claim_next, complete, fail, publish
from app.events.handlers import dispatch
from app.models import CandidatePreferences, CandidateProfile
from app.providers.http import ProviderError
from app.text_extraction_errors import NON_RETRYABLE

logger = logging.getLogger(__name__)
FREQUENCY = {"hourly": timedelta(hours=1), "every_6_hours": timedelta(hours=6), "daily": timedelta(days=1)}


async def process_one() -> bool:
    """Claim and process a single event. Returns False when the queue is empty."""
    sm = get_sessionmaker()
    async with sm() as db:
        task = await claim_next(db)
    if task is None:
        return False
    async with sm() as db:
        try:
            result = await dispatch(db, task)
            await complete(db, task.id, result)
        except NON_RETRYABLE as exc:
            await fail(db, task, f"{type(exc).__name__}: {exc}", retryable=False)
        except ProviderError as exc:
            await fail(db, task, str(exc), retryable=True)
        except Exception as exc:
            logger.exception("event %s (%s) failed", task.id, task.event_type)
            await fail(db, task, f"{type(exc).__name__}: {exc}")
    return True


async def drain(max_tasks: int = 1000) -> int:
    """Process events until the queue is empty (used by tests and CLI)."""
    n = 0
    while n < max_tasks and await process_one():
        n += 1
    return n


async def schedule_due_discoveries() -> int:
    """Publish discovery.requested for users whose search frequency has elapsed."""
    sm = get_sessionmaker()
    queued = 0
    async with sm() as db:
        rows = (await db.execute(select(CandidateProfile, CandidatePreferences)
                                 .join(CandidatePreferences, CandidatePreferences.user_id == CandidateProfile.user_id))).all()
        now = utcnow()
        for candidate, pref_row in rows:
            freq = (pref_row.preferences_json or {}).get("search_frequency", "daily")
            if freq not in FREQUENCY:
                continue
            last = as_utc(candidate.last_discovery_at)
            if last is None or now - last >= FREQUENCY[freq]:
                await publish(db, "discovery.requested", {"candidate_id": candidate.id}, user_id=candidate.user_id,
                              dedup_key=f"discovery:{candidate.id}")
                candidate.last_discovery_at = now  # prevent re-queueing while the run is pending
                queued += 1
        await db.commit()
    return queued


async def run_forever(stop: asyncio.Event | None = None) -> None:
    settings = get_settings()
    stop = stop or asyncio.Event()
    last_schedule = 0.0
    loop = asyncio.get_running_loop()
    logger.info("worker started")
    while not stop.is_set():
        try:
            if loop.time() - last_schedule >= settings.scheduler_interval_seconds:
                last_schedule = loop.time()
                await schedule_due_discoveries()
            busy = await process_one()
        except Exception:
            logger.exception("worker loop error")
            busy = False
        if not busy:
            try:
                await asyncio.wait_for(stop.wait(), timeout=settings.worker_poll_seconds)
            except TimeoutError:
                pass
    logger.info("worker stopped")


def main() -> None:
    from app.logging_config import configure_logging

    configure_logging(get_settings().log_level)
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
