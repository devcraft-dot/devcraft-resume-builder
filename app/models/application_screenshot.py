from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Index, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ApplicationScreenshot(Base):
    """Pasted / snipped job-application screenshots uploaded from the Manual JD extension."""

    __tablename__ = "application_screenshots"
    __table_args__ = (Index("ix_application_screenshots_created_at", "created_at"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    generation_id: Mapped[int | None] = mapped_column(
        ForeignKey("generations.id", ondelete="SET NULL"), nullable=True, index=True
    )
    user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    drive_url: Mapped[str] = mapped_column(String(2000))
    filename: Mapped[str] = mapped_column(String(500))
    job_title: Mapped[str] = mapped_column(String(500), default="")
    company_name: Mapped[str] = mapped_column(String(500), default="")
    file_mime: Mapped[str] = mapped_column(String(80), default="")

    user: Mapped["User | None"] = relationship()
    generation: Mapped["Generation | None"] = relationship(
        back_populates="application_screenshots",
    )
