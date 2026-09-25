"""Qdrant-backed vector store for job and candidate embeddings.

Qdrant is optional at runtime: if it is unreachable, callers fall back to computing cosine
similarity directly, so matching never fails because the vector DB is down.
"""

from __future__ import annotations

import logging
import uuid

from app.config import get_settings
from app.services.embeddings import DIM

logger = logging.getLogger(__name__)

JOBS = "jobs"
CANDIDATES = "candidates"


def _point_id(key: str) -> str:
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"jobpilot:{key}"))


class VectorStore:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client = None
        self._ready: set[str] = set()
        self.available = False
        if not self.settings.qdrant_enabled:
            return
        try:
            from qdrant_client import AsyncQdrantClient

            self._client = AsyncQdrantClient(
                url=self.settings.qdrant_url, api_key=self.settings.qdrant_api_key or None, timeout=10
            )
            self.available = True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Qdrant client unavailable: %s", exc)

    def _name(self, collection: str) -> str:
        return f"{self.settings.qdrant_collection_prefix}{collection}"

    async def _ensure(self, collection: str) -> bool:
        if not self.available or self._client is None:
            return False
        name = self._name(collection)
        if name in self._ready:
            return True
        from qdrant_client.models import Distance, VectorParams

        try:
            if not await self._client.collection_exists(name):
                await self._client.create_collection(name, vectors_config=VectorParams(size=DIM, distance=Distance.COSINE))
            self._ready.add(name)
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Qdrant unavailable (%s); continuing without vector store", exc)
            self.available = False
            return False

    async def upsert(self, collection: str, key: str, vector: list[float], payload: dict) -> bool:
        if not await self._ensure(collection):
            return False
        from qdrant_client.models import PointStruct

        try:
            await self._client.upsert(  # type: ignore[union-attr]
                self._name(collection), points=[PointStruct(id=_point_id(key), vector=vector, payload={**payload, "key": key})]
            )
            return True
        except Exception as exc:  # noqa: BLE001
            logger.warning("Qdrant upsert failed: %s", exc)
            return False

    async def get_vector(self, collection: str, key: str) -> list[float] | None:
        if not await self._ensure(collection):
            return None
        try:
            pts = await self._client.retrieve(self._name(collection), ids=[_point_id(key)], with_vectors=True)  # type: ignore[union-attr]
        except Exception:  # noqa: BLE001
            return None
        if not pts or pts[0].vector is None:
            return None
        vec = pts[0].vector
        if isinstance(vec, list) and vec and isinstance(vec[0], int | float):
            return [float(x) for x in vec]  # type: ignore[arg-type]
        return None

    async def get_vectors(self, collection: str, keys: list[str]) -> dict[str, list[float]]:
        """Batched retrieval (one request per 256 keys)."""
        out: dict[str, list[float]] = {}
        if not keys or not await self._ensure(collection):
            return out
        for i in range(0, len(keys), 256):
            chunk = keys[i: i + 256]
            try:
                pts = await self._client.retrieve(  # type: ignore[union-attr]
                    self._name(collection), ids=[_point_id(k) for k in chunk], with_vectors=True, with_payload=True)
            except Exception:  # noqa: BLE001
                return out
            for pt in pts:
                vec = pt.vector
                key = (pt.payload or {}).get("key")
                if key and isinstance(vec, list) and vec and isinstance(vec[0], int | float):
                    out[key] = [float(x) for x in vec]  # type: ignore[arg-type]
        return out

    async def search(self, collection: str, vector: list[float], limit: int = 50, filters: dict | None = None) -> list[tuple[str, float]]:
        if not await self._ensure(collection):
            return []
        from qdrant_client.models import FieldCondition, Filter, MatchValue

        qfilter = None
        if filters:
            qfilter = Filter(must=[FieldCondition(key=k, match=MatchValue(value=v)) for k, v in filters.items()])
        try:
            res = await self._client.query_points(  # type: ignore[union-attr]
                self._name(collection), query=vector, limit=limit, query_filter=qfilter, with_payload=True
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("Qdrant search failed: %s", exc)
            return []
        return [(p.payload.get("key", ""), float(p.score)) for p in res.points if p.payload]

    async def delete(self, collection: str, keys: list[str]) -> None:
        if not keys or not await self._ensure(collection):
            return
        from qdrant_client.models import PointIdsList

        try:
            await self._client.delete(self._name(collection), points_selector=PointIdsList(points=[_point_id(k) for k in keys]))  # type: ignore[union-attr]
        except Exception as exc:  # noqa: BLE001
            logger.warning("Qdrant delete failed: %s", exc)

    async def health(self) -> bool:
        if not self.available or self._client is None:
            return False
        try:
            await self._client.get_collections()
            return True
        except Exception:  # noqa: BLE001
            return False


_store: VectorStore | None = None


def get_vector_store() -> VectorStore:
    global _store
    if _store is None:
        _store = VectorStore()
    return _store


def set_vector_store(store: VectorStore | None) -> None:
    global _store
    _store = store
