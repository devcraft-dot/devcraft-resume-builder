from pydantic import BaseModel, EmailStr, Field


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=200)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=1, max_length=200)


class UserPublic(BaseModel):
    id: int
    email: str
    is_admin: bool

    model_config = {"from_attributes": True}


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class AuthConfigResponse(BaseModel):
    """auth_required: clients must send Bearer JWT for protected routes (no server session)."""

    auth_required: bool


class MeResponse(BaseModel):
    email: str
    is_admin: bool
    generation_count: int
