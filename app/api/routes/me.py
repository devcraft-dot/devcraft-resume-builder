"""Authenticated user self-service endpoints."""

from __future__ import annotations

import math

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from app.core.deps import CurrentUser, DbSession
from app.models.generation import Generation
from app.models.registered_profile import RegisteredProfile
from app.models.user_profile_assignment import UserProfileAssignment
from app.schemas.auth import MeRead
from app.schemas.generate import (
    GenerationListResponse,
    GenerationRead,
)
from app.schemas.registered_profile import AssignedProfileRead

router = APIRouter(prefix="/api/me", tags=["me"])

PIPELINE_STAGES = frozenset(
    {"generated", "intro", "tech", "final", "success", "failed"},
)


@router.get("", response_model=MeRead)
def get_me(user: CurrentUser) -> MeRead:
    return MeRead.model_validate(user)


@router.get("/profiles", response_model=list[AssignedProfileRead])
def list_my_profiles(user: CurrentUser, db: DbSession) -> list[AssignedProfileRead]:
    rows = db.scalars(
        select(RegisteredProfile)
        .join(
            UserProfileAssignment,
            UserProfileAssignment.profile_id == RegisteredProfile.id,
        )
        .where(UserProfileAssignment.user_id == user.id)
        .order_by(RegisteredProfile.name)
    ).all()
    return [AssignedProfileRead.model_validate(r) for r in rows]


@router.get("/generations", response_model=GenerationListResponse)
def list_my_generations(
    user: CurrentUser,
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, description="Search title or company"),
    stage: str | None = Query(None, description="Filter by pipeline stage"),
) -> GenerationListResponse:
    stmt = select(Generation).where(Generation.user_id == user.id)
    count_stmt = (
        select(func.count())
        .select_from(Generation)
        .where(Generation.user_id == user.id)
    )

    if stage and stage.strip():
        st = stage.strip().lower()
        if st in PIPELINE_STAGES:
            stmt = stmt.where(Generation.stage == st)
            count_stmt = count_stmt.where(Generation.stage == st)

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        cond = func.lower(Generation.title).like(term) | func.lower(
            Generation.company_name
        ).like(term)
        stmt = stmt.where(cond)
        count_stmt = count_stmt.where(cond)

    total = int(db.scalar(count_stmt) or 0)
    pages = math.ceil(total / page_size) if page_size else 0

    rows = db.scalars(
        stmt.order_by(Generation.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()

    return GenerationListResponse(
        items=[GenerationRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )
