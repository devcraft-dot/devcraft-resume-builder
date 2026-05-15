from datetime import datetime, timezone
import logging
import threading
from functools import lru_cache

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


_schema_lock = threading.Lock()
_schema_ready = False


def _patch_existing_tables(engine) -> None:
    """
    SQLAlchemy create_all does not add new columns to tables that already exist.
    Patch older databases that predate client_username / registered_profiles auth work.
    """
    with engine.begin() as conn:
        insp = inspect(conn)
        if insp.has_table("generations"):
            cols = {c["name"] for c in insp.get_columns("generations")}
            if "client_username" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE generations ADD COLUMN client_username VARCHAR(200)"
                    )
                )
                logger.info("Schema patch: added generations.client_username")
        if insp.has_table("application_screenshots"):
            cols = {c["name"] for c in insp.get_columns("application_screenshots")}
            if "client_username" not in cols:
                conn.execute(
                    text(
                        "ALTER TABLE application_screenshots ADD COLUMN client_username VARCHAR(200)"
                    )
                )
                logger.info("Schema patch: added application_screenshots.client_username")


def ensure_schema() -> None:
    """Create tables once (no FastAPI lifespan). Safe to call from get_db."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        eng = _engine()
        Base.metadata.create_all(bind=eng)
        try:
            _patch_existing_tables(eng)
        except Exception:
            logger.exception("Schema patch (ALTER for new columns) failed — check DB permissions")
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
