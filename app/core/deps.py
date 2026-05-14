from __future__ import annotations

from fastapi import Depends, Header, HTTPException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.security import decode_access_token
from app.models.user import User


def auth_enabled() -> bool:
    """When True, protected routes require a valid Bearer JWT (signed with JWT_SECRET)."""
    return bool((settings.jwt_secret or "").strip())


def _admin_email_set() -> set[str]:
    raw = (settings.admin_emails or "").strip()
    if not raw:
        return set()
    return {p.strip().lower() for p in raw.split(",") if p.strip()}


def admin_emails_set() -> set[str]:
    return _admin_email_set()


def get_current_user_optional(
    authorization: str | None = Header(None, alias="Authorization"),
    db: Session = Depends(get_db),
) -> User | None:
    """Identify user from JWT only — no session store."""
    if not auth_enabled():
        return None
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    try:
        payload = decode_access_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from None
    sub = payload.get("sub")
    if not sub:
        raise HTTPException(status_code=401, detail="Invalid token payload")
    try:
        uid = int(sub)
    except (TypeError, ValueError):
        raise HTTPException(status_code=401, detail="Invalid token subject")
    user = db.get(User, uid)
    if not user:
        raise HTTPException(status_code=401, detail="User no longer exists")
    return user


def ensure_generation_owner(gen_user_id: int | None, user: User | None) -> None:
    """Raise 403 if a non-admin tries to access another user's row (when auth is on)."""
    if not auth_enabled() or user is None:
        return
    if user.is_admin:
        return
    if gen_user_id is None or gen_user_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed for this generation")
