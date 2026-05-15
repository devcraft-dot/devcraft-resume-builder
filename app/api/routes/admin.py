"""Admin-only user and profile management."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from app.core.auth import generate_api_token, hash_api_token
from app.core.deps import AdminUser, DbSession
from app.models.registered_profile import RegisteredProfile
from app.models.user import User
from app.models.user_profile_assignment import UserProfileAssignment
from app.schemas.auth import (
    TokenRotateResponse,
    UserCreate,
    UserCreateResponse,
    UserPatch,
    UserProfilesUpdate,
    UserRead,
)
from app.schemas.registered_profile import (
    RegisteredProfileCreate,
    RegisteredProfilePatch,
    RegisteredProfileRead,
    RegisteredProfileSummary,
    validate_model,
)
from app.core.bootstrap import create_user_with_token

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _user_to_read(user: User) -> UserRead:
    profile_ids = [a.profile_id for a in (user.profile_assignments or [])]
    return UserRead(
        id=user.id,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        profile_ids=profile_ids,
    )


def _load_user(db: Session, user_id: int) -> User:
    user = db.scalar(
        select(User)
        .options(joinedload(User.profile_assignments))
        .where(User.id == user_id)
    )
    if not user:
        raise HTTPException(404, "User not found")
    return user


# --- Users ---


@router.get("/users", response_model=list[UserRead])
def list_users(_admin: AdminUser, db: DbSession) -> list[UserRead]:
    users = db.scalars(
        select(User).options(joinedload(User.profile_assignments)).order_by(User.id)
    ).all()
    return [_user_to_read(u) for u in users]


@router.post("/users", response_model=UserCreateResponse)
def create_user(
    payload: UserCreate,
    _admin: AdminUser,
    db: DbSession,
) -> UserCreateResponse:
    user, plain = create_user_with_token(
        display_name=payload.display_name,
        role=payload.role,
        db=db,
    )
    db.commit()
    db.refresh(user)
    base = _user_to_read(user)
    return UserCreateResponse(**base.model_dump(), api_token=plain)


@router.patch("/users/{user_id}", response_model=UserRead)
def patch_user(
    user_id: int,
    payload: UserPatch,
    _admin: AdminUser,
    db: DbSession,
) -> UserRead:
    user = _load_user(db, user_id)
    data = payload.model_dump(exclude_unset=True)
    for key, value in data.items():
        setattr(user, key, value)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_to_read(_load_user(db, user_id))


@router.post("/users/{user_id}/rotate-token", response_model=TokenRotateResponse)
def rotate_user_token(
    user_id: int,
    _admin: AdminUser,
    db: DbSession,
) -> TokenRotateResponse:
    user = _load_user(db, user_id)
    plain = generate_api_token()
    user.token_hash = hash_api_token(plain)
    db.add(user)
    db.commit()
    return TokenRotateResponse(api_token=plain)


@router.put("/users/{user_id}/profiles", response_model=UserRead)
def set_user_profiles(
    user_id: int,
    payload: UserProfilesUpdate,
    _admin: AdminUser,
    db: DbSession,
) -> UserRead:
    user = _load_user(db, user_id)
    profile_ids = list(dict.fromkeys(payload.profile_ids))

    if profile_ids:
        found = set(
            db.scalars(
                select(RegisteredProfile.id).where(RegisteredProfile.id.in_(profile_ids))
            ).all()
        )
        missing = set(profile_ids) - found
        if missing:
            raise HTTPException(400, f"Unknown profile ids: {sorted(missing)}")

    db.execute(
        delete(UserProfileAssignment).where(UserProfileAssignment.user_id == user_id)
    )
    for pid in profile_ids:
        db.add(UserProfileAssignment(user_id=user_id, profile_id=pid))
    db.commit()
    return _user_to_read(_load_user(db, user_id))


# --- Profiles ---


@router.get("/profiles", response_model=list[RegisteredProfileSummary])
def list_profiles(_admin: AdminUser, db: DbSession) -> list[RegisteredProfileSummary]:
    rows = db.scalars(
        select(RegisteredProfile).order_by(RegisteredProfile.name)
    ).all()
    return [RegisteredProfileSummary.model_validate(r) for r in rows]


@router.post("/profiles", response_model=RegisteredProfileRead)
def create_profile(
    payload: RegisteredProfileCreate,
    _admin: AdminUser,
    db: DbSession,
) -> RegisteredProfileRead:
    try:
        validate_model(payload.model)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc

    existing = db.scalar(
        select(RegisteredProfile).where(RegisteredProfile.name == payload.name.strip())
    )
    if existing:
        raise HTTPException(400, "Profile name already exists")

    row = RegisteredProfile(
        name=payload.name.strip(),
        model=payload.model,
        profile_text=payload.profile_text,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return RegisteredProfileRead.model_validate(row)


@router.get("/profiles/{profile_id}", response_model=RegisteredProfileRead)
def get_profile(
    profile_id: int,
    _admin: AdminUser,
    db: DbSession,
) -> RegisteredProfileRead:
    row = db.get(RegisteredProfile, profile_id)
    if not row:
        raise HTTPException(404, "Profile not found")
    return RegisteredProfileRead.model_validate(row)


@router.patch("/profiles/{profile_id}", response_model=RegisteredProfileRead)
def patch_profile(
    profile_id: int,
    payload: RegisteredProfilePatch,
    _admin: AdminUser,
    db: DbSession,
) -> RegisteredProfileRead:
    row = db.get(RegisteredProfile, profile_id)
    if not row:
        raise HTTPException(404, "Profile not found")

    data = payload.model_dump(exclude_unset=True)
    if "model" in data:
        try:
            validate_model(data["model"])
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
    if "name" in data:
        name = data["name"].strip()
        other = db.scalar(
            select(RegisteredProfile).where(
                RegisteredProfile.name == name,
                RegisteredProfile.id != profile_id,
            )
        )
        if other:
            raise HTTPException(400, "Profile name already exists")
        data["name"] = name

    for key, value in data.items():
        setattr(row, key, value)
    db.add(row)
    db.commit()
    db.refresh(row)
    return RegisteredProfileRead.model_validate(row)


@router.delete("/profiles/{profile_id}", status_code=204)
def delete_profile(
    profile_id: int,
    _admin: AdminUser,
    db: DbSession,
) -> None:
    row = db.get(RegisteredProfile, profile_id)
    if not row:
        raise HTTPException(404, "Profile not found")
    db.delete(row)
    db.commit()
