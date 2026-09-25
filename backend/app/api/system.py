"""Health, dashboard, notifications, job sources and LLM configuration."""

from __future__ import annotations

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_user
from app.api.serializers import notification_out, version_out
from app.config import get_settings
from app.database import get_db, utcnow
from app.models import Application, Job, JobMatch, Notification, ResumeVersion, SystemSetting, User
from app.providers.registry import ensure_sources
from app.services.embeddings import get_embedder
from app.services.llm import get_llm, invalidate_override_cache, normalize_base_url
from app.services.repository import audit, get_candidate, get_prefs, master_version
from app.services.vector_store import get_vector_store

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": get_settings().app_name}


@router.get("/health/ready")
async def ready(db: AsyncSession = Depends(get_db)) -> dict:
    checks: dict[str, object] = {}
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:  # noqa: BLE001
        checks["database"] = f"error: {exc}"
    checks["vector_store"] = "ok" if await get_vector_store().health() else "unavailable (falling back to in-process similarity)"
    llm = await get_llm().health()
    checks["llm"] = "ok" if llm.get("reachable") else ("not configured" if not llm.get("configured") else "unreachable")
    checks["embeddings"] = get_embedder().name
    return {"status": "ok" if checks["database"] == "ok" else "degraded", "checks": checks}


