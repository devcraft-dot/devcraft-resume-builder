from datetime import datetime, timezone
import logging
import threading
from functools import lru_cache

from fastapi import HTTPException
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)


class Base(DeclarativeBase):
    pass


_schema_lock = threading.Lock()
_schema_ready = False


def _register_models() -> None:
    """Import all ORM modules so Base.metadata knows every table before create_all."""
    import app.models.application_screenshot as _application_screenshot_model  # noqa: F401
    import app.models.generation as _generation_model  # noqa: F401
    import app.models.registered_profile as _registered_profile_model  # noqa: F401
    import app.models.user as _user_model  # noqa: F401


def _dialect_name(engine) -> str:
    return (engine.dialect.name or "").lower()


def _add_column_if_missing(
    conn,
    insp,
    *,
    table: str,
    column: str,
    ddl_pg: str,
    ddl_default: str,
    dialect: str,
) -> None:
    if not insp.has_table(table):
        return
    cols = {c["name"] for c in insp.get_columns(table)}
    if column in cols:
        return
    if dialect == "postgresql":
        conn.execute(text(ddl_pg))
    else:
        conn.execute(text(ddl_default))
    logger.info("Schema patch: added %s.%s", table, column)


def _patch_existing_tables(engine) -> None:
    """
    SQLAlchemy create_all does not add new columns to tables that already exist.
    Patch older databases that predate client_username / registered_profiles auth work.
    """
    dialect = _dialect_name(engine)
    with engine.begin() as conn:
        insp = inspect(conn)
        _add_column_if_missing(
            conn,
            insp,
            table="generations",
            column="client_username",
            dialect=dialect,
            ddl_pg="ALTER TABLE generations ADD COLUMN IF NOT EXISTS client_username VARCHAR(200)",
            ddl_default="ALTER TABLE generations ADD COLUMN client_username VARCHAR(200)",
        )
        _add_column_if_missing(
            conn,
            insp,
            table="application_screenshots",
            column="client_username",
            dialect=dialect,
            ddl_pg=(
                "ALTER TABLE application_screenshots "
                "ADD COLUMN IF NOT EXISTS client_username VARCHAR(200)"
            ),
            ddl_default=(
                "ALTER TABLE application_screenshots "
                "ADD COLUMN client_username VARCHAR(200)"
            ),
        )


def ensure_schema() -> None:
    """Create tables once (no FastAPI lifespan). Safe to call from get_db."""
    global _schema_ready
    if _schema_ready:
        return
    with _schema_lock:
        if _schema_ready:
            return
        url = (settings.database_url or "").strip()
        if not url:
            raise HTTPException(
                status_code=503,
                detail="DATABASE_URL is not configured on this deployment.",
            )
        eng = _engine()
        _register_models()
        try:
            Base.metadata.create_all(bind=eng)
            _patch_existing_tables(eng)
        except Exception as e:
            logger.exception("ensure_schema failed")
            raise HTTPException(
                status_code=503,
                detail=f"Database schema setup failed: {e!s}"[:500],
            ) from e
        _schema_ready = True


@lru_cache(maxsize=1)
def _engine():
    url = (settings.database_url or "").strip()
    # Neon / Vercel often provide postgres:// — SQLAlchemy 2 + psycopg needs postgresql+psycopg://
    if url.startswith("postgres://"):
        url = "postgresql+psycopg://" + url[len("postgres://") :]
    elif url.startswith("postgresql://") and "+psycopg" not in url.split("://", 1)[0]:
        url = "postgresql+psycopg://" + url[len("postgresql://") :]
    return create_engine(
        url,
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
