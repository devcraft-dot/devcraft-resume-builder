from __future__ import annotations

import re
from datetime import datetime

from pydantic import BaseModel, computed_field


def _drive_file_id(url: str) -> str | None:
    m = re.search(r"/file/d/([a-zA-Z0-9_-]+)", str(url or ""))
    return m.group(1) if m else None


class ApplicationScreenshotRead(BaseModel):
    id: int
    created_at: datetime
    drive_url: str
    filename: str
    job_title: str = ""
    company_name: str = ""
    file_mime: str = ""

    model_config = {"from_attributes": True}

    @computed_field
    @property
    def thumbnail_url(self) -> str:
        fid = _drive_file_id(self.drive_url)
        if not fid:
            return ""
        return f"https://drive.google.com/thumbnail?id={fid}&sz=w400"


class ApplicationScreenshotList(BaseModel):
    items: list[ApplicationScreenshotRead]
    total: int
    page: int
    page_size: int
    pages: int
