from __future__ import annotations

import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

from app.core.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def create_access_token(*, user_id: int, email: str, is_admin: bool) -> str:
    """Stateless JWT — no server session; client sends Bearer token on each request."""
    secret = (settings.jwt_secret or "").strip()
    if not secret:
        raise ValueError("JWT_SECRET is not configured")
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=max(5, int(settings.jwt_expire_minutes or 10080)))
    payload = {
        "sub": str(user_id),
        "email": email,
        "adm": bool(is_admin),
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    secret = (settings.jwt_secret or "").strip()
    if not secret:
        raise ValueError("JWT_SECRET is not configured")
    return jwt.decode(token, secret, algorithms=["HS256"])
