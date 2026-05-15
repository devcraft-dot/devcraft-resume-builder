from datetime import datetime

from pydantic import BaseModel, Field


class MeRead(BaseModel):
    id: int
    display_name: str
    role: str

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    display_name: str
    role: str
    is_active: bool
    created_at: datetime
    profile_ids: list[int] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class UserCreate(BaseModel):
    display_name: str = Field(..., min_length=1, max_length=200)
    role: str = Field("user", pattern="^(admin|user)$")


class UserCreateResponse(UserRead):
    api_token: str


class UserPatch(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=200)
    is_active: bool | None = None
    role: str | None = Field(None, pattern="^(admin|user)$")


class TokenRotateResponse(BaseModel):
    api_token: str


class UserProfilesUpdate(BaseModel):
    profile_ids: list[int] = Field(default_factory=list)
