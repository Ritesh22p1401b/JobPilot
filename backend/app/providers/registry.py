"""Builds enabled providers from settings + the job_sources table, and outbound destination links."""

from __future__ import annotations

import logging
from urllib.parse import quote_plus

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.models import JobSource
from app.providers.adzuna import AdzunaProvider
from app.providers.base import JobProvider
from app.providers.greenhouse import GreenhouseProvider
from app.providers.lever import LeverProvider

logger = logging.getLogger(__name__)

SOURCE_DEFAULTS = {
    "greenhouse": {"type": "ats_api", "base_url": "https://boards-api.greenhouse.io/v1/boards"},
    "lever": {"type": "ats_api", "base_url": "https://api.lever.co/v0/postings"},
    "adzuna": {"type": "search_api", "base_url": "https://api.adzuna.com/v1/api/jobs"},
    # Tier 4: destinations only. Never scraped; the user performs the search/application themselves.
    "linkedin": {"type": "destination", "base_url": "https://www.linkedin.com/jobs/search/"},
    "indeed": {"type": "destination", "base_url": "https://in.indeed.com/jobs"},
}


async def ensure_sources(db: AsyncSession) -> dict[str, JobSource]:
    settings = get_settings()
    rows = {s.name: s for s in (await db.execute(select(JobSource))).scalars()}
    defaults_cfg = {
        "greenhouse": ({"boards": settings.greenhouse_boards}, settings.greenhouse_enabled),
        "lever": ({"sites": settings.lever_sites}, settings.lever_enabled),
        "adzuna": ({"country": settings.adzuna_country},
                   settings.adzuna_enabled and bool(settings.adzuna_app_id and settings.adzuna_app_key)),
        "linkedin": ({}, True),
        "indeed": ({}, True),
    }
    changed = False
    for name, meta in SOURCE_DEFAULTS.items():
        if name not in rows:
            cfg, enabled = defaults_cfg[name]
            row = JobSource(name=name, type=meta["type"], base_url=meta["base_url"], enabled=enabled,
                            configuration_json=cfg)
            db.add(row)
            rows[name] = row
            changed = True
    if changed:
        await db.commit()
    return rows


async def build_providers(db: AsyncSession) -> list[JobProvider]:
    settings = get_settings()
    sources = await ensure_sources(db)
    providers: list[JobProvider] = []
    gh = sources.get("greenhouse")
    if gh and gh.enabled and gh.configuration_json.get("boards"):
        providers.append(GreenhouseProvider(gh.configuration_json["boards"]))
    lv = sources.get("lever")
    if lv and lv.enabled and lv.configuration_json.get("sites"):
        providers.append(LeverProvider(lv.configuration_json["sites"]))
    az = sources.get("adzuna")
    if az and az.enabled:
        if settings.adzuna_app_id and settings.adzuna_app_key:
            providers.append(AdzunaProvider(settings.adzuna_app_id, settings.adzuna_app_key,
                                            az.configuration_json.get("country", settings.adzuna_country)))
        else:
            logger.info("Adzuna enabled but ADZUNA_APP_ID/ADZUNA_APP_KEY are not set; skipping")
    return providers


def destination_links(query: str, location: str | None) -> dict[str, str]:
    """User-driven search links for platforms we do not scrape (LinkedIn, Indeed)."""
    q = quote_plus(query)
    loc = quote_plus(location or "")
    return {
        "linkedin": f"https://www.linkedin.com/jobs/search/?keywords={q}&location={loc}",
        "indeed": f"https://in.indeed.com/jobs?q={q}&l={loc}",
    }
