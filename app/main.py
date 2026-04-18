from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.generate import router as generate_router
from app.core.config import settings

import app.models.generation as _generation_model  # noqa: F401 — register table

app = FastAPI(title=settings.app_name)

# allow_credentials=True is incompatible with allow_origins=["*"] (Starlette/FastAPI).
# Chrome extensions send Origin: chrome-extension://<id>; ensure ACAO is always present
# (including on errors/timeouts where middleware might not add it).
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


app.include_router(generate_router)
