from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Generation(Base):
    __tablename__ = "generations"
    __table_args__ = (
        Index("ix_generations_created_at", "created_at"),
        Index("ix_generations_stage_created_at", "stage", "created_at"),
        Index("ix_generations_profile_name", "profile_name"),
        Index("ix_generations_model_name", "model_name"),
        Index("ix_generations_user_created_at", "user_id", "created_at"),
        Index(
            "ix_generations_user_url_profile",
            "user_id",
            "url",
            "profile_name",
            unique=True,
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    profile_name: Mapped[str] = mapped_column(String(200))
    stage: Mapped[str] = mapped_column(String(50), default="generated")
    title: Mapped[str] = mapped_column(String(500))
    company_name: Mapped[str] = mapped_column(String(500), default="")
    salary_range: Mapped[str] = mapped_column(String(2000), default="")
    note: Mapped[str] = mapped_column(String(2000), default="")
    url: Mapped[str] = mapped_column(String(2000), index=True)

    resume_drive_url: Mapped[str] = mapped_column(String(2000), default="")
    questions_drive_url: Mapped[str] = mapped_column(String(2000), default="")
    jd_drive_url: Mapped[str] = mapped_column(String(2000), default="")

    model_name: Mapped[str] = mapped_column(String(100), default="")

    admin_checked: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    user: Mapped["User | None"] = relationship(back_populates="generations")
    application_screenshots: Mapped[list["ApplicationScreenshot"]] = relationship(
        back_populates="generation",
    )
