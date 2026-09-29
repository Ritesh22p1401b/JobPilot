"""Application configuration loaded from environment variables / .env."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

BACKEND_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = BACKEND_DIR.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(str(REPO_DIR / ".env"), str(BACKEND_DIR / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_env: str = "development"
    app_name: str = "JobPilot AI"
    log_level: str = "INFO"
    cors_origins: Annotated[list[str], NoDecode] = ["http://localhost:3000", "http://127.0.0.1:3000"]

    database_url: str = "postgresql+asyncpg://postgres:postgres@127.0.0.1:5432/jobpilot"
    sql_echo: bool = False

    # Auth
    jwt_secret: str = Field(default="", description="HMAC secret for JWT signing")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 60 * 24

    # Storage
    storage_dir: Path = BACKEND_DIR / "storage"
    max_upload_bytes: int = 5 * 1024 * 1024

    # LLM (OpenAI-compatible endpoint, e.g. Ollama / vLLM running Qwen3-8B on Colab)
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "qwen3:8b"
    llm_timeout_seconds: float = 180.0
    llm_max_retries: int = 2
    llm_disable_thinking: bool = True
    llm_json_mode: bool = True
    llm_max_jobs_per_run: int = 10
    # Which LLM answers: "qwen" (the OpenAI-compatible LLM_* endpoint above) or "gemini" (GEMINI_* below).
    llm_provider: str = "qwen"

    # Google Gemini through its OpenAI-compatible endpoint (same client, prompts and validation as Qwen)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta/openai"
    gemini_reasoning_effort: str = "low"  # thinking budget: none | minimal | low | medium | high ("" = model default)

    # Embeddings / vectors
    embedding_backend: str = "fastembed"  # fastembed | hash
    embedding_model: str = "BAAI/bge-small-en-v1.5"
    qdrant_url: str = "http://127.0.0.1:6333"  # 127.0.0.1, not localhost: avoids a slow IPv6 attempt on Windows
    qdrant_api_key: str = ""
    qdrant_collection_prefix: str = "jobpilot_"
    qdrant_enabled: bool = True

    # Job providers
    greenhouse_enabled: bool = True
    # Employer board tokens verified live 2026-09; editable at runtime via /api/v1/sources.
    greenhouse_boards: Annotated[list[str], NoDecode] = ["groww", "hackerrank", "gitlab", "databricks", "cloudflare", "stripe", "figma",
                                    "anthropic", "mongodb", "elastic", "datadog", "okta", "coinbase", "twilio"]
    lever_enabled: bool = True
    lever_sites: Annotated[list[str], NoDecode] = ["meesho", "cred", "zeta", "paytm", "palantir", "spotify"]
    adzuna_enabled: bool = True
    adzuna_app_id: str = ""
    adzuna_app_key: str = ""
    adzuna_country: str = "in"
    provider_timeout_seconds: float = 20.0
    provider_min_interval_seconds: float = 1.0
    provider_cache_seconds: int = 1800

    # Authorized application submission (employer-controlled keys only)
    greenhouse_board_api_keys: dict[str, str] = {}
    lever_posting_api_keys: dict[str, str] = {}

    # Workers
    embedded_worker: bool = True
    worker_poll_seconds: float = 1.0
    scheduler_interval_seconds: int = 60

    # Notifications (optional SMTP)
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    @field_validator("cors_origins", "greenhouse_boards", "lever_sites", mode="before")
    @classmethod
    def _split_csv(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip().startswith("["):
            return [v.strip() for v in value.split(",") if v.strip()]
        return value

    @property
    def is_production(self) -> bool:
        return self.app_env.lower() == "production"

    def effective_jwt_secret(self) -> str:
        if self.jwt_secret:
            return self.jwt_secret
        if self.is_production:
            raise RuntimeError("JWT_SECRET must be set in production")
        return "dev-insecure-secret-change-me-please-0123456789"


@lru_cache
def get_settings() -> Settings:
    return Settings()
