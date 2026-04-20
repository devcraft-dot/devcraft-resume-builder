from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends

from app.core.db import get_db
from app.models.generation import Generation
from app.schemas.dashboard import (
    DashboardAnalytics,
    ModelBreakdown,
    ProfileBreakdown,
    StageCount,
)

router = APIRouter(prefix="/api", tags=["dashboard"])

STAGE_ORDER = ("generated", "intro", "tech", "final", "success", "failed")


def _stage_sum(stage_value: str):
    return func.sum(case((Generation.stage == stage_value, 1), else_=0))


_passed_resume_check_expr = case(
    (Generation.stage.in_(("intro", "tech", "final", "success")), 1),
    else_=0,
)


@router.get("/dashboard/analytics", response_model=DashboardAnalytics)
def dashboard_analytics(db: Session = Depends(get_db)) -> DashboardAnalytics:
    total_g = int(db.scalar(select(func.count()).select_from(Generation)) or 0)
    passed_total = int(
        db.scalar(
            select(func.count()).select_from(Generation).where(
                Generation.stage.in_(("intro", "tech", "final", "success")),
            ),
        )
        or 0,
    )

    stage_rows = db.execute(
        select(Generation.stage, func.count(Generation.id))
        .group_by(Generation.stage)
    ).all()
    stage_map: dict[str, int] = {}
    for s, c in stage_rows:
        key = s or "(empty)"
        stage_map[key] = int(c)

    by_stage: list[StageCount] = [
        StageCount(stage=sk, count=stage_map.get(sk, 0)) for sk in STAGE_ORDER
    ]
    for sk, cnt in sorted(stage_map.items()):
        if sk not in STAGE_ORDER:
            by_stage.append(StageCount(stage=sk, count=cnt))

    gen = _stage_sum("generated")
    intro = _stage_sum("intro")
    tech = _stage_sum("tech")
    fin = _stage_sum("final")
    succ = _stage_sum("success")
    fail = _stage_sum("failed")

    model_rows = db.execute(
        select(
            Generation.model_name,
            func.count(Generation.id),
            func.sum(_passed_resume_check_expr),
            gen,
            intro,
            tech,
            fin,
            succ,
            fail,
        )
        .group_by(Generation.model_name)
        .order_by(func.count(Generation.id).desc())
    ).all()

    by_model = [
        ModelBreakdown(
            model_name=(m or "(empty)"),
            total=int(tot),
            passed_resume_check=int(pchk or 0),
            generated=int(g or 0),
            intro=int(i or 0),
            tech=int(t or 0),
            final=int(f or 0),
            success=int(su or 0),
            failed=int(fa or 0),
        )
        for m, tot, pchk, g, i, t, f, su, fa in model_rows
    ]

    profile_rows = db.execute(
        select(
            Generation.profile_name,
            func.count(Generation.id),
            func.sum(_passed_resume_check_expr),
            gen,
            intro,
            tech,
            fin,
            succ,
            fail,
        )
        .group_by(Generation.profile_name)
        .order_by(func.count(Generation.id).desc())
    ).all()

    by_profile = [
        ProfileBreakdown(
            profile_name=(p or "(empty)"),
            total=int(tot),
            passed_resume_check=int(pchk or 0),
            generated=int(g or 0),
            intro=int(i or 0),
            tech=int(t or 0),
            final=int(f or 0),
            success=int(su or 0),
            failed=int(fa or 0),
        )
        for p, tot, pchk, g, i, t, f, su, fa in profile_rows
    ]

    return DashboardAnalytics(
        total_generations=total_g,
        passed_resume_check_total=passed_total,
        by_stage=by_stage,
        by_model=by_model,
        by_profile=by_profile,
    )
