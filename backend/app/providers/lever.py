"""Lever Postings API (public published postings).

Docs: https://github.com/lever/postings-api
Lever provides no full-text search across companies; we query configured company sites.
"""

from __future__ import annotations

import asyncio
import html
import logging
from datetime import UTC, datetime

from app.providers.base import location_matches, title_matches
from app.providers.http import ProviderError, ProviderHttp
from app.schemas.job import RawJob

logger = logging.getLogger(__name__)
BASE = "https://api.lever.co/v0/postings"


class LeverProvider:
    name = "lever"

    def __init__(self, sites: list[str], http: ProviderHttp | None = None) -> None:
        self.sites = [s.strip() for s in sites if s.strip()]
        self.http = http or ProviderHttp(self.name, min_interval=0.3)
        self.errors: list[str] = []

    def _to_raw(self, site: str, p: dict) -> RawJob:
        cats = p.get("categories") or {}
        parts = [f"<p>{html.escape(p.get('descriptionPlain') or '')}</p>" if p.get("descriptionPlain") else p.get("description", "")]
        for lst in p.get("lists", []) or []:
            parts.append(f"<h3>{html.escape(lst.get('text', ''))}</h3><ul>{lst.get('content', '')}</ul>")
        if p.get("additionalPlain"):
            parts.append(f"<p>{html.escape(p['additionalPlain'])}</p>")
        created = p.get("createdAt")
        salary = p.get("salaryRange") or {}
        workplace = (p.get("workplaceType") or "").lower()
        return RawJob(
            source=self.name,
            external_id=f"{site}:{p['id']}",
            company=site.replace("-", " ").title(),
            title=p.get("text", ""),
            location=cats.get("location") or ", ".join(cats.get("allLocations") or []) or None,
            description="\n".join(parts),
            url=p.get("hostedUrl") or f"https://jobs.lever.co/{site}/{p['id']}",
            application_url=p.get("applyUrl") or p.get("hostedUrl"),
            posted_at=datetime.fromtimestamp(created / 1000, tz=UTC) if isinstance(created, int | float) else None,
            salary_min=salary.get("min"),
            salary_max=salary.get("max"),
            currency=salary.get("currency"),
            employment_type=cats.get("commitment"),
            remote=True if workplace == "remote" else None,
            raw={"site": site, "id": p.get("id"), "team": cats.get("team"), "workplaceType": workplace},
        )

    async def _site_jobs(self, site: str) -> list[RawJob]:
        data = await self.http.get_json(f"{BASE}/{site}", params={"mode": "json"})
        if not isinstance(data, list):
            raise ProviderError(self.name, f"Unexpected response for site {site}")
        return [self._to_raw(site, p) for p in data]

    async def search(self, query: str, location: str | None = None, page: int = 1) -> list[RawJob]:
        if page > 1:
            return []
        self.errors = []
        results = await asyncio.gather(*(self._site_jobs(s) for s in self.sites), return_exceptions=True)
        out: list[RawJob] = []
        for site, res in zip(self.sites, results, strict=True):
            if isinstance(res, BaseException):
                self.errors.append(f"{site}: {res}")
                logger.warning("lever site %s failed: %s", site, res)
                continue
            out.extend(j for j in res if title_matches(query, j.title) and location_matches(location, j.location))
        return out

    async def get_job(self, external_id: str) -> RawJob | None:
        site, _, pid = external_id.partition(":")
        try:
            data = await self.http.get_json(f"{BASE}/{site}/{pid}", params={"mode": "json"}, use_cache=False)
        except ProviderError as exc:
            if exc.status == 404:
                return None
            raise
        return self._to_raw(site, data)

    async def aclose(self) -> None:
        await self.http.aclose()
