from datetime import datetime

from pydantic import BaseModel, Field


ALLOWED_MODELS = ("gpt-5.4", "gpt-5.4-mini", "deepseek", "deepseek-reasoner")


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
    salary_range: str = Field("", max_length=200)
    questions: list[QuestionField] = Field(default_factory=list)
    profile_name: str = Field("", max_length=200)
    profile_text: str = Field(..., min_length=1)
    model: str = Field("gpt-5.4-mini")


class GenerationRead(BaseModel):
    id: int
    created_at: datetime
    profile_name: str
    stage: str
    title: str
    company_name: str
    salary_range: str
    url: str
    resume_drive_url: str
    questions_drive_url: str
    jd_drive_url: str
    model_name: str

    model_config = {"from_attributes": True}


class GenerationPatch(BaseModel):
    stage: str | None = None
    title: str | None = Field(None, max_length=500)
    company_name: str | None = Field(None, max_length=500)
    salary_range: str | None = Field(None, max_length=200)


class CheckUrlsRequest(BaseModel):
    urls: list[str]


class GenerationPresenceItem(BaseModel):
    """One (job URL, profile) pair to test for an existing generation row."""

    url: str = Field(..., min_length=1, max_length=2000)
    profile_name: str = Field("", max_length=200)


class CheckGenerationKeysRequest(BaseModel):
    items: list[GenerationPresenceItem] = Field(default_factory=list)


class GenerationPresenceResult(BaseModel):
    url: str
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
