"""Resume generation and generation list endpoints."""

import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select, tuple_
from sqlalchemy.orm import Session

from app.core.deps import AdminUser, CurrentUser, DbSession, resolve_assigned_profile
from app.models.generation import Generation
from app.models.registered_profile import RegisteredProfile
from app.models.user import User
from app.schemas.generate import (
    ALLOWED_MODELS,
    CheckGenerationKeysRequest,
    CheckGenerationKeysResponse,
    CheckUrlsRequest,
    GenerateRequest,
    GenerationListResponse,
    GenerationPatch,
    GenerationPresenceResult,
    GenerationRead,
    ManualGenerateRequest,
    canonical_url_for_manual_entry,
)
from app.services.document_service import build_answers_docx, build_jd_docx, build_resume_docx
from app.services.drive_service import upload_buffers_parallel
from app.services.openai_service import generate_resume
from app.services.sheets_service import append_generation_row

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["generate"])

PIPELINE_STAGES = frozenset(
    {"generated", "intro", "tech", "final", "success", "failed"},
)


def _run_generate(
    payload: GenerateRequest,
    user: User,
    profile: RegisteredProfile,
    db: Session,
) -> Generation:
    model_key = profile.model
    if model_key not in ALLOWED_MODELS:
        raise HTTPException(400, f"Invalid model on profile. Choose from: {list(ALLOWED_MODELS)}")

    profile_name = profile.name.strip() or "default"
    profile_text = profile.profile_text

    existing = db.scalar(
        select(Generation).where(
            Generation.user_id == user.id,
            Generation.url == payload.url,
            Generation.profile_name == profile_name,
        )
    )
    if existing:
        return existing

    try:
        ai = generate_resume(
            model_key=model_key,
            title=payload.title,
            url=payload.url,
            description_text=payload.description_text,
            questions=payload.questions,
            profile_text=profile_text,
        )

        resume_buf = build_resume_docx(
            ai.resume_text,
            payload.title,
            payload.company_name,
            payload.description_text,
            profile_name,
        )
        jd_buf = build_jd_docx(payload.title, payload.company_name, payload.description_text)
        answers_buf = build_answers_docx(payload.title, payload.company_name, ai.answers_text)

        resume_drive_url, jd_drive_url, questions_drive_url = upload_buffers_parallel(
            [resume_buf, jd_buf, answers_buf]
        )

        gen = Generation(
            user_id=user.id,
            profile_name=profile_name,
            stage="generated",
            title=payload.title,
            company_name=payload.company_name,
            salary_range=payload.salary_range,
            url=payload.url,
            resume_drive_url=resume_drive_url,
            questions_drive_url=questions_drive_url,
            jd_drive_url=jd_drive_url,
            model_name=ai.model_name,
        )
        db.add(gen)
        db.commit()
        db.refresh(gen)
    except HTTPException:
        raise
    except ValueError as exc:
        logger.warning("generate validation/model error: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        logger.exception(
            "POST /api/generate failed for url=%s model=%s user=%s",
            payload.url,
            model_key,
            user.id,
        )
        msg = str(exc).strip() or type(exc).__name__
        if len(msg) > 1200:
            msg = msg[:1200] + "…"
        raise HTTPException(status_code=500, detail=msg) from exc

    try:
        append_generation_row(
            profile_name=profile_name,
            stage="generated",
            title=payload.title,
            company_name=payload.company_name,
            salary_range=payload.salary_range,
            jd_drive_url=jd_drive_url,
            jd_link=payload.url,
            resume_drive_url=resume_drive_url,
            questions_drive_url=questions_drive_url,
        )
    except Exception:
        logger.exception("Failed to append Sheets row (generation saved to DB)")

    return gen


@router.post("/generate", response_model=GenerationRead)
def generate(
    payload: GenerateRequest,
    user: CurrentUser,
    db: DbSession,
):
    profile = resolve_assigned_profile(user, payload.profile_id, db)
    return _run_generate(payload, user, profile, db)


