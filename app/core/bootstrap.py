"""Bootstrap first admin user from BOOTSTRAP_ADMIN_TOKEN env."""

from __future__ import annotations

import logging

from sqlalchemy import func, select

from app.core.auth import generate_api_token, hash_api_token
from app.core.config import settings
from app.core.db import _session_factory
from app.models.user import User

logger = logging.getLogger(__name__)


def bootstrap_admin_if_needed() -> None:
    token = (settings.bootstrap_admin_token or "").strip()
    if not token:
        return

    db = _session_factory()()
    try:
        admin_count = int(
            db.scalar(select(func.count()).select_from(User).where(User.role == "admin"))
            or 0
        )
        if admin_count > 0:
            return

        db.add(
            User(
                display_name="Admin",
                role="admin",
                token_hash=hash_api_token(token),
                is_active=True,
            )
        )
        db.commit()
        logger.info("Bootstrap admin user created from BOOTSTRAP_ADMIN_TOKEN")
    except Exception:
        db.rollback()
        logger.exception("Failed to bootstrap admin user")
    finally:
        db.close()


def create_user_with_token(
    *,
    display_name: str,
    role: str,
    db,
) -> tuple[User, str]:
    """Create user and return (user, plaintext_token)."""
    plain = generate_api_token()
    user = User(
        display_name=display_name.strip() or "User",
        role=role,
        token_hash=hash_api_token(plain),
        is_active=True,
    )
    db.add(user)
    db.flush()
    return user, plain
