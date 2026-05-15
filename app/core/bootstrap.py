"""Bootstrap first admin user from BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD."""

from __future__ import annotations

import logging

from sqlalchemy import func, select

from app.core.config import settings
from app.core.db import _session_factory
from app.core.passwords import hash_password
from app.core.token_util import normalize_api_token
from app.models.user import User

logger = logging.getLogger(__name__)


def bootstrap_admin_if_needed() -> None:
    pwd = normalize_api_token(settings.bootstrap_admin_password)
    if not pwd:
        return

    db = _session_factory()()
    try:
        if settings.bootstrap_replace_admin:
            admins = db.scalars(select(User).where(User.role == "admin")).all()
            for u in admins:
                db.delete(u)
            db.commit()
            logger.warning(
                "BOOTSTRAP_REPLACE_ADMIN: removed %d admin user(s); creating new admin from env",
                len(admins),
            )

        admin_count = int(
            db.scalar(select(func.count()).select_from(User).where(User.role == "admin"))
            or 0
        )
        if admin_count > 0:
            return

        uname = (settings.bootstrap_admin_username or "admin").strip().lower()
        if not uname:
            uname = "admin"

        db.add(
            User(
                username=uname,
                display_name="Admin",
                role="admin",
                password_hash=hash_password(pwd),
                is_active=True,
            )
        )
        db.commit()
        logger.info("Bootstrap admin user created (%s)", uname)
    except Exception:
        db.rollback()
        logger.exception("Failed to bootstrap admin user")
    finally:
        db.close()
