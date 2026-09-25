# No `from __future__ import annotations` here: FastAPI must resolve the Request annotation
# on RateLimiter.__call__ at runtime.
import time
from collections import defaultdict, deque

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models import CandidateProfile, User
from app.security import decode_access_token
from app.services.repository import get_candidate

bearer = HTTPBearer(auto_error=False)


async def current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                       db: AsyncSession = Depends(get_db)) -> User:
    if creds is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated", headers={"WWW-Authenticate": "Bearer"})
    user_id = decode_access_token(creds.credentials)
    user = await db.get(User, user_id) if user_id else None
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired token", headers={"WWW-Authenticate": "Bearer"})
    return user


async def current_candidate(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> CandidateProfile:
    candidate = await get_candidate(db, user.id)
    if candidate is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "Upload a resume first to create your candidate profile.")
    return candidate


class RateLimiter:
    """In-memory sliding-window limiter (per client IP + bucket). Suitable for a single-process deployment."""

    def __init__(self, limit: int, window_seconds: int, bucket: str) -> None:
        self.limit = limit
        self.window = window_seconds
        self.bucket = bucket
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    async def __call__(self, request: Request) -> None:
        key = f"{self.bucket}:{request.client.host if request.client else 'unknown'}"
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > self.window:
            q.popleft()
        if len(q) >= self.limit:
            raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests; slow down.",
                                headers={"Retry-After": str(self.window)})
        q.append(now)


auth_limiter = RateLimiter(20, 60, "auth")
upload_limiter = RateLimiter(20, 60, "upload")
agent_limiter = RateLimiter(30, 60, "agents")
