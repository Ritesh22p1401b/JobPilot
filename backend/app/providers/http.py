"""Polite HTTP client for provider APIs: rate limiting, retries with backoff, TTL cache."""

from __future__ import annotations

import asyncio
import logging
import random
import time
from typing import Any

import httpx

from app.config import get_settings
from app.logging_config import log_event

logger = logging.getLogger(__name__)
USER_AGENT = "JobPilotAI/0.1 (job-discovery assistant; uses public job-board APIs)"


class ProviderError(RuntimeError):
    def __init__(self, provider: str, message: str, status: int | None = None) -> None:
        super().__init__(f"[{provider}] {message}")
        self.provider = provider
        self.status = status


class RateLimiter:
    def __init__(self, min_interval: float) -> None:
        self.min_interval = min_interval
        self._last = 0.0
        self._lock = asyncio.Lock()

    async def wait(self) -> None:
        async with self._lock:
            delta = time.monotonic() - self._last
            if delta < self.min_interval:
                await asyncio.sleep(self.min_interval - delta)
            self._last = time.monotonic()


class ProviderHttp:
    def __init__(self, provider: str, min_interval: float | None = None, max_retries: int = 3,
                 client: httpx.AsyncClient | None = None) -> None:
        settings = get_settings()
        self.provider = provider
        self.limiter = RateLimiter(settings.provider_min_interval_seconds if min_interval is None else min_interval)
        self.max_retries = max_retries
        self.cache_ttl = settings.provider_cache_seconds
        self._cache: dict[str, tuple[float, Any]] = {}
        self._client = client
        self._timeout = settings.provider_timeout_seconds

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self._timeout, headers={"User-Agent": USER_AGENT},
                                             follow_redirects=True)
        return self._client

    async def get_json(self, url: str, params: dict | None = None, use_cache: bool = True) -> Any:
        key = url + "?" + "&".join(f"{k}={v}" for k, v in sorted((params or {}).items()) if "key" not in k.lower())
        now = time.monotonic()
        if use_cache and key in self._cache and now - self._cache[key][0] < self.cache_ttl:
            return self._cache[key][1]
        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            await self.limiter.wait()
            started = time.monotonic()
            try:
                resp = await self._get_client().get(url, params=params)
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                await self._backoff(attempt, None)
                continue
            latency = int((time.monotonic() - started) * 1000)
            log_event(logger, "provider_request", provider=self.provider, status=resp.status_code, latency_ms=latency,
                      attempt=attempt)
            if resp.status_code == 429 or resp.status_code >= 500:
                last_exc = ProviderError(self.provider, f"HTTP {resp.status_code}", resp.status_code)
                await self._backoff(attempt, resp.headers.get("Retry-After"))
                continue
            if resp.status_code >= 400:
                raise ProviderError(self.provider, f"HTTP {resp.status_code} for {url.split('?')[0]}", resp.status_code)
            try:
                data = resp.json()
            except ValueError as exc:
                raise ProviderError(self.provider, "Invalid JSON response") from exc
            if use_cache:
                self._cache[key] = (time.monotonic(), data)
            return data
        raise ProviderError(self.provider, f"Request failed after retries: {last_exc}")

    async def _backoff(self, attempt: int, retry_after: str | None) -> None:
        if attempt >= self.max_retries:
            return
        delay = 2 ** attempt + random.uniform(0, 0.5)
        if retry_after and retry_after.isdigit():
            delay = max(delay, min(float(retry_after), 60))
        await asyncio.sleep(delay)

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()
            self._client = None
