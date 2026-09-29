"""OpenAI-compatible LLM client with two switchable providers.

* "qwen": Qwen3-8B (Ollama / vLLM / LM Studio / llama.cpp) served from Google Colab behind a tunnel.
* "gemini": Google Gemini through its OpenAI-compatible endpoint, so prompts, JSON validation and the rules
  fallback are identical for both.

The provider (LLM_PROVIDER) and the LLM_* / GEMINI_* values can change at runtime: either in Settings, or by
editing backend/.env, which is re-read when the file changes (no restart). Colab tunnels rotate each session.
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
from pathlib import Path
from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.config import Settings, get_settings
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


PROVIDERS = ("qwen", "gemini")


class LLMConfig(BaseModel):
    provider: str = "qwen"
    base_url: str = ""
    model: str = ""
    api_key: str = ""
    reasoning_effort: str = ""  # Gemini only
    source: str = "env"  # "settings" (runtime override saved in the app) or "env" (environment / .env file)

    @property
    def enabled(self) -> bool:
        # Gemini can't be called without a key; a local Qwen server may not need one.
        return bool(self.base_url) and (self.provider != "gemini" or bool(self.api_key))


def normalize_provider(value: str | None) -> str:
    value = (value or "").strip().lower()
    return value if value in PROVIDERS else "qwen"


_LLM_ENV_FIELDS = ("llm_base_url", "llm_api_key", "llm_model", "llm_provider", "gemini_api_key", "gemini_model",
                   "gemini_base_url", "gemini_reasoning_effort")
_env_mtimes: tuple[float, ...] | None = None


def _env_files() -> list[Path]:
    files = get_settings().model_config.get("env_file") or ()
    return [Path(f) for f in (files if isinstance(files, tuple | list) else (files,))]


def _refresh_env_llm() -> None:
    """Pick up LLM_* edits in the .env files without a restart (Colab tunnel URLs change every session).

    Only the LLM fields are reloaded, and only when a .env file's modification time changes. Real environment
    variables still take precedence over the files, as at startup.
    """
    global _env_mtimes
    files = _env_files()
    mtimes: list[float] = []
    for f in files:
        try:
            mtimes.append(f.stat().st_mtime)
        except OSError:
            mtimes.append(0.0)
    current = tuple(mtimes)
    if _env_mtimes is None:
        _env_mtimes = current  # baseline: startup already read these files
        return
    if current == _env_mtimes:
        return
    _env_mtimes = current
    try:
        fresh = Settings(_env_file=tuple(str(f) for f in files))  # type: ignore[call-arg]
    except Exception:  # noqa: BLE001 - a half-saved .env must not break LLM calls; keep the previous values
        logger.warning("Could not re-read .env; keeping the previous LLM settings")
        return
    settings = get_settings()
    changed = [name for name in _LLM_ENV_FIELDS if getattr(settings, name) != getattr(fresh, name)]
    for name in changed:
        setattr(settings, name, getattr(fresh, name))
    if changed:
        log_event(logger, "llm.env_reloaded", fields=changed)  # names only, never values


_override: dict[str, Any] | None = None
_override_loaded_at = 0.0


async def _load_override() -> dict[str, Any] | None:
    """Runtime override in system_settings (key 'llm'): a provider choice and/or a Qwen URL. Cached for 15s."""
    global _override, _override_loaded_at
    if time.monotonic() - _override_loaded_at < 15:
        return _override
    try:
        from app.database import get_sessionmaker
        from app.models import SystemSetting

        async with get_sessionmaker()() as db:
            row = await db.get(SystemSetting, "llm")
            value = dict(row.value_json or {}) if row else {}
            _override = value if value.get("base_url") or value.get("provider") else None
    except Exception:  # noqa: BLE001 - DB not ready; fall back to env
        _override = None
    _override_loaded_at = time.monotonic()
    return _override


def invalidate_override_cache() -> None:
    global _override_loaded_at
    _override_loaded_at = 0.0


def gemini_config(settings: Settings, source: str = "env") -> LLMConfig:
    return LLMConfig(provider="gemini", base_url=settings.gemini_base_url.strip().rstrip("/"),
                     model=settings.gemini_model.strip(), api_key=settings.gemini_api_key.strip(),
                     reasoning_effort=settings.gemini_reasoning_effort.strip(), source=source)


def qwen_config(settings: Settings, override: dict[str, Any] | None = None, source: str = "env") -> LLMConfig:
    if override and override.get("base_url"):
        return LLMConfig(provider="qwen", base_url=normalize_base_url(override["base_url"]),
                         model=override.get("model") or settings.llm_model,
                         api_key=override.get("api_key") or settings.llm_api_key, source="settings")
    return LLMConfig(provider="qwen", base_url=normalize_base_url(settings.llm_base_url), model=settings.llm_model,
                     api_key=settings.llm_api_key, source=source)


async def current_config() -> LLMConfig:
    """A provider chosen in Settings wins over LLM_PROVIDER; a Qwen URL saved in Settings wins over LLM_BASE_URL."""
    _refresh_env_llm()
    settings = get_settings()
    override = await _load_override()
    chosen = normalize_provider(override.get("provider")) if override and override.get("provider") else None
    provider = chosen or normalize_provider(settings.llm_provider)
    source = "settings" if chosen else "env"
    if provider == "gemini":
        return gemini_config(settings, source)
    return qwen_config(settings, override, source)


def provider_summary(settings: Settings, override: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    """What each provider would use (never the keys), so the UI can offer the switch."""
    qwen, gemini = qwen_config(settings, override), gemini_config(settings)
    return {
        "qwen": {"configured": qwen.enabled, "model": qwen.model},
        "gemini": {"configured": gemini.enabled, "model": gemini.model},
    }


MAX_RETRY_DELAY_SECONDS = 60.0


def retry_delay(resp: httpx.Response, attempt: int) -> float:
    """How long to wait before retrying a 429/5xx: the server's own hint when it gives one, else backoff.

    Rate limits are honoured, never worked around: a Retry-After header or Gemini's `"retryDelay": "32s"` wins over
    the default 1s, 2s, 4s… backoff (capped so a background agent isn't stuck for long).
    """
    hint: float | None = None
    header = resp.headers.get("retry-after", "").strip()
    if header.replace(".", "", 1).isdigit():
        hint = float(header)
    else:
        match = re.search(r'"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"', resp.text[:5000])
        if match:
            hint = float(match.group(1))
    return min(hint if hint is not None else float(2 ** attempt), MAX_RETRY_DELAY_SECONDS)


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
            hint = "set GEMINI_API_KEY" if cfg.provider == "gemini" else "set LLM_BASE_URL or configure it in Settings"
            raise LLMUnavailable(f"LLM is not configured ({hint})")
        msgs = [dict(m) for m in messages]
        if cfg.provider == "qwen" and self.settings.llm_disable_thinking and msgs and msgs[-1]["role"] == "user":
            msgs[-1]["content"] += "\n/no_think"
        body: dict[str, Any] = {"model": cfg.model, "messages": msgs, "temperature": temperature,
                                "max_tokens": max_tokens, "stream": False}
        if cfg.provider == "gemini" and cfg.reasoning_effort:
            # Gemini's thinking tokens count against max_tokens; a low budget leaves room for the JSON answer.
            body["reasoning_effort"] = cfg.reasoning_effort
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
                if attempt < self.settings.llm_max_retries:
                    await asyncio.sleep(retry_delay(resp, attempt))
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
            log_event(logger, "llm_call", provider=cfg.provider, model=cfg.model, latency_ms=latency,
                      prompt_tokens=usage.get("prompt_tokens"), completion_tokens=usage.get("completion_tokens"))
            return content, {"model": cfg.model, "provider": cfg.provider, "latency_ms": latency, "usage": usage}
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
        common = {"provider": cfg.provider, "model": cfg.model, "source": cfg.source,
                  "providers": provider_summary(get_settings(), await _load_override())}
        if not cfg.enabled:
            return {**common, "configured": False, "reachable": False, "base_url": None}
        info: dict[str, Any] = {**common, "configured": True, "base_url": cfg.base_url}
        try:
            async with httpx.AsyncClient(timeout=15, transport=self._transport) as client:
                resp = await client.get(f"{cfg.base_url}/models", headers=self._headers(cfg))
            info["reachable"] = resp.status_code == 200
            if resp.status_code == 200:
                # Gemini lists ids as "models/gemini-…"; compare without the prefix.
                models = [str(m.get("id", "")).removeprefix("models/") for m in resp.json().get("data", [])]
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