@router.post("/generate/manual", response_model=GenerationRead)
def generate_manual(
    payload: ManualGenerateRequest,
    user: CurrentUser,
    db: DbSession,
):
    profile = resolve_assigned_profile(user, payload.profile_id, db)
    profile_name = profile.name.strip() or "default"
    canonical_url = canonical_url_for_manual_entry(
        profile_name=profile_name,
        title=payload.title,
        company_name=payload.company_name,
        description_text=payload.description_text,
        reference_url=payload.reference_url,
    )
    inner = GenerateRequest(
        title=payload.title,
        url=canonical_url,
        company_name=payload.company_name,
        description_text=payload.description_text,
        salary_range=payload.salary_range,
        questions=payload.questions,
        profile_id=payload.profile_id,
    )
    return _run_generate(inner, user, profile, db)


@router.post("/check-generation-keys", response_model=CheckGenerationKeysResponse)
def check_generation_keys(
    payload: CheckGenerationKeysRequest,
    user: CurrentUser,
    db: DbSession,
) -> CheckGenerationKeysResponse:
    items = payload.items or []
    if not items:
        return CheckGenerationKeysResponse(items=[])

    resolved: list[tuple[str, str, int, str]] = []
    for item in items:
        profile = resolve_assigned_profile(user, item.profile_id, db)
        url = item.url.strip()
        pn = profile.name.strip() or "default"
        resolved.append((url, pn, item.profile_id, pn))

    unique_triples = list(dict.fromkeys((u, p) for u, p, _, _ in resolved))
    existing_pairs: set[tuple[str, str]] = set()
    if unique_triples:
        rows = db.execute(
            select(Generation.url, Generation.profile_name).where(
                Generation.user_id == user.id,
                tuple_(Generation.url, Generation.profile_name).in_(unique_triples),
            ),
        ).all()
        existing_pairs = {(str(u or "").strip(), str(p or "").strip()) for u, p in rows}

    out: list[GenerationPresenceResult] = []
    for item, (url, pn, profile_id, profile_name) in zip(items, resolved):
        out.append(
            GenerationPresenceResult(
                url=item.url,
                profile_id=profile_id,
                profile_name=profile_name,
                exists=(url, pn) in existing_pairs,
            ),
        )
    return CheckGenerationKeysResponse(items=out)


@router.post("/check-urls")
def check_urls(
    payload: CheckUrlsRequest,
    _admin: AdminUser,
    db: DbSession,
) -> dict[str, bool]:
    if not payload.urls:
        return {}
    unique = list(set(u.strip() for u in payload.urls if u.strip()))
    if not unique:
        return {}
    existing = set(
        db.scalars(select(Generation.url).where(Generation.url.in_(unique))).all()
    )
    return {u: u.strip() in existing for u in payload.urls}


@router.get("/generations", response_model=GenerationListResponse)
def list_generations(
    _admin: AdminUser,
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, description="Search title or company"),
    stage: str | None = Query(None, description="Filter by pipeline stage"),
):
    stmt = select(Generation)
    count_stmt = select(func.count()).select_from(Generation)

    if stage and stage.strip():
        st = stage.strip().lower()
        if st in PIPELINE_STAGES:
            stmt = stmt.where(Generation.stage == st)
            count_stmt = count_stmt.where(Generation.stage == st)

    if q and q.strip():
        term = f"%{q.strip().lower()}%"
        cond = func.lower(Generation.title).like(term) | func.lower(Generation.company_name).like(term)
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


@router.get("/generations/{gen_id}", response_model=GenerationRead)
def get_generation(gen_id: int, _admin: AdminUser, db: DbSession):
    gen = db.get(Generation, gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    return gen


@router.patch("/generations/{gen_id}", response_model=GenerationRead)
def patch_generation(
    gen_id: int,
    payload: GenerationPatch,
    _admin: AdminUser,
    db: DbSession,
):
    gen = db.get(Generation, gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return gen

    for key, value in data.items():
        setattr(gen, key, value)
    db.add(gen)
    db.commit()
    db.refresh(gen)
    return gen


@router.delete("/generations/{gen_id}", status_code=204)
def delete_generation(gen_id: int, _admin: AdminUser, db: DbSession):
    gen = db.get(Generation, gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    db.delete(gen)
    db.commit()
