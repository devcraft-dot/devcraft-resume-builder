"""Application-form screenshots: upload to Drive + list for dashboard."""

from __future__ import annotations

import json
import logging
import math
import re
from datetime import date
from io import BytesIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import func, select
from sqlalchemy import true as sql_true
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.core.deps import ApiAccess, auth_enabled, require_extension_or_admin
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


def _safe_snippet(s: str, max_len: int = 40) -> str:
    t = re.sub(r"[^\w\s-]", "", (s or "").strip())[:max_len].strip().replace(" ", "_")
    return t or "job"


def _gen_match_for_access(access: ApiAccess):
    """Scope generation rows when advancing stage after screenshot upload."""
    if not auth_enabled():
        return Generation.client_username.is_(None)
    if access.is_admin:
        return sql_true()
    if access.extension is not None:
        return Generation.client_username == access.extension.username
    return Generation.client_username.is_(None)


@router.post("/upload/application-screenshot")
@router.post("/upload/application-screenshot/")
async def upload_application_screenshot(
    file: UploadFile = File(...),
    title: str = Form(""),
    company_name: str = Form(""),
    job_urls_json: str = Form(""),
    db: Session = Depends(get_db),
    access: ApiAccess = Depends(require_extension_or_admin),
):
    """Accept a pasted snip or image file (PNG / JPEG / WebP), store as a native Drive file.

    Optional multipart field ``job_urls_json``: JSON array of canonical job URLs (same strings
    as stored on ``generations.url``). For each URL, if a row exists with ``stage == generated``,
    it is advanced to ``applied`` (scoped to the caller when auth is enabled).
    """
    if auth_enabled() and not access.is_admin and access.extension is None:
        raise HTTPException(401, "Authentication required")
    title = (title or "").strip()[:500]
    company_name = (company_name or "").strip()[:500]
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

    cx = access.extension.username if access.extension else None
    row = ApplicationScreenshot(
        user_id=None,
        client_username=cx,
        drive_url=url,
        filename=fn,
        job_title=title,
        company_name=company_name,
        file_mime=ct,
    )
    db.add(row)

    stages_updated = 0
    raw = (job_urls_json or "").strip()
    if raw:
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, list):
            seen: set[str] = set()
            for item in parsed:
                u = str(item or "").strip()
                if not u or u in seen:
                    continue
                seen.add(u)
                gen = db.scalar(
                    select(Generation).where(
                        Generation.url == u,
                        _gen_match_for_access(access),
                    )
                )
                if gen is not None and (gen.stage or "").strip().lower() == "generated":
                    gen.stage = "applied"
                    db.add(gen)
                    stages_updated += 1

    db.commit()
    db.refresh(row)

    logger.info(
        "application screenshot uploaded id=%s name=%r bytes=%d stages_updated=%s",
        row.id,
        fn,
        len(data),
        stages_updated,
    )
    return {
        "id": row.id,
        "drive_url": url,
        "filename": fn,
        "generations_marked_applied": stages_updated,
    }


@router.get("/application-screenshots", response_model=ApplicationScreenshotList)
def list_application_screenshots(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    access: ApiAccess = Depends(require_extension_or_admin),
):
    """Paginated list for the dashboard (newest first)."""
    if auth_enabled() and not access.is_admin and access.extension is None:
        raise HTTPException(401, "Authentication required")
    stmt = select(ApplicationScreenshot)
    count_stmt = select(func.count()).select_from(ApplicationScreenshot)
    if auth_enabled() and access.extension is not None and not access.is_admin:
        stmt = stmt.where(ApplicationScreenshot.client_username == access.extension.username)
        count_stmt = count_stmt.where(ApplicationScreenshot.client_username == access.extension.username)

    total = int(db.scalar(count_stmt) or 0)
    pages = max(1, math.ceil(total / page_size)) if total else 1
    offset = (page - 1) * page_size

    rows = db.scalars(
        stmt.order_by(ApplicationScreenshot.created_at.desc()).offset(offset).limit(page_size),
    ).all()

    return ApplicationScreenshotList(
        items=[ApplicationScreenshotRead.model_validate(r) for r in rows],
        total=total,
        page=page,
        page_size=page_size,
        pages=pages,
    )
