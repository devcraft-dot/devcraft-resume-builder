"""CORS helpers: echo Origin for known hosts (Vercel dashboard, localhost, extensions)."""

from __future__ import annotations

import re

from starlette.requests import Request

from app.core.config import settings

_VERCEL_APP = re.compile(r"^https://[a-z0-9.-]+\.vercel\.app$", re.IGNORECASE)
_CHROME_EXT = re.compile(r"^chrome-extension://[a-z0-9._~-]+$", re.IGNORECASE)
_LOCAL = re.compile(r"^http://(localhost|127\.0\.0\.1)(:\d+)?$", re.IGNORECASE)


def access_control_allow_origin(request: Request) -> str:
    """
    Value for Access-Control-Allow-Origin.
    Echo the request Origin when it is an allowed browser origin; otherwise use *.
    """
    origin = (request.headers.get("origin") or "").strip()
    if not origin:
        return "*"
    for o in (settings.cors_allow_origins or "").split(","):
        o = o.strip()
        if o and origin == o:
            return origin
    if _VERCEL_APP.match(origin) or _CHROME_EXT.match(origin) or _LOCAL.match(origin):
        return origin
    return "*"
