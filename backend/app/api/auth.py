from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import auth_limiter, current_user
from app.database import get_db
from app.models import User
from app.security import create_access_token, hash_password, verify_password
from app.services.repository import audit, get_candidate

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: dict


@router.post("/register", response_model=TokenOut, status_code=201, dependencies=[Depends(auth_limiter)])
async def register(body: Credentials, db: AsyncSession = Depends(get_db)) -> TokenOut:
    email = body.email.lower()
    if (await db.execute(select(User).where(User.email == email))).scalars().first():
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    user = User(email=email, password_hash=hash_password(body.password))
    db.add(user)
    await db.flush()
    await audit(db, user.id, "user.registered")
    await db.commit()
    return TokenOut(access_token=create_access_token(user.id), user={"id": user.id, "email": user.email})


@router.post("/login", response_model=TokenOut, dependencies=[Depends(auth_limiter)])
async def login(body: Credentials, db: AsyncSession = Depends(get_db)) -> TokenOut:
    user = (await db.execute(select(User).where(User.email == body.email.lower()))).scalars().first()
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    await audit(db, user.id, "user.login")
    await db.commit()
    return TokenOut(access_token=create_access_token(user.id), user={"id": user.id, "email": user.email})


@router.get("/me")
async def me(user: User = Depends(current_user), db: AsyncSession = Depends(get_db)) -> dict:
    candidate = await get_candidate(db, user.id)
    return {"id": user.id, "email": user.email, "has_profile": candidate is not None,
            "candidate_id": candidate.id if candidate else None}
