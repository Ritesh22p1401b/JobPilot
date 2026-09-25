"""Adzuna job-search API (requires app_id / app_key).

Docs: https://developer.adzuna.com/docs/search
Note: Adzuna returns a truncated description snippet; the full posting lives at redirect_url.
"""

from __future__ import annotations

from datetime import datetime

from app.providers.http import ProviderError, ProviderHttp
from app.schemas.job import RawJob

BASE = "https://api.adzuna.com/v1/api/jobs"
CURRENCY = {"in": "INR", "gb": "GBP", "us": "USD", "ca": "CAD", "au": "AUD", "de": "EUR", "fr": "EUR", "nl": "EUR",
            "sg": "SGD", "za": "ZAR", "nz": "NZD", "br": "BRL", "pl": "PLN", "it": "EUR", "es": "EUR", "at": "EUR"}


class AdzunaProvider:
    name = "adzuna"

    def __init__(self, app_id: str, app_key: str, country: str = "in", http: ProviderHttp | None = None,
                 results_per_page: int = 50) -> None:
        if not app_id or not app_key:
            raise ValueError("Adzuna requires ADZUNA_APP_ID and ADZUNA_APP_KEY")
        self.app_id = app_id
        self.app_key = app_key
        self.country = country.lower()
        self.results_per_page = results_per_page
        self.http = http or ProviderHttp(self.name, min_interval=1.0)
        self.errors: list[str] = []

    def _to_raw(self, r: dict) -> RawJob:
        predicted = str(r.get("salary_is_predicted", "0")) == "1"
        created = r.get("created")
        return RawJob(
            source=self.name,
            external_id=str(r["id"]),
            company=(r.get("company") or {}).get("display_name") or "Unknown company",
            title=r.get("title", "").replace("<strong>", "").replace("</strong>", ""),
            location=(r.get("location") or {}).get("display_name"),
            description=r.get("description", ""),
            description_truncated=True,
            url=r.get("redirect_url", ""),
            application_url=r.get("redirect_url"),
            posted_at=datetime.fromisoformat(created.replace("Z", "+00:00")) if created else None,
            # Adzuna's *predicted* salaries are estimates, not employer statements; don't present them as facts.
            salary_min=None if predicted else r.get("salary_min"),
            salary_max=None if predicted else r.get("salary_max"),
            currency=CURRENCY.get(self.country),
            employment_type=r.get("contract_time") or r.get("contract_type"),
            raw={"category": (r.get("category") or {}).get("label"), "salary_is_predicted": predicted,
                 "predicted_salary_min": r.get("salary_min") if predicted else None,
                 "predicted_salary_max": r.get("salary_max") if predicted else None},
        )

    async def search(self, query: str, location: str | None = None, page: int = 1) -> list[RawJob]:
        params: dict = {"app_id": self.app_id, "app_key": self.app_key, "results_per_page": self.results_per_page,
                        "what": query, "content-type": "application/json"}
        if location and location.lower() != "remote":
            params["where"] = location
        elif location and location.lower() == "remote":
            params["what"] = f"{query} remote"
        data = await self.http.get_json(f"{BASE}/{self.country}/search/{page}", params=params)
        return [self._to_raw(r) for r in data.get("results", [])]

    async def get_job(self, external_id: str) -> RawJob | None:
        # Adzuna has no single-job endpoint; search by id is not supported. Stored jobs are the source of truth.
        return None

    async def aclose(self) -> None:
        await self.http.aclose()


__all__ = ["AdzunaProvider", "ProviderError"]
