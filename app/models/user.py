from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        Index("ix_users_token_hash", "token_hash", unique=True),
        Index("ix_users_role", "role"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    display_name: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="user")
    token_hash: Mapped[str] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    profile_assignments: Mapped[list["UserProfileAssignment"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )
    generations: Mapped[list["Generation"]] = relationship(back_populates="user")
