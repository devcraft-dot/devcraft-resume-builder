"""JWT access tokens for dashboard + extensions."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import jwt

from app.core.config import settings


def create_access_token(*, user_id: int, role: str, display_name: str) -> str:
    secret = (settings.jwt_secret_key or "").strip()
    if not secret:
        raise RuntimeError("JWT_SECRET_KEY is not set")
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": str(user_id),
        "role": role,
        "name": display_name,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    secret = (settings.jwt_secret_key or "").strip()
    if not secret:
        raise jwt.InvalidTokenError("JWT_SECRET_KEY is not set")
    return jwt.decode(token, secret, algorithms=["HS256"])
