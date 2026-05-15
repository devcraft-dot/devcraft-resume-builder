from datetime import datetime, timezone
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


@lru_cache(maxsize=1)
def _engine():
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_size=1,
        max_overflow=2,
        pool_recycle=300,
    )


@lru_cache(maxsize=1)
def _session_factory() -> sessionmaker:
    """One sessionmaker per process — avoids rebuilding the class on every HTTP request."""
    return sessionmaker(
        bind=_engine(),
        autoflush=False,
        autocommit=False,
        expire_on_commit=False,
    )


def get_db():
    db = _session_factory()()
    try:
        yield db
    finally:
        db.close()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
