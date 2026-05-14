from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import admin_emails_set, auth_enabled, get_current_user_optional
from app.core.security import create_access_token, hash_password, verify_password
from app.models.generation import Generation
from app.models.user import User
from app.schemas.auth import (
    AuthConfigResponse,
    LoginRequest,
    MeResponse,
    RegisterRequest,
    TokenResponse,
    UserPublic,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["auth"])


@router.get("/auth/config", response_model=AuthConfigResponse)
def auth_config() -> AuthConfigResponse:
    return AuthConfigResponse(auth_required=auth_enabled())


@router.post("/auth/register", response_model=TokenResponse)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if not auth_enabled():
        raise HTTPException(
            400,
            "Registration is disabled until JWT_SECRET is set on the server.",
        )
    email = payload.email.strip().lower()
    if db.scalar(select(User.id).where(User.email == email)):
        raise HTTPException(409, "Email already registered")
    n_users = int(db.scalar(select(func.count()).select_from(User)) or 0)
    admins = admin_emails_set()
    is_admin = (n_users == 0) or (email in admins)
    user = User(email=email, password_hash=hash_password(payload.password), is_admin=is_admin)
    db.add(user)
    db.commit()
    db.refresh(user)
    logger.info("registered user id=%s email=%s is_admin=%s", user.id, user.email, user.is_admin)
    token = create_access_token(user_id=user.id, email=user.email, is_admin=user.is_admin)
    return TokenResponse(
        access_token=token,
        user=UserPublic.model_validate(user),
    )


@router.post("/auth/login", response_model=TokenResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> TokenResponse:
    if not auth_enabled():
        raise HTTPException(
            400,
            "Login is disabled until JWT_SECRET is set on the server.",
        )
    email = payload.email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(401, "Invalid email or password")
    token = create_access_token(user_id=user.id, email=user.email, is_admin=user.is_admin)
    return TokenResponse(
        access_token=token,
        user=UserPublic.model_validate(user),
    )


@router.get("/me", response_model=MeResponse)
def me(
    db: Session = Depends(get_db),
    user: User | None = Depends(get_current_user_optional),
) -> MeResponse:
    if not auth_enabled() or user is None:
        raise HTTPException(401, "Authentication required")
    cnt = int(
        db.scalar(select(func.count()).select_from(Generation).where(Generation.user_id == user.id)) or 0
    )
    return MeResponse(email=user.email, is_admin=user.is_admin, generation_count=cnt)
