from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, Header, HTTPException

from app.core.config import settings
from app.core.security import decode_extension_principal


def auth_enabled() -> bool:
    return bool((settings.jwt_secret or "").strip())


def admin_key_valid(x_admin_key: str | None) -> bool:
    expected = (settings.admin_api_key or "").strip()
    if not expected:
        return False
    return (x_admin_key or "").strip() == expected


@dataclass(frozen=True)
class ExtensionCaller:
    """Decoded extension JWT: client username + profile names allowed for this token."""

    username: str
    profile_names: frozenset[str]


def get_extension_caller(
    authorization: str | None = Header(None, alias="Authorization"),
) -> ExtensionCaller | None:
    if not auth_enabled():
        return None
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    if not token:
        return None
    username, names = decode_extension_principal(token)
    return ExtensionCaller(username=username, profile_names=names)


@dataclass(frozen=True)
class ApiAccess:
    extension: ExtensionCaller | None
    is_admin: bool


def require_extension_or_admin(
    authorization: str | None = Header(None, alias="Authorization"),
    x_admin_key: str | None = Header(None, alias="X-Admin-Key"),
) -> ApiAccess:
    """
    When auth is enabled: require either valid X-Admin-Key (dashboard) or Bearer extension JWT.
    """
    if not auth_enabled():
        # JWT off: still honor X-Admin-Key so the dashboard can use admin routes.
        if admin_key_valid(x_admin_key):
            return ApiAccess(extension=None, is_admin=True)
        return ApiAccess(extension=None, is_admin=False)
    if admin_key_valid(x_admin_key):
        return ApiAccess(extension=None, is_admin=True)
    ext = get_extension_caller(authorization=authorization)
    if ext is None:
        raise HTTPException(
            status_code=401,
            detail="Send Authorization: Bearer <extension token> or X-Admin-Key for dashboard.",
        )
    return ApiAccess(extension=ext, is_admin=False)


def require_extension_token(
    authorization: str | None = Header(None, alias="Authorization"),
) -> ExtensionCaller:
    """Strict: must be Bearer extension JWT (no admin key). Used for extension-only endpoints."""
    if not auth_enabled():
        raise HTTPException(400, "JWT_SECRET is not set — extension token not used")
    ext = get_extension_caller(authorization=authorization)
    if ext is None:
        raise HTTPException(401, "Missing or invalid Authorization Bearer token")
    return ext


def require_admin_key(x_admin_key: str | None = Header(None, alias="X-Admin-Key")) -> None:
    if not admin_key_valid(x_admin_key):
        raise HTTPException(403, "Invalid or missing X-Admin-Key")


def ensure_generation_owner(
    gen_client_username: str | None,
    ext: ExtensionCaller | None,
    is_admin: bool,
) -> None:
    if not auth_enabled():
        return
    if is_admin:
        return
    if ext is None:
        raise HTTPException(status_code=403, detail="Not allowed")
    owner = (gen_client_username or "").strip() or None
    if owner is None:
        raise HTTPException(status_code=403, detail="This row has no owner — admin only")
    if owner != ext.username:
        raise HTTPException(status_code=403, detail="Not your generation")
