"""Application-form screenshots: upload to Drive + list for dashboard."""

from __future__ import annotations

import logging
import math
import re
from datetime import date
from io import BytesIO

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from sqlalchemy import func, select

from app.core.deps import AdminUser, CurrentUser, DbSession
from app.models.application_screenshot import ApplicationScreenshot
from app.models.generation import Generation
from app.schemas.application_screenshot import ApplicationScreenshotList, ApplicationScreenshotRead
from app.services.drive_service import (
    ALLOWED_IMAGE_TYPES,
    MAX_SCREENSHOT_BYTES,
    upload_raw_file_buffer,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["upload"])


def _resolve_generation_id_for_screenshot(
    db,
    *,
    user_id: int,
    title: str,
    company_name: str,
    generation_id: int | None,
) -> int | None:
    if generation_id is not None:
        g = db.get(Generation, generation_id)
        if g is not None and g.user_id == user_id:
            return g.id
    t = (title or "").strip().lower()
    c = (company_name or "").strip().lower()
    if not t and not c:
        return None
    stmt = select(Generation.id).where(Generation.user_id == user_id)
    if t:
        stmt = stmt.where(func.lower(Generation.title) == t)
    if c:
        stmt = stmt.where(func.lower(Generation.company_name) == c)
    stmt = stmt.order_by(Generation.created_at.desc()).limit(1)
    return db.scalar(stmt)


def _safe_snippet(s: str, max_len: int = 40) -> str:
    t = re.sub(r"[^\w\s-]", "", (s or "").strip())[:max_len].strip().replace(" ", "_")
    return t or "job"


@router.post("/upload/application-screenshot")
@router.post("/upload/application-screenshot/")
async def upload_application_screenshot(
    user: CurrentUser,
    db: DbSession,
    file: UploadFile = File(...),
    title: str = Query("", max_length=500),
    company_name: str = Query("", max_length=500),
    generation_id: int | None = Query(None, ge=1),
):
    """
    Accept a pasted snip or image file (PNG / JPEG / WebP), store as a native Drive file.
    Requires the same Drive OAuth env as resume uploads.
    """
    ct = (file.content_type or "").split(";")[0].strip().lower()
    if ct not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(
            400,
            f"Unsupported image type {ct!r}. Use PNG, JPEG, or WebP.",
        )

    data = await file.read()
    if len(data) > MAX_SCREENSHOT_BYTES:
        raise HTTPException(400, f"Image too large (max {MAX_SCREENSHOT_BYTES // (1024 * 1024)} MiB).")

    if not data:
        raise HTTPException(400, "Empty file.")

    ext = ".png"
    if ct == "image/jpeg":
        ext = ".jpg"
    elif ct == "image/webp":
        ext = ".webp"

    day = date.today().isoformat()
    fn = f"AppCheck_{day}_{_safe_snippet(company_name)}_{_safe_snippet(title)}{ext}"

    buf = BytesIO(data)
    url = upload_raw_file_buffer(buf, fn, mime_type=ct)
    if not url:
        raise HTTPException(
            503,
            "Drive upload failed or is not configured (set DRIVE_TOKEN_JSON and folder id on the server).",
        )

    gid = _resolve_generation_id_for_screenshot(
        db,
        user_id=user.id,
        title=title,
        company_name=company_name,
        generation_id=generation_id,
    )

    row = ApplicationScreenshot(
        user_id=user.id,
        generation_id=gid,
        drive_url=url,
        filename=fn,
        job_title=(title or "").strip()[:500],
        company_name=(company_name or "").strip()[:500],
        file_mime=ct,
    )
    db.add(row)
    db.commit()
    db.refresh(row)

    logger.info("application screenshot uploaded id=%s name=%r bytes=%d", row.id, fn, len(data))
    return {"id": row.id, "drive_url": url, "filename": fn}


@router.get("/application-screenshots", response_model=ApplicationScreenshotList)
def list_application_screenshots(
    _admin: AdminUser,
    db: DbSession,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    """Paginated list for the dashboard (newest first)."""
    total = int(db.scalar(select(func.count()).select_from(ApplicationScreenshot)) or 0)
    pages = max(1, math.ceil(total / page_size)) if total else 1
    offset = (page - 1) * page_size

    rows = db.scalars(
        select(ApplicationScreenshot)
        .order_by(ApplicationScreenshot.created_at.desc())
        .offset(offset)
        .limit(page_size),
    ).all()

    return ApplicationScreenshotList(
        items=[ApplicationScreenshotRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )
