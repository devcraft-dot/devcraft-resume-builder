from __future__ import annotations

import bcrypt
import jwt
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from app.core.config import settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, password_hash: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("utf-8"))
    except Exception:
        return False


def _jwt_secret() -> str:
    s = (settings.jwt_secret or "").strip()
    if not s:
        raise ValueError("JWT_SECRET is not configured")
    return s


def create_extension_access_token(*, username: str, profile_names: list[str]) -> str:
    """JWT for extension: typ=ext, sub=client username, prf=sorted allowed profile names (no session)."""
    secret = _jwt_secret()
    now = datetime.now(timezone.utc)
    exp = now + timedelta(minutes=max(5, int(settings.jwt_expire_minutes or 10080)))
    names = sorted({(n or "").strip() for n in profile_names if (n or "").strip()})[:80]
    if not names:
        raise ValueError("profile_names must be non-empty")
    if len((username or "").strip()) < 1:
        raise ValueError("username required")
    un = (username or "").strip()[:200]
    payload = {
        "typ": "ext",
        "sub": un,
        "prf": names,
        "iat": int(now.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    return jwt.decode(token, _jwt_secret(), algorithms=["HS256"])


def decode_extension_principal(token: str) -> tuple[str, frozenset[str]]:
    """Return (username, allowed profile names). Raises HTTPException on bad token."""
    try:
        d = decode_access_token(token)
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc
    if d.get("typ") != "ext":
        raise HTTPException(status_code=401, detail="Invalid token type")
    sub = d.get("sub")
    prf = d.get("prf")
    if not isinstance(sub, str) or not sub.strip():
        raise HTTPException(status_code=401, detail="Invalid token subject")
    if not isinstance(prf, list) or not prf:
        raise HTTPException(status_code=401, detail="Invalid token profiles")
    names = frozenset(str(x).strip() for x in prf if str(x).strip())
    if not names:
        raise HTTPException(status_code=401, detail="Empty profiles in token")
    return sub.strip(), names
