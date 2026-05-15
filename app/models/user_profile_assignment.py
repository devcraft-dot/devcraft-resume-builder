from __future__ import annotations

from sqlalchemy import ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class UserProfileAssignment(Base):
    __tablename__ = "user_profile_assignments"
    __table_args__ = (
        UniqueConstraint("user_id", "profile_id", name="uq_user_profile"),
        Index("ix_user_profile_assignments_user_id", "user_id"),
        Index("ix_user_profile_assignments_profile_id", "profile_id"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    profile_id: Mapped[int] = mapped_column(
        ForeignKey("registered_profiles.id", ondelete="CASCADE")
    )

    user: Mapped["User"] = relationship(back_populates="profile_assignments")
    profile: Mapped["RegisteredProfile"] = relationship(back_populates="assignments")