@router.get("/dashboard")
async def dashboard(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    candidate = await get_candidate(db, user.id)
    if candidate is None:
        return {"has_profile": False}
    prefs = await get_prefs(db, user.id)
    since = utcnow() - timedelta(days=1)
    base = select(func.count()).select_from(JobMatch).where(JobMatch.candidate_id == candidate.id,
                                                             JobMatch.hard_filter_passed.is_(True))
    jobs_today = (await db.execute(base.join(Job, Job.id == JobMatch.job_id).where(Job.first_seen_at >= since))).scalar()
    high = (await db.execute(base.where(JobMatch.overall_score >= max(prefs.minimum_match_score, 80)))).scalar()
    total_matches = (await db.execute(base)).scalar()
    status_rows = (await db.execute(select(Application.status, func.count()).where(Application.candidate_id == candidate.id)
                                    .group_by(Application.status))).all()
    counts: dict[str, int] = {str(s): int(n) for s, n in status_rows}
    pending_reviews = (await db.execute(select(func.count()).select_from(ResumeVersion).where(
        ResumeVersion.candidate_id == candidate.id, ResumeVersion.status.in_(["DRAFT", "NEEDS_REVIEW"])))).scalar()
    mv = await master_version(db, candidate.id)
    return {
        "has_profile": True,
        "jobs_found_today": jobs_today, "high_match_jobs": high, "total_matches": total_matches,
        "applications": sum(counts.values()), "applications_by_status": counts,
        "interviews": counts.get("INTERVIEW", 0), "offers": counts.get("OFFER", 0),
        "pending_actions": counts.get("APPROVAL_REQUIRED", 0) + (pending_reviews or 0),
        "pending_resume_reviews": pending_reviews,
        "master_resume": version_out(mv) if mv else None,
        "last_discovery_at": candidate.last_discovery_at.isoformat() if candidate.last_discovery_at else None,
        "search_frequency": prefs.search_frequency,
        "application_mode": prefs.application_mode,
        "auto_apply": prefs.auto_apply,
    }


@router.get("/notifications")
async def notifications(user: User = Depends(current_user), db: AsyncSession = Depends(get_db), unread_only: bool = False) -> dict:
    q = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        q = q.where(Notification.read.is_(False))
    rows = (await db.execute(q.order_by(Notification.created_at.desc()).limit(50))).scalars().all()
    unread = (await db.execute(select(func.count()).select_from(Notification).where(
        Notification.user_id == user.id, Notification.read.is_(False)))).scalar()
    return {"notifications": [notification_out(n) for n in rows], "unread": unread}


@router.post("/notifications/read-all")
async def read_all(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    await db.execute(update(Notification).where(Notification.user_id == user.id).values(read=True))
    await db.commit()
    return {"ok": True}


@router.post("/notifications/{notification_id}/read")
async def read_one(notification_id: str, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    n = await db.get(Notification, notification_id)
    if n is None or n.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Notification not found")
    n.read = True
    await db.commit()
    return notification_out(n)


# ------------------------------------------------------------------------------ job sources
@router.get("/sources")
async def sources(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    rows = await ensure_sources(db)
    s = get_settings()
    return {"sources": [{"name": r.name, "type": r.type, "enabled": r.enabled, "base_url": r.base_url,
                         "configuration": r.configuration_json,
                         "credentials_configured": bool(s.adzuna_app_id and s.adzuna_app_key) if r.name == "adzuna" else None,
                         "scraped": False} for r in rows.values()]}


class SourceUpdate(BaseModel):
    enabled: bool | None = None
    boards: list[str] | None = Field(default=None, max_length=50)
    sites: list[str] | None = Field(default=None, max_length=50)
    country: str | None = Field(default=None, pattern="^[a-z]{2}$")


@router.put("/sources/{name}")
async def update_source(name: str, body: SourceUpdate, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    rows = await ensure_sources(db)
    src = rows.get(name)
    if src is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown source")
    if src.type == "destination":
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{name} is a destination link only; it is never scraped.")
    cfg = dict(src.configuration_json or {})
    if body.boards is not None and name == "greenhouse":
        cfg["boards"] = [b.strip().lower() for b in body.boards if b.strip()]
    if body.sites is not None and name == "lever":
        cfg["sites"] = [b.strip().lower() for b in body.sites if b.strip()]
    if body.country is not None and name == "adzuna":
        cfg["country"] = body.country
    src.configuration_json = cfg
    if body.enabled is not None:
        src.enabled = body.enabled
    await audit(db, user.id, "source.updated", name, cfg)
    await db.commit()
    return {"name": src.name, "enabled": src.enabled, "configuration": src.configuration_json}


# ------------------------------------------------------------------------------ LLM config
class LLMSettingsIn(BaseModel):
    base_url: str = Field(default="", max_length=500)
    model: str = Field(default="", max_length=200)
    api_key: str | None = Field(default=None, max_length=500)


@router.get("/system/llm")
async def llm_status(user: User = Depends(current_user)) -> dict:
    return await get_llm().health()


@router.put("/system/llm")
async def set_llm(body: LLMSettingsIn, user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    """Runtime LLM endpoint (Colab tunnels change every session). Disabled in production."""
    if get_settings().is_production:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Configure the LLM via environment variables in production")
    row = await db.get(SystemSetting, "llm")
    value = {"base_url": normalize_base_url(body.base_url) if body.base_url else "", "model": body.model}
    if body.api_key is not None:
        value["api_key"] = body.api_key
    elif row and row.value_json.get("api_key"):
        value["api_key"] = row.value_json["api_key"]
    if row is None:
        db.add(SystemSetting(key="llm", value_json=value))
    else:
        row.value_json = value
    await audit(db, user.id, "llm.configured", None, {"base_url": value["base_url"], "model": body.model})
    await db.commit()
    invalidate_override_cache()
    return await get_llm().health()


@router.post("/system/llm/test")
async def test_llm(user: User = Depends(current_user)) -> dict:
    """Round-trip a tiny structured prompt to verify the model returns valid JSON."""
    from app.services.llm import LLMOutputError, LLMUnavailable, extract_json

    llm = get_llm()
    try:
        content, meta = await llm.chat([
            {"role": "system", "content": "Return only JSON."},
            {"role": "user", "content": 'Return {"ok": true, "skills": ["Python", "FastAPI"]} exactly.'},
        ], max_tokens=100)
        return {"ok": True, "parsed": extract_json(content), "latency_ms": meta["latency_ms"], "model": meta["model"]}
    except (LLMUnavailable, LLMOutputError) as exc:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc)) from exc
