from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


class RegisteredProfile(Base):
    """Admin-defined profile name + resume text. Extension tokens reference these names."""

    __tablename__ = "registered_profiles"
    __table_args__ = (Index("ix_registered_profiles_name", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    name: Mapped[str] = mapped_column(String(200), unique=True, index=True)
    profile_text: Mapped[str] = mapped_column(Text, default="")
