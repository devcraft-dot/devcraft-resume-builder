from datetime import datetime, timezone
import threading
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings


class Base(DeclarativeBase):
    pass


_schema_lock = threading.Lock()
_schema_ready = False


def ensure_schema() -> None:
    """Create tables once (no FastAPI lifespan). Safe to call from get_db."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        Base.metadata.create_all(bind=_engine())
        _schema_ready = True


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
    ensure_schema()
    db = _session_factory()()
    try:
        yield db
    finally:
        db.close()


def utc_now() -> datetime:
    return datetime.now(timezone.utc)
