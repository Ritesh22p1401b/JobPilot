"""Greenhouse Job Board API (public, read-only GET endpoints; no authentication required).

Docs: https://developers.greenhouse.io/job-board.html
The API has no cross-company search, so we query the configured employer boards and filter locally.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime

from app.providers.base import location_matches, title_matches
from app.providers.http import ProviderError, ProviderHttp
from app.schemas.job import RawJob

logger = logging.getLogger(__name__)
BASE = "https://boards-api.greenhouse.io/v1/boards"


def _parse_dt(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


class GreenhouseProvider:
    name = "greenhouse"

    def __init__(self, boards: list[str], http: ProviderHttp | None = None) -> None:
        self.boards = [b.strip() for b in boards if b.strip()]
        self.http = http or ProviderHttp(self.name, min_interval=0.3)
        self._company: dict[str, str] = {}
        self.errors: list[str] = []

    async def _company_name(self, board: str) -> str:
        if board not in self._company:
            try:
                data = await self.http.get_json(f"{BASE}/{board}")
                self._company[board] = data.get("name") or board.title()
            except ProviderError:
                self._company[board] = board.title()
        return self._company[board]

    def _to_raw(self, board: str, company: str, j: dict) -> RawJob:
        location = (j.get("location") or {}).get("name")
        return RawJob(
            source=self.name,
            external_id=f"{board}:{j['id']}",
            company=j.get("company_name") or company,
            title=j.get("title", ""),
            location=location,
            description=j.get("content") or "",
            url=j.get("absolute_url") or f"https://boards.greenhouse.io/{board}/jobs/{j['id']}",
            application_url=j.get("absolute_url"),
            posted_at=_parse_dt(j.get("first_published") or j.get("updated_at")),
            remote=None,
            raw={"board": board, "id": j.get("id"), "departments": [d.get("name") for d in j.get("departments", [])],
                 "offices": [o.get("name") for o in j.get("offices", [])], "updated_at": j.get("updated_at")},
        )

    async def _board_jobs(self, board: str) -> list[RawJob]:
        company = await self._company_name(board)
        data = await self.http.get_json(f"{BASE}/{board}/jobs", params={"content": "true"})
        return [self._to_raw(board, company, j) for j in data.get("jobs", [])]

    async def search(self, query: str, location: str | None = None, page: int = 1) -> list[RawJob]:
        if page > 1:
            return []  # boards return all jobs in one response
        self.errors = []
        results = await asyncio.gather(*(self._board_jobs(b) for b in self.boards), return_exceptions=True)
        out: list[RawJob] = []
        for board, res in zip(self.boards, results, strict=True):
            if isinstance(res, BaseException):
                self.errors.append(f"{board}: {res}")
                logger.warning("greenhouse board %s failed: %s", board, res)
                continue
            out.extend(j for j in res if title_matches(query, j.title) and location_matches(location, j.location))
        return out

    async def get_job(self, external_id: str) -> RawJob | None:
        board, _, job_id = external_id.partition(":")
        try:
            data = await self.http.get_json(f"{BASE}/{board}/jobs/{job_id}", params={"questions": "true"}, use_cache=False)
        except ProviderError as exc:
            if exc.status == 404:
                return None
            raise
        return self._to_raw(board, await self._company_name(board), data)

    async def get_application_questions(self, external_id: str) -> list[dict]:
        board, _, job_id = external_id.partition(":")
        data = await self.http.get_json(f"{BASE}/{board}/jobs/{job_id}", params={"questions": "true"}, use_cache=False)
        return data.get("questions", [])

    async def aclose(self) -> None:
        await self.http.aclose()
