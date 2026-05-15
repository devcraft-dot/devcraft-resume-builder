from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from starlette.responses import Response

from app.api.routes.admin import router as admin_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.generate import router as generate_router
from app.api.routes.me import router as me_router
from app.api.routes.upload import router as upload_router
from app.core.bootstrap import bootstrap_admin_if_needed
from app.core.config import settings
from app.core.db import get_db
from app.models.user import User

import app.models  # noqa: F401 — register all tables


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.core.db import Base, _engine

    Base.metadata.create_all(bind=_engine())
    bootstrap_admin_if_needed()
    yield


app = FastAPI(title=settings.app_name, lifespan=lifespan)

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
    return {
        "status": "ok",
        "admin_users": admin_n,
        "total_users": user_n,
        "bootstrap_admin_env_set": bool((settings.bootstrap_admin_token or "").strip()),
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


app.include_router(generate_router)
app.include_router(dashboard_router)
app.include_router(upload_router)
app.include_router(admin_router)
app.include_router(me_router)
