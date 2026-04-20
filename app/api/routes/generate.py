"""All API endpoints — single router for the simplified resume-generation backend."""

import logging
import math

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models.generation import Generation
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


# ---------------------------------------------------------------------------
# POST /api/generate — the core endpoint
# ---------------------------------------------------------------------------

@router.post("/generate", response_model=GenerationRead)
def generate(payload: GenerateRequest, db: Session = Depends(get_db)):
    if payload.model not in ALLOWED_MODELS:
        raise HTTPException(400, f"Invalid model. Choose from: {list(ALLOWED_MODELS)}")

    profile_name = (payload.profile_name or "default").strip()

    existing = db.scalar(
        select(Generation).where(
            Generation.url == payload.url,
            Generation.profile_name == profile_name,
        )
    )
    if existing:
        return existing

    try:
        ai = generate_resume(
            model_key=payload.model,
            title=payload.title,
            url=payload.url,
            description_text=payload.description_text,
            questions=payload.questions,
            profile_text=payload.profile_text,
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
        logger.exception("POST /api/generate failed for url=%s model=%s", payload.url, payload.model)
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


# ---------------------------------------------------------------------------
# POST /api/check-generation-keys — (url, profile_name) duplicate check for extension
# ---------------------------------------------------------------------------


@router.post("/check-generation-keys", response_model=CheckGenerationKeysResponse)
def check_generation_keys(
    payload: CheckGenerationKeysRequest,
    db: Session = Depends(get_db),
) -> CheckGenerationKeysResponse:
    """True if a generation row already exists for the same JD URL and profile name."""
    out: list[GenerationPresenceResult] = []
    for item in payload.items:
        url = item.url.strip()
        pn = (item.profile_name or "default").strip()
        hit = db.scalar(
            select(Generation.id).where(
                Generation.url == url,
                Generation.profile_name == pn,
            ).limit(1),
        )
        out.append(GenerationPresenceResult(url=item.url, profile_name=pn, exists=hit is not None))
    return CheckGenerationKeysResponse(items=out)


# ---------------------------------------------------------------------------
# POST /api/check-urls — bulk duplicate check by URL only (legacy)
# ---------------------------------------------------------------------------

@router.post("/check-urls")
def check_urls(payload: CheckUrlsRequest, db: Session = Depends(get_db)) -> dict[str, bool]:
    if not payload.urls:
        return {}
    unique = list(set(u.strip() for u in payload.urls if u.strip()))
    if not unique:
        return {}
    existing = set(
        db.scalars(select(Generation.url).where(Generation.url.in_(unique))).all()
    )
    return {u: u.strip() in existing for u in payload.urls}


# ---------------------------------------------------------------------------
# GET /api/generations — paginated list
# ---------------------------------------------------------------------------

@router.get("/generations", response_model=GenerationListResponse)
def list_generations(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    q: str | None = Query(None, description="Search title or company"),
    stage: str | None = Query(None, description="Filter by pipeline stage"),
    db: Session = Depends(get_db),
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


# ---------------------------------------------------------------------------
# GET /api/generations/{id}
# ---------------------------------------------------------------------------

@router.get("/generations/{gen_id}", response_model=GenerationRead)
def get_generation(gen_id: int, db: Session = Depends(get_db)):
    gen = db.get(Generation, gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    return gen


# ---------------------------------------------------------------------------
# PATCH /api/generations/{id} — update stage, company, salary
# ---------------------------------------------------------------------------

@router.patch("/generations/{gen_id}", response_model=GenerationRead)
def patch_generation(gen_id: int, payload: GenerationPatch, db: Session = Depends(get_db)):
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


# ---------------------------------------------------------------------------
# DELETE /api/generations/{id}
# ---------------------------------------------------------------------------

@router.delete("/generations/{gen_id}", status_code=204)
def delete_generation(gen_id: int, db: Session = Depends(get_db)):
    gen = db.get(Generation, gen_id)
    if not gen:
        raise HTTPException(404, "Generation not found")
    db.delete(gen)
    db.commit()
