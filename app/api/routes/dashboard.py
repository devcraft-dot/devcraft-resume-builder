from fastapi import APIRouter, Depends
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.generation import Generation
from app.schemas.dashboard import (
    DashboardAnalytics,
    ModelBreakdown,
    ProfileBreakdown,
    StageCount,
)

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/dashboard/analytics", response_model=DashboardAnalytics)
def dashboard_analytics(db: Session = Depends(get_db)) -> DashboardAnalytics:
    total_g = int(db.scalar(select(func.count()).select_from(Generation)) or 0)

    stage_rows = db.execute(
        select(Generation.stage, func.count(Generation.id))
        .group_by(Generation.stage)
        .order_by(func.count(Generation.id).desc())
    ).all()
    by_stage = [StageCount(stage=s or "(empty)", count=int(c)) for s, c in stage_rows]

    success_expr = case((Generation.stage == "success", 1), else_=0)
    model_rows = db.execute(
        select(
            Generation.model_name,
            func.count(Generation.id),
            func.sum(success_expr),
        )
        .group_by(Generation.model_name)
        .order_by(func.count(Generation.id).desc())
    ).all()
    by_model = [
        ModelBreakdown(
            model_name=(m or "(empty)"),
            total=int(tot),
            success=int(suc or 0),
        )
        for m, tot, suc in model_rows
    ]

    profile_rows = db.execute(
        select(
            Generation.profile_name,
            func.count(Generation.id),
            func.sum(success_expr),
        )
        .group_by(Generation.profile_name)
        .order_by(func.count(Generation.id).desc())
    ).all()
    by_profile = [
        ProfileBreakdown(
            profile_name=(p or "(empty)"),
            total=int(tot),
            success=int(suc or 0),
        )
        for p, tot, suc in profile_rows
    ]

    return DashboardAnalytics(
        total_generations=total_g,
        by_stage=by_stage,
        by_model=by_model,
        by_profile=by_profile,
    )
