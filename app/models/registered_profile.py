from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class RegisteredProfile(Base):
    __tablename__ = "registered_profiles"
    __table_args__ = (Index("ix_registered_profiles_name", "name", unique=True),)

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    model: Mapped[str] = mapped_column(String(100))
    profile_text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=utc_now
    )

    assignments: Mapped[list["UserProfileAssignment"]] = relationship(
        back_populates="profile",
        cascade="all, delete-orphan",
    )
