"""API token generation and verification."""

from __future__ import annotations

import secrets

from passlib.context import CryptContext

_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")

TOKEN_PREFIX = "rb_"


def generate_api_token() -> str:
    return f"{TOKEN_PREFIX}{secrets.token_urlsafe(32)}"


def hash_api_token(token: str) -> str:
    return _ctx.hash(token)


def verify_api_token(plain: str, token_hash: str) -> bool:
    try:
        return _ctx.verify(plain, token_hash)
    except Exception:
        return False
