from datetime import datetime

from pydantic import BaseModel, Field


class MeRead(BaseModel):
    id: int
    username: str
    display_name: str
    role: str

    model_config = {"from_attributes": True}


class UserRead(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    is_active: bool
    created_at: datetime
    profile_ids: list[int] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class LoginRequest(BaseModel):
    username: str = Field(..., min_length=1, max_length=100)
    password: str = Field(..., min_length=1, max_length=128)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: MeRead


class UserCreate(BaseModel):
    username: str = Field(..., min_length=1, max_length=100, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(..., min_length=8, max_length=128)
    display_name: str = Field(..., min_length=1, max_length=200)
    role: str = Field("user", pattern="^(admin|user)$")


class UserPatch(BaseModel):
    display_name: str | None = Field(None, min_length=1, max_length=200)
    is_active: bool | None = None
    role: str | None = Field(None, pattern="^(admin|user)$")
    password: str | None = Field(None, min_length=8, max_length=128)


class UserSetPassword(BaseModel):
    password: str = Field(..., min_length=8, max_length=128)


class UserProfilesUpdate(BaseModel):
    profile_ids: list[int] = Field(default_factory=list)
