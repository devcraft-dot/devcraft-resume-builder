"""Admin CRUD for server-registered profiles (X-Admin-Key)."""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import require_admin_key
from app.models.registered_profile import RegisteredProfile
from app.schemas.registered_profile import (
    RegisteredProfileCreate,
    RegisteredProfileRead,
    RegisteredProfileUpdate,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/registered-profiles", response_model=list[RegisteredProfileRead])
def list_registered_profiles(
    _: None = Depends(require_admin_key),
    db: Session = Depends(get_db),
) -> list[RegisteredProfileRead]:
    rows = db.scalars(select(RegisteredProfile).order_by(RegisteredProfile.name.asc())).all()
    return [RegisteredProfileRead.model_validate(r) for r in rows]


@router.post("/registered-profiles", response_model=RegisteredProfileRead)
def create_registered_profile(
    payload: RegisteredProfileCreate,
    _: None = Depends(require_admin_key),
    db: Session = Depends(get_db),
) -> RegisteredProfileRead:
    name = (payload.name or "").strip()
    if db.scalar(select(RegisteredProfile.id).where(RegisteredProfile.name == name)):
        raise HTTPException(409, "Profile name already exists")
    row = RegisteredProfile(name=name, profile_text=payload.profile_text)
    db.add(row)
    db.commit()
    db.refresh(row)
    logger.info("registered profile name=%r id=%s", name, row.id)
    return RegisteredProfileRead.model_validate(row)


@router.patch("/registered-profiles/{profile_id}", response_model=RegisteredProfileRead)
def update_registered_profile(
    profile_id: int,
    payload: RegisteredProfileUpdate,
    _: None = Depends(require_admin_key),
    db: Session = Depends(get_db),
) -> RegisteredProfileRead:
    row = db.get(RegisteredProfile, profile_id)
    if not row:
        raise HTTPException(404, "Profile not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and (data["name"] or "").strip() != row.name:
        new_name = (data["name"] or "").strip()
        if db.scalar(select(RegisteredProfile.id).where(RegisteredProfile.name == new_name, RegisteredProfile.id != profile_id)):
            raise HTTPException(409, "Profile name already exists")
        row.name = new_name
    if "profile_text" in data:
        row.profile_text = data["profile_text"] or ""
    db.add(row)
    db.commit()
    db.refresh(row)
    return RegisteredProfileRead.model_validate(row)


@router.delete("/registered-profiles/{profile_id}", status_code=204)
def delete_registered_profile(
    profile_id: int,
    _: None = Depends(require_admin_key),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(RegisteredProfile, profile_id)
    if not row:
        raise HTTPException(404, "Profile not found")
    db.delete(row)
    db.commit()
