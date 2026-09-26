"""FastAPI application entry point."""

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest

from app.api import agents, applications, auth, insights, jobs, privacy, profile, resume, system
from app.config import get_settings
from app.database import get_engine, get_sessionmaker
from app.logging_config import configure_logging, log_event, request_id_var
from app.observability import HTTP_LATENCY
from app.providers.registry import ensure_sources

logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings = get_settings()
    configure_logging(settings.log_level)
    get_engine()
    try:
        async with get_sessionmaker()() as db:
            await ensure_sources(db)
    except Exception as exc:  # noqa: BLE001 - DB may not be migrated yet
        logger.warning("could not seed job sources (run `alembic upgrade head`): %s", exc)
    stop = asyncio.Event()
    worker_task = None
    if settings.embedded_worker:
        from app.workers.worker import run_forever

        worker_task = asyncio.create_task(run_forever(stop))
    # Warm the embedding model in the background so the first match isn't slow.
    asyncio.get_running_loop().run_in_executor(None, _warm_embedder)
    yield
    stop.set()
    if worker_task:
        await asyncio.wait([worker_task], timeout=10)
    await get_engine().dispose()


def _warm_embedder() -> None:
    try:
        from app.services.embeddings import embed_text

        embed_text("warm up")
    except Exception:  # noqa: BLE001
        logger.warning("embedding warm-up failed", exc_info=True)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan,
                  docs_url="/api/docs", openapi_url="/api/openapi.json")
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=False,
                       allow_methods=["*"], allow_headers=["Authorization", "Content-Type"])

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        rid = request.headers.get("X-Request-ID") or uuid4().hex
        token = request_id_var.set(rid)
        started = time.monotonic()
        try:
            response: Response = await call_next(request)
        except Exception:
            logger.exception("unhandled error")
            response = JSONResponse({"detail": "Internal server error", "request_id": rid}, status_code=500)
        finally:
            request_id_var.reset(token)
        elapsed = time.monotonic() - started
        route = request.scope.get("route")
        path = getattr(route, "path", "unmatched")
        HTTP_LATENCY.labels(request.method, path, str(response.status_code)).observe(elapsed)
        if path not in ("/metrics", "/api/v1/health"):
            log_event(logger, "http_request", method=request.method, path=path, status=response.status_code,
                      latency_ms=int(elapsed * 1000), request_id=rid)
        response.headers["X-Request-ID"] = rid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    prefix = "/api/v1"
    for r in (auth.router, resume.router, profile.router, jobs.router, applications.router, agents.router,
              privacy.router, system.router, insights.router):
        app.include_router(r, prefix=prefix)

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)

    return app


app = create_app()
