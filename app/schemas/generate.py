import hashlib
from datetime import datetime
from typing import TYPE_CHECKING

from pydantic import BaseModel, Field

from app.schemas.application_screenshot import ApplicationScreenshotRead

if TYPE_CHECKING:
    from sqlalchemy.orm import Session

    from app.models.generation import Generation


ALLOWED_MODELS = ("gpt-5.4", "gpt-5.4-mini", "deepseek", "deepseek-reasoner")


def canonical_url_for_manual_entry(
    *,
    profile_name: str,
    title: str,
    company_name: str,
    description_text: str,
    reference_url: str,
) -> str:
    """Stable job URL for pasted JDs: optional real link, else content hash (must match manual-jd extension)."""
    ref = (reference_url or "").strip()
    if ref:
        return ref[:2000]
    pn = (profile_name or "").strip() or "default"
    key = f"{pn}\n{title.strip()}\n{(company_name or '').strip()}\n{(description_text or '').strip()}"
    digest = hashlib.sha256(key.encode("utf-8", errors="replace")).hexdigest()
    return f"manual:{digest}"


class QuestionField(BaseModel):
    label: str = ""
    type: str = "input"
    required: bool = False
    options: list[str] = Field(default_factory=list)


class GenerateRequest(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    url: str = Field(..., min_length=1, max_length=2000)
    company_name: str = Field("", max_length=500)
    description_text: str = ""
    salary_range: str = Field("", max_length=2000)
    questions: list[QuestionField] = Field(default_factory=list)
    profile_id: int = Field(..., ge=1)


class ManualGenerateRequest(BaseModel):
    """Paste-a-JD flow: same pipeline as POST /api/generate; URL is derived for dedup unless reference_url is set."""

    title: str = Field(..., min_length=1, max_length=500)
    company_name: str = Field("", max_length=500)
    description_text: str = Field(..., min_length=1)
    salary_range: str = Field("", max_length=2000)
    questions: list[QuestionField] = Field(default_factory=list)
    profile_id: int = Field(..., ge=1)
    reference_url: str = Field(
        "",
        max_length=2000,
        description="Optional real posting URL for tracking; otherwise a hash of JD + profile is used.",
    )


class GenerationRead(BaseModel):
    id: int
    created_at: datetime
    profile_name: str
    stage: str
    title: str
    company_name: str
    salary_range: str
    note: str
    url: str
    resume_drive_url: str
    questions_drive_url: str
    jd_drive_url: str
    model_name: str
    user_id: int | None = None
    generated_by_username: str | None = None
    admin_checked: bool = False
    application_snips: list[ApplicationScreenshotRead] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class GenerationPatch(BaseModel):
    stage: str | None = None
    title: str | None = Field(None, max_length=500)
    company_name: str | None = Field(None, max_length=500)
    salary_range: str | None = Field(None, max_length=2000)
    note: str | None = Field(None, max_length=2000)
    admin_checked: bool | None = None


class CheckUrlsRequest(BaseModel):
    urls: list[str]


class GenerationPresenceItem(BaseModel):
    """One (job URL, profile) pair to test for an existing generation row."""

    url: str = Field(..., min_length=1, max_length=2000)
    profile_id: int = Field(..., ge=1)


class CheckGenerationKeysRequest(BaseModel):
    items: list[GenerationPresenceItem] = Field(default_factory=list)


class GenerationPresenceResult(BaseModel):
    url: str
    profile_id: int
    profile_name: str
    exists: bool


class CheckGenerationKeysResponse(BaseModel):
    items: list[GenerationPresenceResult]


class GenerationListResponse(BaseModel):
    items: list[GenerationRead]
    total: int
    page: int
    page_size: int
    pages: int


class BulkDeleteGenerationsRequest(BaseModel):
    ids: list[int] = Field(..., min_length=1, max_length=200)


def load_generation_for_read(db: "Session", gen_id: int) -> "Generation | None":
    from sqlalchemy import select
    from sqlalchemy.orm import joinedload, selectinload

    from app.models.generation import Generation

    return db.scalars(
        select(Generation)
        .options(
            joinedload(Generation.user),
            selectinload(Generation.application_screenshots),
        )
        .where(Generation.id == gen_id)
    ).unique().first()


def generation_read_from_orm(gen: "Generation", db: "Session | None" = None) -> GenerationRead:
    from sqlalchemy import select

    from app.models.user import User

    username: str | None = None
    if gen.user is not None:
        username = gen.user.username
    elif gen.user_id and db is not None:
        username = db.scalar(select(User.username).where(User.id == gen.user_id))

    snips = list(gen.application_screenshots) if gen.application_screenshots else []
    snips.sort(key=lambda s: s.created_at, reverse=True)

    return GenerationRead(
        id=gen.id,
        created_at=gen.created_at,
        profile_name=gen.profile_name,
        stage=gen.stage,
        title=gen.title,
        company_name=gen.company_name,
        salary_range=gen.salary_range,
        note=gen.note,
        url=gen.url,
        resume_drive_url=gen.resume_drive_url,
        questions_drive_url=gen.questions_drive_url,
        jd_drive_url=gen.jd_drive_url,
        model_name=gen.model_name,
        user_id=gen.user_id,
        generated_by_username=username,
        admin_checked=bool(gen.admin_checked),
        application_snips=[ApplicationScreenshotRead.model_validate(s) for s in snips],
    )
