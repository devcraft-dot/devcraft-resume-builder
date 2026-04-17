from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.generate import router as generate_router
from app.core.config import settings

import app.models.generation as _generation_model  # noqa: F401 — register table

app = FastAPI(title=settings.app_name)

# allow_credentials=True is incompatible with allow_origins=["*"] (Starlette/FastAPI).
# Without a reflected ACAO header, browsers block extension and web cross-origin calls.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(generate_router)
