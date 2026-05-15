from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class RegisteredProfileRead(BaseModel):
    id: int
    created_at: datetime
    name: str
    profile_text: str

    model_config = {"from_attributes": True}


class RegisteredProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    profile_text: str = Field(..., min_length=1)


class RegisteredProfileUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    profile_text: str | None = Field(None, min_length=1)
