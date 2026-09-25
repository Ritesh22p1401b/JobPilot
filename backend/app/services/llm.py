"""OpenAI-compatible LLM client (Ollama / vLLM / LM Studio / llama.cpp server).

Designed for Qwen3-8B served from Google Colab behind a tunnel:
* the base URL can be changed at runtime (Colab tunnels rotate each session);
* Qwen3 "thinking" is disabled with `/no_think` and any <think> block is stripped;
* output is parsed as JSON and validated with Pydantic, with one repair round-trip.
Raw LLM output is never trusted: callers get either a validated model or an exception.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
import time
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import get_settings
from app.logging_config import log_event
from app.services.prompts import PromptSpec

logger = logging.getLogger(__name__)
T = TypeVar("T", bound=BaseModel)


class LLMUnavailable(RuntimeError):
    pass


class LLMOutputError(RuntimeError):
    pass


def normalize_base_url(url: str) -> str:
    url = url.strip().rstrip("/")
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    for suffix in ("/chat/completions", "/completions"):
        if url.endswith(suffix):
            url = url[: -len(suffix)]
    if not url.endswith("/v1"):
        url += "/v1"
    return url


def strip_thinking(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    if "<think>" in text:  # unterminated thinking block
        text = text.split("<think>")[0]
    return text.strip()


def extract_json(text: str) -> Any:
    text = strip_thinking(text)
    fenced = re.search(r"```(?:json)?\s*(.*?)```", text, flags=re.S)
    if fenced:
        text = fenced.group(1)
    start = min((i for i in (text.find("{"), text.find("[")) if i != -1), default=-1)
    if start == -1:
        raise LLMOutputError("No JSON object in LLM output")
    depth = 0
    in_str = False
    esc = False
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    for i in range(start, len(text)):
        ch = text[i]
        if in_str:
            if esc:
                esc = False
            elif ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                candidate = text[start: i + 1]
                try:
                    return json.loads(candidate)
                except json.JSONDecodeError:
                    # common small-model issue: trailing commas
                    return json.loads(re.sub(r",\s*([}\]])", r"\1", candidate))
    raise LLMOutputError("Unterminated JSON in LLM output")


class LLMConfig(BaseModel):
    base_url: str = ""
    model: str = ""
    api_key: str = ""

    @property
    def enabled(self) -> bool:
        return bool(self.base_url)


_override: LLMConfig | None = None
_override_loaded_at = 0.0


async def _load_override() -> LLMConfig | None:
    """Runtime override stored in system_settings (key 'llm'), cached for 15s."""
    global _override, _override_loaded_at
    if time.monotonic() - _override_loaded_at < 15:
        return _override
    try:
        from app.database import get_sessionmaker
        from app.models import SystemSetting

        async with get_sessionmaker()() as db:
            row = await db.get(SystemSetting, "llm")
            _override = LLMConfig(**row.value_json) if row and row.value_json.get("base_url") else None
    except Exception:  # noqa: BLE001 - DB not ready; fall back to env
        _override = None
    _override_loaded_at = time.monotonic()
    return _override


def invalidate_override_cache() -> None:
    global _override_loaded_at
    _override_loaded_at = 0.0


async def current_config() -> LLMConfig:
    settings = get_settings()
    override = await _load_override()
    if override and override.base_url:
        return LLMConfig(base_url=normalize_base_url(override.base_url), model=override.model or settings.llm_model,
                         api_key=override.api_key or settings.llm_api_key)
    return LLMConfig(base_url=normalize_base_url(settings.llm_base_url), model=settings.llm_model,
                     api_key=settings.llm_api_key)


class LLMClient:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.settings = get_settings()
        self._transport = transport

    def _headers(self, cfg: LLMConfig) -> dict[str, str]:
        headers = {"Content-Type": "application/json", "ngrok-skip-browser-warning": "true",
                   "User-Agent": "JobPilotAI/0.1"}
        if cfg.api_key:
            headers["Authorization"] = f"Bearer {cfg.api_key}"
        return headers

    async def is_enabled(self) -> bool:
        return (await current_config()).enabled

    async def chat(self, messages: list[dict[str, str]], temperature: float = 0.1, max_tokens: int = 1200,
                   json_mode: bool = True) -> tuple[str, dict]:
        cfg = await current_config()
        if not cfg.enabled:
            raise LLMUnavailable("LLM is not configured (set LLM_BASE_URL or configure it in Settings)")
        msgs = [dict(m) for m in messages]
        if self.settings.llm_disable_thinking and msgs and msgs[-1]["role"] == "user":
            msgs[-1]["content"] += "\n/no_think"
        body: dict[str, Any] = {"model": cfg.model, "messages": msgs, "temperature": temperature,
                                "max_tokens": max_tokens, "stream": False}
        if json_mode and self.settings.llm_json_mode:
            body["response_format"] = {"type": "json_object"}
        last_exc: Exception | None = None
        for attempt in range(self.settings.llm_max_retries + 1):
            started = time.monotonic()
            try:
                async with httpx.AsyncClient(timeout=self.settings.llm_timeout_seconds, transport=self._transport) as client:
                    resp = await client.post(f"{cfg.base_url}/chat/completions", json=body, headers=self._headers(cfg))
            except (httpx.TimeoutException, httpx.TransportError) as exc:
                last_exc = exc
                await asyncio.sleep(2 ** attempt)
                continue
            latency = int((time.monotonic() - started) * 1000)
            if resp.status_code in (429, 500, 502, 503, 504):
                last_exc = LLMUnavailable(f"LLM HTTP {resp.status_code}")
                await asyncio.sleep(2 ** attempt)
                continue
            if resp.status_code == 400 and "response_format" in body:
                body.pop("response_format")  # server doesn't support JSON mode; rely on prompt + parser
                continue
            if resp.status_code >= 400:
                raise LLMUnavailable(f"LLM HTTP {resp.status_code}: {resp.text[:200]}")
            try:
                data = resp.json()
                content = data["choices"][0]["message"].get("content") or ""
            except (ValueError, KeyError, IndexError) as exc:
                raise LLMOutputError(f"Unexpected LLM response shape: {resp.text[:200]}") from exc
            usage = data.get("usage") or {}
            log_event(logger, "llm_call", model=cfg.model, latency_ms=latency,
                      prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"))
            return content, {"model": cfg.model, "latency_ms": latency, "usage": usage}
        raise LLMUnavailable(f"LLM request failed after retries: {last_exc}")

    async def structured(self, prompt: PromptSpec, schema: type[T], **variables: str) -> tuple[T, dict]:
        messages = prompt.render(**variables)
        content, meta = await self.chat(messages, temperature=prompt.temperature, max_tokens=prompt.max_tokens)
        meta["prompt_version"] = prompt.id
        try:
            return schema.model_validate(extract_json(content)), meta
        except (LLMOutputError, ValidationError, json.JSONDecodeError) as first_error:
            repair = [*messages, {"role": "assistant", "content": strip_thinking(content)[:4000]}, {"role": "user", "content": f"That output was invalid ({str(first_error)[:300]}). " "Return ONLY the corrected JSON object matching the schema."}]
            content2, meta2 = await self.chat(repair, temperature=0.0, max_tokens=prompt.max_tokens)
            meta["latency_ms"] += meta2["latency_ms"]
            meta["repaired"] = True
            try:
                return schema.model_validate(extract_json(content2)), meta
            except (LLMOutputError, ValidationError, json.JSONDecodeError) as exc:
                raise LLMOutputError(f"LLM output failed validation for {prompt.id}: {exc}") from exc

    async def health(self) -> dict:
        cfg = await current_config()
        if not cfg.enabled:
            return {"configured": False, "reachable": False, "model": cfg.model, "base_url": None}
        info: dict[str, Any] = {"configured": True, "base_url": cfg.base_url, "model": cfg.model}
        try:
            async with httpx.AsyncClient(timeout=15, transport=self._transport) as client:
                resp = await client.get(f"{cfg.base_url}/models", headers=self._headers(cfg))
            info["reachable"] = resp.status_code == 200
            if resp.status_code == 200:
                models = [m.get("id") for m in resp.json().get("data", [])]
                info["available_models"] = models
                info["model_loaded"] = cfg.model in models or not models
            else:
                info["error"] = f"HTTP {resp.status_code}"
        except Exception as exc:  # noqa: BLE001
            info["reachable"] = False
            info["error"] = str(exc)[:200]
        return info


_client: LLMClient | None = None


def get_llm() -> LLMClient:
    global _client
    if _client is None:
        _client = LLMClient()
    return _client


def set_llm(client: LLMClient | None) -> None:
    global _client
    _client = client
