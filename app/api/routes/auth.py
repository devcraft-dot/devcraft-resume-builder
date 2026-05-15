from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.db import get_db
from app.core.deps import ExtensionCaller, auth_enabled, get_extension_caller
from app.core.security import create_extension_access_token
from app.models.registered_profile import RegisteredProfile
from app.schemas.auth import AuthConfigResponse

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["auth"])


class ExtensionTokenRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=200)
    profile_names: list[str] = Field(..., min_length=1, max_length=80)
    mint_secret: str = Field("", max_length=500)


class ExtensionTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class WhoAmIResponse(BaseModel):
    username: str
    profile_names: list[str]


class ExtensionProfileRow(BaseModel):
    name: str
    profile_text: str


@router.get("/auth/config", response_model=AuthConfigResponse)
def auth_config() -> AuthConfigResponse:
    return AuthConfigResponse(auth_required=auth_enabled())


@router.post("/auth/extension-token", response_model=ExtensionTokenResponse)
def mint_extension_token(payload: ExtensionTokenRequest, db: Session = Depends(get_db)) -> ExtensionTokenResponse:
    """Mint a JWT: each profile_name must exist as a RegisteredProfile on the server."""
    if not auth_enabled():
        raise HTTPException(400, "JWT_SECRET is not set — cannot mint extension tokens.")
    ms = (settings.extension_mint_secret or "").strip()
    if ms and (payload.mint_secret or "").strip() != ms:
        raise HTTPException(403, "Invalid mint_secret")
    names = sorted({(n or "").strip() for n in payload.profile_names if (n or "").strip()})[:80]
    if not names:
        raise HTTPException(400, "profile_names must contain at least one non-empty name")
    un = (payload.username or "").strip()[:200]
    if not un:
        raise HTTPException(400, "username required")
    for n in names:
        exists = db.scalar(select(RegisteredProfile.id).where(RegisteredProfile.name == n))
        if exists is None:
            raise HTTPException(400, f"Unknown server profile name: {n!r}")
    token = create_extension_access_token(username=un, profile_names=list(names))
    logger.info("minted extension token username=%s profiles=%s", un, names)
    return ExtensionTokenResponse(access_token=token)


@router.get("/auth/whoami", response_model=WhoAmIResponse)
def whoami(ext: ExtensionCaller | None = Depends(get_extension_caller)) -> WhoAmIResponse:
    if not auth_enabled():
        return WhoAmIResponse(username="", profile_names=[])
    if ext is None:
        raise HTTPException(401, "Bearer extension token required")
    return WhoAmIResponse(username=ext.username, profile_names=sorted(ext.profile_names))


@router.get("/extension/profiles", response_model=list[ExtensionProfileRow])
def extension_pull_profiles(
    db: Session = Depends(get_db),
    ext: ExtensionCaller | None = Depends(get_extension_caller),
) -> list[ExtensionProfileRow]:
    """Return profile_text for each name in the token (must exist on server)."""
    if not auth_enabled():
        return []
    if ext is None:
        raise HTTPException(401, "Bearer extension token required")
    if not ext.profile_names:
        return []
    rows = db.scalars(
        select(RegisteredProfile).where(RegisteredProfile.name.in_(list(ext.profile_names))),
    ).all()
    by_name = {r.name: r for r in rows}
    out: list[ExtensionProfileRow] = []
    for n in sorted(ext.profile_names):
        r = by_name.get(n)
        if r:
            out.append(ExtensionProfileRow(name=r.name, profile_text=r.profile_text or ""))
    return out
