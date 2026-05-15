"""Admin-only user and profile management."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from app.core.deps import AdminUser, DbSession
from app.core.passwords import hash_password
from app.models.registered_profile import RegisteredProfile
from app.models.user import User
from app.models.user_profile_assignment import UserProfileAssignment
from app.schemas.auth import (
    UserCreate,
    UserPatch,
    UserProfilesUpdate,
    UserRead,
    UserSetPassword,
)
from app.schemas.registered_profile import (
    RegisteredProfileCreate,
    RegisteredProfilePatch,
    RegisteredProfileRead,
    RegisteredProfileSummary,
    validate_model,
)

router = APIRouter(prefix="/api/admin", tags=["admin"])


def _user_to_read(user: User) -> UserRead:
    if not user.username or not user.password_hash:
        raise HTTPException(
            503,
            "User rows are incomplete (null username or password_hash). "
            "Run migrations/002_users_password_jwt.sql fully, or TRUNCATE users CASCADE and "
            "redeploy with BOOTSTRAP_ADMIN_PASSWORD + JWT_SECRET_KEY.",
        )
    profile_ids = [a.profile_id for a in (user.profile_assignments or [])]
    return UserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        is_active=user.is_active,
        created_at=user.created_at,
        profile_ids=profile_ids,
    )


def _load_user(db: Session, user_id: int) -> User:
    user = db.scalars(
        select(User)
        .options(joinedload(User.profile_assignments))
        .where(User.id == user_id)
    ).unique().first()
    if not user:
        raise HTTPException(404, "User not found")
    return user


# --- Users ---


@router.get("/users", response_model=list[UserRead])
def list_users(_admin: AdminUser, db: DbSession) -> list[UserRead]:
    users = db.scalars(
        select(User).options(joinedload(User.profile_assignments)).order_by(User.id)
    ).unique().all()
    return [_user_to_read(u) for u in users]


@router.post("/users", response_model=UserRead)
def create_user(
    payload: UserCreate,
    _admin: AdminUser,
    db: DbSession,
) -> UserRead:
    uname = payload.username.strip().lower()
    if db.scalar(select(User.id).where(User.username == uname)):
        raise HTTPException(400, "Username already taken")
    user = User(
        username=uname,
        display_name=payload.display_name.strip() or "User",
        role=payload.role,
        password_hash=hash_password(payload.password),
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_to_read(_load_user(db, user.id))


@router.patch("/users/{user_id}", response_model=UserRead)
def patch_user(
    user_id: int,
    payload: UserPatch,
    _admin: AdminUser,
    db: DbSession,
) -> UserRead:
    user = _load_user(db, user_id)
    data = payload.model_dump(exclude_unset=True)
    new_pw = data.pop("password", None)
    for key, value in data.items():
        setattr(user, key, value)
    if new_pw is not None:
        user.password_hash = hash_password(new_pw)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_to_read(_load_user(db, user_id))


@router.post("/users/{user_id}/set-password", response_model=UserRead)
def set_user_password(
    user_id: int,
    payload: UserSetPassword,
    _admin: AdminUser,
    db: DbSession,
) -> UserRead:
    user = _load_user(db, user_id)
    user.password_hash = hash_password(payload.password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return _user_to_read(_load_user(db, user_id))


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
