from datetime import datetime, timezone

from sqlalchemy import DateTime, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Generation(Base):
    __tablename__ = "generations"
    __table_args__ = (
        # List view: ORDER BY created_at DESC + optional stage filter
        Index("ix_generations_created_at", "created_at"),
        Index("ix_generations_stage_created_at", "stage", "created_at"),
        # Analytics: GROUP BY profile_name / model_name
        Index("ix_generations_profile_name", "profile_name"),
        Index("ix_generations_model_name", "model_name"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    profile_name: Mapped[str] = mapped_column(String(200))
    stage: Mapped[str] = mapped_column(String(50), default="generated")
    title: Mapped[str] = mapped_column(String(500))
    company_name: Mapped[str] = mapped_column(String(500), default="")
    salary_range: Mapped[str] = mapped_column(String(200), default="")
    url: Mapped[str] = mapped_column(String(2000), index=True)

    resume_drive_url: Mapped[str] = mapped_column(String(2000), default="")
    questions_drive_url: Mapped[str] = mapped_column(String(2000), default="")
    jd_drive_url: Mapped[str] = mapped_column(String(2000), default="")

    model_name: Mapped[str] = mapped_column(String(100), default="")
