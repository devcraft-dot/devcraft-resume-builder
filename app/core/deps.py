"""FastAPI dependencies for auth and shared route helpers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, HTTPException, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt.exceptions import ExpiredSignatureError, InvalidTokenError
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.core.db import get_db
from app.core.jwt_util import decode_access_token
from app.models.registered_profile import RegisteredProfile
from app.models.user import User
from app.models.user_profile_assignment import UserProfileAssignment

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[Session, Depends(get_db)]


def _extract_token(credentials: HTTPAuthorizationCredentials | None) -> str | None:
    if credentials is None or credentials.scheme.lower() != "bearer":
        return None
    token = (credentials.credentials or "").strip()
    return token or None


def _extract_bearer_jwt(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None,
) -> str | None:
    """Bearer from HTTPBearer, raw Authorization line, or X-Resume-Auth (SPA / proxy fallback)."""
    t = _extract_token(credentials)
    if t:
        return t
    raw = (request.headers.get("Authorization") or "").strip()
    if raw.lower().startswith("bearer "):
        return raw[7:].strip() or None
    return (request.headers.get("X-Resume-Auth") or "").strip() or None


def get_current_user(
    request: Request,
    db: DbSession,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer)
    ] = None,
) -> User:
    token = _extract_bearer_jwt(request, credentials)
    if not token:
        raise HTTPException(
            401,
            "Missing credentials. Send Authorization: Bearer <access_token> or X-Resume-Auth.",
        )
    try:
        payload = decode_access_token(token)
    except ExpiredSignatureError:
        raise HTTPException(401, "Session expired — please sign in again") from None
    except InvalidTokenError:
        raise HTTPException(401, "Invalid or expired session") from None

    try:
        uid = int(payload.get("sub") or 0)
    except (TypeError, ValueError):
        raise HTTPException(401, "Invalid or expired session") from None
    if uid <= 0:
        raise HTTPException(401, "Invalid or expired session")

    user = db.get(User, uid)
    if user is None or not user.is_active:
        raise HTTPException(401, "Invalid or expired session")
    return user


def get_current_user_optional(
    request: Request,
    db: DbSession,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(_bearer)
    ] = None,
) -> User | None:
    token = _extract_bearer_jwt(request, credentials)
    if not token:
        return None
    try:
        payload = decode_access_token(token)
    except (ExpiredSignatureError, InvalidTokenError):
        return None
    try:
        uid = int(payload.get("sub") or 0)
    except (TypeError, ValueError):
        return None
    if uid <= 0:
        return None
    user = db.get(User, uid)
    if user is None or not user.is_active:
        return None
    return user


def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]


def resolve_assigned_profile(
    user: User,
    profile_id: int,
    db: Session,
) -> RegisteredProfile:
    """Load profile only if assigned to user (admins must be assigned too)."""
    assignment = db.scalar(
        select(UserProfileAssignment)
        .options(joinedload(UserProfileAssignment.profile))
        .where(
            UserProfileAssignment.user_id == user.id,
            UserProfileAssignment.profile_id == profile_id,
        )
    )
    if assignment is None or assignment.profile is None:
        raise HTTPException(403, "Profile not assigned to this user")
    return assignment.profile
