"""Bcrypt password hashing (same rounds as prior token hashes; compatible with bcrypt lib)."""

from __future__ import annotations

import bcrypt


def hash_password(plain: str) -> str:
    if len(plain.encode("utf-8")) > 72:
        raise ValueError("Password must be at most 72 bytes (bcrypt limit)")
    h = bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=12))
    return h.decode()


def verify_password(plain: str, password_hash: str) -> bool:
    if not plain or not password_hash:
        return False
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), password_hash.encode("ascii"))
    except Exception:
        return False
