"""Test configuration.

Default: isolated SQLite database per test, deterministic hash embeddings, no Qdrant, no real LLM.
Set TEST_DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/jobpilot_test to run
the same suite against PostgreSQL.
"""

from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="jobpilot_test_"))
os.environ.update({
    "APP_ENV": "test",
    "EMBEDDING_BACKEND": "hash",
    "QDRANT_ENABLED": "false",
    "LLM_BASE_URL": "",
    "LLM_PROVIDER": "qwen",
    "GEMINI_API_KEY": "",  # never call the real Gemini API from tests
    "EMBEDDED_WORKER": "false",
    "JWT_SECRET": "test-secret-for-unit-tests-only-0123456789",
    "STORAGE_DIR": str(_TMP / "storage"),
    "ADZUNA_APP_ID": "",
    "ADZUNA_APP_KEY": "",
    "GREENHOUSE_BOARD_API_KEYS": "{}",
    "LEVER_POSTING_API_KEYS": "{}",
    "PROVIDER_MIN_INTERVAL_SECONDS": "0",
    "LOG_LEVEL": "WARNING",
})
TEST_DB_URL = os.environ.get("TEST_DATABASE_URL") or f"sqlite+aiosqlite:///{(_TMP / 'test.db').as_posix()}"
os.environ["DATABASE_URL"] = TEST_DB_URL
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import httpx
import pytest
import pytest_asyncio
from pydantic import BaseModel

import app.models  # noqa: F401
from app.database import Base, configure_engine, get_engine
from app.services import llm as llm_module
from app.services.embeddings import HashEmbedder, set_embedder

FIXTURES = Path(__file__).parent / "fixtures"
set_embedder(HashEmbedder())


@pytest.fixture(autouse=True)
def _ignore_developer_env_files(monkeypatch):
    """Tests never pick up a developer's real .env (e.g. a Colab LLM URL) through the LLM hot reload."""
    monkeypatch.setattr(llm_module, "_env_files", lambda: [])
    monkeypatch.setattr(llm_module, "_env_mtimes", None)


@pytest.fixture
def sample_resume_text() -> str:
    return (FIXTURES / "sample_resume.txt").read_text(encoding="utf-8")


@pytest.fixture
def sample_jd_text() -> str:
    return (FIXTURES / "sample_jd.txt").read_text(encoding="utf-8")


@pytest_asyncio.fixture
async def db_engine():
    configure_engine(TEST_DB_URL)
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db(db_engine):
    from app.database import get_sessionmaker

    async with get_sessionmaker()() as session:
        yield session


@pytest_asyncio.fixture
async def client(db_engine):
    from app.main import create_app

    application = create_app()
    transport = httpx.ASGITransport(app=application)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


async def register(client: httpx.AsyncClient, email: str = "user@example.com", password: str = "Sup3rSecret!") -> dict:
    r = await client.post("/api/v1/auth/register", json={"email": email, "password": password})
    assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class FakeLLM(llm_module.LLMClient):
    """Deterministic stand-in for Qwen3. `responses` maps prompt name -> dict (or callable(vars) -> dict)."""

    def __init__(self, responses: dict | None = None, enabled: bool = True) -> None:
        super().__init__()
        self.responses = responses or {}
        self.enabled = enabled
        self.calls: list[tuple[str, dict]] = []

    async def is_enabled(self) -> bool:
        return self.enabled

    async def structured(self, prompt, schema: type[BaseModel], **variables):  # type: ignore[override]
        self.calls.append((prompt.name, variables))
        if not self.enabled:
            raise llm_module.LLMUnavailable("disabled")
        resp = self.responses.get(prompt.name)
        if resp is None:
            raise llm_module.LLMUnavailable(f"no fake response for {prompt.name}")
        data = resp(variables) if callable(resp) else resp
        return schema.model_validate(data), {"model": "fake-qwen3", "latency_ms": 1, "usage": {"total_tokens": 10},
                                             "prompt_version": prompt.id}

    async def health(self) -> dict:
        return {"configured": self.enabled, "reachable": self.enabled, "model": "fake-qwen3"}


@pytest.fixture
def fake_llm():
    fake = FakeLLM()
    llm_module.set_llm(fake)
    yield fake
    llm_module.set_llm(None)


@pytest.fixture(autouse=True)
def _reset_llm():
    llm_module.set_llm(llm_module.LLMClient())
    yield
    llm_module.set_llm(None)
