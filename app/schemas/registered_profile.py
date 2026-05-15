from datetime import datetime

from pydantic import BaseModel, Field

from app.schemas.generate import ALLOWED_MODELS


class RegisteredProfileRead(BaseModel):
    id: int
    name: str
    model: str
    profile_text: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RegisteredProfileSummary(BaseModel):
    id: int
    name: str
    model: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class RegisteredProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    model: str = Field(..., min_length=1, max_length=100)
    profile_text: str = Field(..., min_length=1)


class RegisteredProfilePatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    model: str | None = Field(None, min_length=1, max_length=100)
    profile_text: str | None = Field(None, min_length=1)


class AssignedProfileRead(BaseModel):
    """Profile payload for extension sync."""

    id: int
    name: str
    model: str
    profile_text: str

    model_config = {"from_attributes": True}


def validate_model(model: str) -> str:
    if model not in ALLOWED_MODELS:
        raise ValueError(f"Invalid model. Choose from: {list(ALLOWED_MODELS)}")
    return model
