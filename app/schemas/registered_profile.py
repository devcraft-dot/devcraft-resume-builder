from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator


class RegisteredProfileRead(BaseModel):
    id: int
    created_at: datetime
    name: str
    profile_text: str

    model_config = {"from_attributes": True}

    @field_validator("name", "profile_text", mode="before")
    @classmethod
    def _null_str_to_empty(cls, v):
        return "" if v is None else v


class RegisteredProfileCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    profile_text: str = Field(..., min_length=1)


class RegisteredProfileUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    profile_text: str | None = Field(None, min_length=1)
