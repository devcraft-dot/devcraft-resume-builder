"""Username + password login; returns JWT for Bearer auth."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.core.bootstrap import bootstrap_admin_if_needed
from app.core.deps import DbSession
from app.core.jwt_util import create_access_token
from app.core.passwords import verify_password
from app.models.user import User
from app.schemas.auth import LoginRequest, MeRead, TokenResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: DbSession) -> TokenResponse:
    bootstrap_admin_if_needed()
    uname = payload.username.strip().lower()
    if not uname:
        raise HTTPException(401, "Invalid username or password")

    user = db.scalar(select(User).where(User.username == uname))
    if user is None or not user.is_active:
        raise HTTPException(401, "Invalid username or password")
    if not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid username or password")

    try:
        access = create_access_token(
            user_id=user.id, role=user.role, display_name=user.display_name
        )
    except RuntimeError as exc:
        raise HTTPException(503, str(exc)) from exc

    return TokenResponse(access_token=access, user=MeRead.model_validate(user))
