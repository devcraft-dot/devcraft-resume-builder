from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from fastapi import APIRouter, Depends, HTTPException

from app.core.db import get_db
from app.core.deps import ApiAccess, auth_enabled, require_extension_or_admin
from app.models.generation import Generation
from app.schemas.dashboard import (
    DashboardAnalytics,
    ModelBreakdown,
    ProfileBreakdown,
    StageCount,
)

router = APIRouter(prefix="/api", tags=["dashboard"])

STAGE_ORDER = ("generated", "applied", "intro", "tech", "final", "success", "failed")


def _stage_sum(stage_value: str):
    return func.sum(case((Generation.stage == stage_value, 1), else_=0))


_passed_resume_check_expr = case(
    (Generation.stage.in_(("applied", "intro", "tech", "final", "success")), 1),
    else_=0,
)


def _scope_generations(access: ApiAccess, stmt):
    if not auth_enabled():
        return stmt
    if access.is_admin:
        return stmt
    if access.extension is not None:
        return stmt.where(Generation.client_username == access.extension.username)
    return stmt


@router.get("/dashboard/analytics", response_model=DashboardAnalytics)
def dashboard_analytics(
    db: Session = Depends(get_db),
    access: ApiAccess = Depends(require_extension_or_admin),
) -> DashboardAnalytics:
    if auth_enabled() and not access.is_admin and access.extension is None:
        raise HTTPException(401, "Authentication required")

    q0 = select(func.count(Generation.id), func.sum(_passed_resume_check_expr)).select_from(Generation)
    q0 = _scope_generations(access, q0)
    total_g, passed_total = db.execute(q0).one()
    total_g = int(total_g or 0)
    passed_total = int(passed_total or 0)

    q1 = _scope_generations(
        access,
        select(Generation.stage, func.count(Generation.id)).select_from(Generation).group_by(Generation.stage),
    )
    stage_rows = db.execute(q1).all()
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
    appl = _stage_sum("applied")
    intro = _stage_sum("intro")
    tech = _stage_sum("tech")
    fin = _stage_sum("final")
    succ = _stage_sum("success")
    fail = _stage_sum("failed")

    q_model = (
        select(
            Generation.model_name,
            func.count(Generation.id),
            func.sum(_passed_resume_check_expr),
            gen,
            appl,
            intro,
            tech,
            fin,
            succ,
            fail,
        )
        .select_from(Generation)
        .group_by(Generation.model_name)
        .order_by(func.count(Generation.id).desc())
    )
    q_model = _scope_generations(access, q_model)
    model_rows = db.execute(q_model).all()

    by_model = [
        ModelBreakdown(
            model_name=(m or "(empty)"),
            total=int(tot),
            passed_resume_check=int(pchk or 0),
            generated=int(g or 0),
            applied=int(ap or 0),
            intro=int(i or 0),
            tech=int(t or 0),
            final=int(f or 0),
            success=int(su or 0),
            failed=int(fa or 0),
        )
        for m, tot, pchk, g, ap, i, t, f, su, fa in model_rows
    ]

    q_prof = (
        select(
            Generation.profile_name,
            func.count(Generation.id),
            func.sum(_passed_resume_check_expr),
            gen,
            appl,
            intro,
            tech,
            fin,
            succ,
            fail,
        )
        .select_from(Generation)
        .group_by(Generation.profile_name)
        .order_by(func.count(Generation.id).desc())
    )
    q_prof = _scope_generations(access, q_prof)
    profile_rows = db.execute(q_prof).all()

    by_profile = [
        ProfileBreakdown(
            profile_name=(p or "(empty)"),
            total=int(tot),
            passed_resume_check=int(pchk or 0),
            generated=int(g or 0),
            applied=int(ap or 0),
            intro=int(i or 0),
            tech=int(t or 0),
            final=int(f or 0),
            success=int(su or 0),
            failed=int(fa or 0),
        )
        for p, tot, pchk, g, ap, i, t, f, su, fa in profile_rows
    ]

    return DashboardAnalytics(
        total_generations=total_g,
        passed_resume_check_total=passed_total,
        by_stage=by_stage,
        by_model=by_model,
        by_profile=by_profile,
    )
