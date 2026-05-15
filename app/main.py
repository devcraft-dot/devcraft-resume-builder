import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.exc import ProgrammingError
from sqlalchemy.orm import Session
from starlette.responses import JSONResponse, Response

from app.api.routes.admin import router as admin_router
from app.api.routes.auth import router as auth_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.generate import router as generate_router
from app.api.routes.me import router as me_router
from app.api.routes.upload import router as upload_router
from app.core.bootstrap import bootstrap_admin_if_needed
from app.core.config import settings
from app.core.db import get_db
from app.core.token_util import normalize_api_token
from app.models.user import User

import app.models  # noqa: F401 — register all tables

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.core.db import Base, _engine

    Base.metadata.create_all(bind=_engine())
    bootstrap_admin_if_needed()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)


@app.exception_handler(ProgrammingError)
async def sqlalchemy_programming_error_handler(_request: Request, exc: ProgrammingError):
    """Postgres undefined_column etc. → clear 503 instead of opaque 500 (common after auth migration)."""
    logger.exception("SQLAlchemy ProgrammingError: %s", exc)
    orig = getattr(exc, "orig", None)
    msg = (str(orig) if orig is not None else str(exc)).lower()
    detail = "Database query failed."
    if "undefinedcolumn" in msg or ("column" in msg and "does not exist" in msg):
        detail = (
            "Database schema is out of date for this API build. On Postgres, run "
            "migrations/002_users_password_jwt.sql (see file comments), or apply "
            "migrations/001_add_auth_and_profiles.sql on a fresh database. Then redeploy."
        )
    return JSONResponse(status_code=503, content={"detail": detail})


# allow_credentials=True is incompatible with allow_origins=["*"] (Starlette/FastAPI).
# Chrome extensions send Origin: chrome-extension://<id>; ensure ACAO is always present
# (including on errors/timeouts where middleware might not add CORS).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_origin_regex=r"^chrome-extension://.+$",
    allow_credentials=False,
    allow_methods=["*"],
    # Explicit list: some browsers/CDNs treat allow_headers=["*"] oddly for preflight + Authorization.
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Accept",
        "X-Resume-Auth",
    ],
)


@app.middleware("http")
async def ensure_cors_allow_origin(request: Request, call_next):
    """Belt-and-suspenders: some proxies/error paths omit ACAO; extension fetch then fails CORS."""
    response = await call_next(request)
    if not response.headers.get("access-control-allow-origin"):
        response.headers["Access-Control-Allow-Origin"] = "*"
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/ready")
def api_ready(db: Session = Depends(get_db)):
    """Public deploy check: confirms DB + whether any admin exists (no secrets)."""
    admin_n = int(
        db.scalar(select(func.count()).select_from(User).where(User.role == "admin")) or 0
    )
    user_n = int(db.scalar(select(func.count()).select_from(User)) or 0)
    env_bootstrap = bool(normalize_api_token(settings.bootstrap_admin_password))
    jwt_ok = bool((settings.jwt_secret_key or "").strip())
    hints: list[str] = []
    if admin_n == 0 and env_bootstrap:
        hints.append(
            "No admin row yet; call POST /api/auth/login (or wait for lifespan bootstrap on cold start)."
        )
    if admin_n > 0 and env_bootstrap:
        hints.append(
            "If you cannot sign in: use the correct username/password, or set BOOTSTRAP_REPLACE_ADMIN=true "
            "once with BOOTSTRAP_ADMIN_PASSWORD to reset admins."
        )
    if not jwt_ok:
        hints.append("Set JWT_SECRET_KEY in the API environment (required for login tokens).")
    return {
        "status": "ok",
        "admin_users": admin_n,
        "total_users": user_n,
        "bootstrap_admin_password_env_set": env_bootstrap,
        "bootstrap_replace_admin_env_set": bool(settings.bootstrap_replace_admin),
        "jwt_secret_configured": jwt_ok,
        "hints": hints,
    }


@app.options("/{full_path:path}")
async def cors_preflight(full_path: str, request: Request) -> Response:
    """Explicit OPTIONS so preflight always gets ACAO (some proxies strip middleware CORS)."""
    req_headers = request.headers.get("access-control-request-headers", "")
    # Echo browser-requested headers; include fallbacks for SPA + extension clients.
    allow_headers = (
        req_headers
        if req_headers
        else "Authorization, Content-Type, Accept, X-Resume-Auth"
    )
    return Response(
        status_code=204,
        headers={
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": allow_headers,
            "Access-Control-Max-Age": "86400",
        },
    )


app.include_router(auth_router)
app.include_router(generate_router)
app.include_router(dashboard_router)
app.include_router(upload_router)
app.include_router(admin_router)
app.include_router(me_router)
