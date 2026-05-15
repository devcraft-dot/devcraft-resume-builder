"""Normalize API tokens from env / UI (Vercel copy-paste often adds quotes or newlines)."""


def normalize_api_token(raw: str | None) -> str:
    if not raw:
        return ""
    t = raw.strip().strip("\ufeff")  # BOM
    # Strip one layer of matching quotes if the whole value is quoted
    if len(t) >= 2 and t[0] in "\"'" and t[0] == t[-1]:
        t = t[1:-1].strip()
    return t
