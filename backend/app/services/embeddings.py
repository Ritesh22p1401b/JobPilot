"""Text embeddings.

Backends:
* fastembed – ONNX BAAI/bge-small-en-v1.5 (384-d), runs locally on CPU, no torch required.
* hash      – deterministic hashed bag-of-words/char-trigram vectors. Used in tests and as an
              automatic fallback if the model cannot be loaded (e.g. offline first run).
"""

from __future__ import annotations

import hashlib
import itertools
import logging
import math
import re
import threading
from collections import OrderedDict

import numpy as np

from app.config import get_settings

logger = logging.getLogger(__name__)
DIM = 384


class HashEmbedder:
    name = "hash-384"
    dim = DIM

    def embed(self, texts: list[str]) -> list[list[float]]:
        return [self._one(t) for t in texts]

    def _one(self, text: str) -> list[float]:
        vec = [0.0] * DIM
        tokens = re.findall(r"[a-z0-9+#.]+", text.lower())
        feats = tokens + [f"{a} {b}" for a, b in itertools.pairwise(tokens)]
        for tok in tokens:
            padded = f" {tok} "
            feats.extend(padded[i: i + 3] for i in range(len(padded) - 2))
        for f in feats:
            h = int(hashlib.md5(f.encode()).hexdigest(), 16)
            vec[h % DIM] += 1.0 if (h >> 9) & 1 else -1.0
        norm = math.sqrt(sum(v * v for v in vec)) or 1.0
        return [v / norm for v in vec]


class FastEmbedder:
    dim = DIM

    def __init__(self, model_name: str) -> None:
        from fastembed import TextEmbedding

        self.name = model_name
        self._model = TextEmbedding(model_name=model_name)
        self._lock = threading.Lock()

    def embed(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            return [list(map(float, v)) for v in self._model.embed(texts)]


_embedder: HashEmbedder | FastEmbedder | None = None
_embedder_lock = threading.Lock()


def get_embedder() -> HashEmbedder | FastEmbedder:
    global _embedder
    if _embedder is not None:
        return _embedder
    with _embedder_lock:
        if _embedder is None:
            settings = get_settings()
            if settings.embedding_backend == "fastembed":
                try:
                    _embedder = FastEmbedder(settings.embedding_model)
                except Exception as exc:  # noqa: BLE001 - model download/load failures
                    logger.warning("fastembed unavailable (%s); falling back to hash embeddings", exc)
                    _embedder = HashEmbedder()
            else:
                _embedder = HashEmbedder()
    return _embedder


def set_embedder(embedder: HashEmbedder | FastEmbedder | None) -> None:
    global _embedder
    _embedder = embedder
    with _cache_lock:
        _cache.clear()


MAX_CHARS = 2000  # bge-small truncates at 512 tokens; longer input only costs tokenisation time
_CACHE_SIZE = 20000
_cache: OrderedDict[str, list[float]] = OrderedDict()
_cache_lock = threading.Lock()


def _key(text: str) -> str:
    return text[:MAX_CHARS]


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed many texts with an LRU cache; cache misses are embedded in a single batched model call."""
    keys = [_key(t) for t in texts]
    with _cache_lock:
        missing = list(dict.fromkeys(k for k in keys if k not in _cache))
    if missing:
        vectors = get_embedder().embed(missing)
        with _cache_lock:
            for k, v in zip(missing, vectors, strict=True):
                _cache[k] = v
            while len(_cache) > _CACHE_SIZE:
                _cache.popitem(last=False)
    with _cache_lock:
        out = []
        for k in keys:
            vec = _cache.get(k)
            if vec is None:  # evicted between batches (only under extreme load)
                vec = get_embedder().embed([k])[0]
            else:
                _cache.move_to_end(k)
            out.append(vec)
    return out


def embed_text(text: str) -> list[float]:
    return embed_texts([text])[0]


def cosine(a: list[float], b: list[float]) -> float:
    va, vb = np.asarray(a, dtype=np.float32), np.asarray(b, dtype=np.float32)
    denom = float(np.linalg.norm(va) * np.linalg.norm(vb)) or 1.0
    return float(va @ vb) / denom


def similarity(a: str, b: str) -> float:
    if not a.strip() or not b.strip():
        return 0.0
    va, vb = embed_texts([a, b])
    return cosine(va, vb)


def most_similar(query: str, candidates: list[str]) -> tuple[int, float] | None:
    """Index and cosine of the candidate most similar to `query` (one batched lookup, vectorised)."""
    cands = [c for c in candidates]
    if not query.strip() or not cands:
        return None
    vecs = embed_texts([query, *cands])
    q = np.asarray(vecs[0], dtype=np.float32)
    m = np.asarray(vecs[1:], dtype=np.float32)
    norms = np.linalg.norm(m, axis=1) * (np.linalg.norm(q) or 1.0)
    sims = (m @ q) / np.where(norms == 0, 1.0, norms)
    i = int(np.argmax(sims))
    return i, float(sims[i])
