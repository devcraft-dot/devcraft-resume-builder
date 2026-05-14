"""Optional uploads (e.g. application-form screenshots) to Google Drive."""

from __future__ import annotations

import logging
import re
from datetime import date
from io import BytesIO

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

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


@router.post("/upload/application-screenshot")
async def upload_application_screenshot(
    file: UploadFile = File(...),
    title: str = Query("", max_length=500),
    company_name: str = Query("", max_length=500),
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

    logger.info("application screenshot uploaded name=%r bytes=%d", fn, len(data))
    return {"drive_url": url, "filename": fn}
