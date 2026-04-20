from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.generate import router as generate_router
from app.core.config import settings

import app.models.generation as _generation_model  # noqa: F401 — register table


@asynccontextmanager
async def lifespan(_app: FastAPI):
    from app.core.db import Base, _engine

    Base.metadata.create_all(bind=_engine())
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
    allow_headers=["*"],
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


@app.options("/{full_path:path}")
async def cors_preflight(full_path: str, request: Request) -> Response:
    """Explicit OPTIONS so preflight always gets ACAO (some proxies strip middleware CORS)."""
    req_headers = request.headers.get("access-control-request-headers", "")
    allow_headers = req_headers if req_headers else "*"
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
