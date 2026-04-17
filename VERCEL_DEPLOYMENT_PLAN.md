# Vercel Deployment Plan

> Make the FastAPI backend deployable on Vercel with Neon PostgreSQL.

---

## Current State vs. Vercel-Ready

| Area | Current | Vercel-Ready |
|------|---------|--------------|
| Entry point | `app/main.py` | `api/index.py` re-exports the FastAPI app |
| DB | Local PostgreSQL | Neon pooled connection string |
| Schema creation | `create_all` on every boot | One-time migration via CLI |
| .docx files | Saved to `app/output/` on disk | Built in-memory (`BytesIO`), never touch disk |
| Drive upload | Reads file from disk path | Reads from `BytesIO` buffer directly |
| Google Doc | Uploads static `.docx` | Uploads with conversion to native Google Doc |
| Config | `.env` file in `app/` | Vercel environment variables (pydantic-settings auto-reads) |
| `output_dir` setting | Points to local folder | Removed entirely |

---

## 1. Project Structure Change

```
resume-builder/
  api/
    index.py              # Vercel entry point — just re-exports app
  app/
    main.py               # FastAPI app (unchanged logic)
    core/
      config.py
      db.py
    models/
      generation.py
    schemas/
      generate.py
    services/
      openai_service.py
      document_service.py
      resume_docx_formatter.py
      drive_service.py
      sheets_service.py
    credentials/          # NOT deployed — use env vars for secrets
  requirements.txt        # Moved to repo root for Vercel
  vercel.json             # Vercel routing config
```

### `api/index.py` (new — 2 lines)

```python
from app.main import app
```

### `vercel.json` (new)

```json
{
  "builds": [
    { "src": "api/index.py", "use": "@vercel/python" }
  ],
  "routes": [
    { "src": "/(.*)", "dest": "api/index.py" }
  ]
}
```

---

## 2. In-Memory .docx (no filesystem)

Replace file-path-based flow with `BytesIO` buffers:

```python
# document_service.py — return BytesIO instead of file path
from io import BytesIO

def build_resume_docx(...) -> tuple[BytesIO, str]:
    """Returns (buffer, filename) instead of a file path."""
    doc = ...  # build as before
    buf = BytesIO()
    doc.save(buf)
    buf.seek(0)
    return buf, filename

# drive_service.py — accept BytesIO
from googleapiclient.http import MediaIoBaseUpload

def upload_buffer(buf: BytesIO, filename: str) -> str:
    metadata = {
        "name": filename,
        "mimeType": "application/vnd.google-apps.document",  # auto-convert to Google Doc
    }
    if settings.google_drive_folder_id:
        metadata["parents"] = [settings.google_drive_folder_id]

    media = MediaIoBaseUpload(buf, mimetype="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    uploaded = service.files().create(body=metadata, media_body=media, fields="id,webViewLink").execute()
    ...
    return uploaded.get("webViewLink", "")
```

This also means **uploaded files become native Google Docs** (editable), not static `.docx`.

---

## 3. Neon PostgreSQL Connection

Neon provides two connection strings:
- **Pooled** (for app): `postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/dbname?sslmode=require`
- **Direct** (for migrations): `postgresql://user:pass@ep-xxx.region.aws.neon.tech/dbname?sslmode=require`

### `config.py` change

```python
class Settings(BaseSettings):
    database_url: str = ""  # Set via Vercel env var → Neon pooled string
    ...
```

### `db.py` change — serverless-friendly pool

```python
engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,
    pool_size=1,         # Serverless: minimal pool
    max_overflow=2,      # Allow a couple extra during bursts
    pool_recycle=300,     # Recycle connections every 5 min (Neon idle timeout)
)
```

---

## 4. Remove Startup Schema Creation

Currently `main.py` runs `Base.metadata.create_all(bind=engine)` on import. In serverless, this runs on every cold start (wasteful) and can race if multiple instances start simultaneously.

**Fix:** Remove it from `main.py`. Run migrations once from local machine:

```bash
# One-time: create the table against Neon (direct connection)
python -c "
from app.core.db import Base, engine
import app.models.generation
Base.metadata.create_all(bind=engine)
"
```

Or use Alembic for proper migrations later.

---

## 5. Google Drive Credentials in Serverless

Current code reads JSON files from `app/credentials/`. On Vercel there's no filesystem for secrets.

**Options (pick one):**

**A. Store credentials as env var (recommended):**
```python
import json, os
from google.oauth2.service_account import Credentials

creds_json = json.loads(os.environ["GOOGLE_SERVICE_ACCOUNT_JSON"])
creds = Credentials.from_service_account_info(creds_json, scopes=SCOPES)
```

**B. For Drive OAuth (user tokens):**
Store the token JSON as an env var too:
```python
token_json = json.loads(os.environ.get("DRIVE_TOKEN_JSON", "{}"))
creds = Credentials.from_authorized_user_info(token_json, DRIVE_SCOPES)
```

---

## 6. Remove `output_dir`

- Delete `output_dir` from `config.py` and `.env.example`
- Delete `_output_dir()` helper from `document_service.py` and `resume_docx_formatter.py`
- All .docx building returns `BytesIO` buffers, never touches disk

---

## 7. Move `requirements.txt` to Repo Root

Vercel expects `requirements.txt` at the repo root (or next to `api/index.py`). Move it from `app/requirements.txt` to the repo root.

---

## Summary of File Changes

| File | Action |
|------|--------|
| `api/index.py` | **New** — 2-line Vercel entry point |
| `vercel.json` | **New** — builds + routes config |
| `requirements.txt` | **Move** from `app/` to repo root |
| `app/main.py` | Remove `create_all` call |
| `app/core/config.py` | Remove `output_dir`, add `google_service_account_json` env var option |
| `app/core/db.py` | Serverless pool settings (`pool_size=1`, `pool_recycle=300`) |
| `app/services/document_service.py` | Return `BytesIO` buffers instead of file paths |
| `app/services/resume_docx_formatter.py` | Return `BytesIO` buffer instead of saving to disk |
| `app/services/drive_service.py` | Accept `BytesIO` + filename, use `MediaIoBaseUpload`, add Google Doc conversion |
| `app/services/sheets_service.py` | Load credentials from env var JSON instead of file |
| `app/api/routes/generate.py` | Update to pass buffers instead of file paths |
| `app/.env.example` | Update for Neon URL, remove output_dir, add JSON credential vars |

---

## Environment Variables (Vercel Dashboard)

```
DATABASE_URL=postgresql://user:pass@ep-xxx-pooler.region.aws.neon.tech/resume_builder?sslmode=require
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...
DEEPSEEK_BASE_URL=https://api.deepseek.com
GOOGLE_DRIVE_FOLDER_ID=1abc...
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"...","private_key":"..."}
DRIVE_TOKEN_JSON={"token":"...","refresh_token":"...","client_id":"...","client_secret":"..."}
GOOGLE_SHEETS_ID=1xyz...
```
