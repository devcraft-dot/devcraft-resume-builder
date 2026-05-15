from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from starlette.responses import Response

from app.api.routes.admin_profiles import router as admin_profiles_router
from app.api.routes.auth import router as auth_router
from app.api.routes.dashboard import router as dashboard_router
from app.api.routes.generate import router as generate_router
from app.api.routes.upload import router as upload_router
from app.core.config import settings
from app.cors_utils import access_control_allow_origin

import app.models.application_screenshot as _application_screenshot_model  # noqa: F401
import app.models.generation as _generation_model  # noqa: F401 — register tables
import app.models.registered_profile as _registered_profile_model  # noqa: F401
import app.models.user as _user_model  # noqa: F401

app = FastAPI(title=settings.app_name)

# allow_credentials=True is incompatible with allow_origins=["*"] (Starlette/FastAPI).
# Outer middleware overwrites Access-Control-Allow-Origin to echo known Origins (e.g. *.vercel.app).
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
    """Always set ACAO on the final response (Vercel / proxies sometimes omit CORSMiddleware headers)."""
    response = await call_next(request)
    acao = access_control_allow_origin(request)
    response.headers["Access-Control-Allow-Origin"] = acao
    if acao != "*":
        response.headers["Vary"] = "Origin"
    return response


@app.get("/health")
def health():
    return {"status": "ok"}


@app.options("/{full_path:path}")
async def cors_preflight(full_path: str, request: Request) -> Response:
    """Explicit OPTIONS so preflight always gets ACAO + allowed headers (incl. X-Admin-Key)."""
    req_headers = request.headers.get("access-control-request-headers", "")
    allow_headers = req_headers if req_headers else "*"
    acao = access_control_allow_origin(request)
    h = {
        "Access-Control-Allow-Origin": acao,
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": allow_headers,
        "Access-Control-Max-Age": "86400",
    }
    if acao != "*":
        h["Vary"] = "Origin"
    return Response(status_code=204, headers=h)


app.include_router(auth_router)
app.include_router(admin_profiles_router)
app.include_router(generate_router)
app.include_router(dashboard_router)
app.include_router(upload_router)
