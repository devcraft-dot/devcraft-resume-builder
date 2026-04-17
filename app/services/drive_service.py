"""Upload in-memory .docx buffers to Google Drive (auto-converted to Google Docs)."""

from __future__ import annotations

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseUpload

from app.core.config import settings

logger = logging.getLogger(__name__)

DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file"]

DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
GDOC_MIME = "application/vnd.google-apps.document"


def _get_drive_credentials() -> Credentials | None:
    raw = settings.drive_token_json.strip()
    if not raw:
        return None

    data = json.loads(raw)
    creds = Credentials.from_authorized_user_info(data, DRIVE_SCOPES)

    if creds.expired and creds.refresh_token:
        creds.refresh(Request())

    return creds if creds.valid else None


def _is_drive_configured() -> bool:
    return bool(settings.drive_token_json.strip())


def upload_buffer(buf: BytesIO, filename: str) -> str:
    """Upload a single BytesIO buffer to Drive, converting to Google Doc. Returns webViewLink."""
    if not _is_drive_configured():
        logger.info("Drive upload skipped: DRIVE_TOKEN_JSON not set")
        return ""

    creds = _get_drive_credentials()
    if not creds:
        logger.warning("Drive credentials invalid or expired")
        return ""

    service = build("drive", "v3", credentials=creds)

    metadata: dict = {"name": filename, "mimeType": GDOC_MIME}
    if settings.google_drive_folder_id:
        metadata["parents"] = [settings.google_drive_folder_id]

    media = MediaIoBaseUpload(buf, mimetype=DOCX_MIME, resumable=True)

    uploaded = service.files().create(
        body=metadata,
        media_body=media,
        fields="id,webViewLink",
    ).execute()

    service.permissions().create(
        fileId=uploaded["id"],
        body={"type": "anyone", "role": "reader"},
    ).execute()

    return uploaded.get("webViewLink", "")


def upload_buffers_parallel(
    items: list[tuple[BytesIO, str]], *, max_workers: int = 4
) -> list[str]:
    """Upload multiple (buffer, filename) pairs concurrently. Order of results matches input."""
    if not items:
        return []
    workers = min(max_workers, len(items))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(lambda t: upload_buffer(t[0], t[1]), items))
