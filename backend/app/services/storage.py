"""Private local object storage for resumes and generated documents (outside any web root)."""

from __future__ import annotations

import hashlib
import shutil
from pathlib import Path
from uuid import uuid4

from app.config import get_settings


def _root() -> Path:
    root = Path(get_settings().storage_dir).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def save_bytes(user_id: str, kind: str, data: bytes, extension: str) -> str:
    """Store bytes under <storage>/<user>/<kind>/<uuid>.<ext>. Returns a storage-relative path."""
    ext = extension.lower().lstrip(".")
    if ext not in {"pdf", "docx", "txt", "json"}:
        raise ValueError("Unsupported extension")
    rel = Path(user_id) / kind / f"{uuid4().hex}.{ext}"
    path = _root() / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return rel.as_posix()


def read_bytes(rel_path: str) -> bytes:
    path = (_root() / rel_path).resolve()
    if _root() not in path.parents:
        raise PermissionError("Invalid storage path")
    return path.read_bytes()


def delete_user_files(user_id: str) -> None:
    path = (_root() / user_id).resolve()
    if path.exists() and _root() in path.parents:
        shutil.rmtree(path, ignore_errors=True)


def delete_file(rel_path: str | None) -> None:
    if not rel_path:
        return
    path = (_root() / rel_path).resolve()
    if _root() in path.parents and path.exists():
        path.unlink(missing_ok=True)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()
