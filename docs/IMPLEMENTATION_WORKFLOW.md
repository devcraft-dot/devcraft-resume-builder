# Resume Builder — implementation workflow

This document describes how the **API**, **Manual JD Chrome extension**, and **dashboard** work together today: auth, data flow, and where state lives.

---

## 1. High-level architecture

| Piece | Role |
|--------|------|
| **FastAPI app** (`app/main.py`) | HTTP API, CORS, routers; **no** `lifespan` hook. |
| **SQLAlchemy + Postgres/SQLite** | `generations`, `users`, `application_screenshots`, etc. |
| **Manual JD extension** | Side panel UI + on-page rail; calls API with optional `Authorization: Bearer`. |
| **React dashboard** (`dashboard/`) | Reads same API; token in `localStorage`. |

There is **no server-side session store**. Identification is **only** the JWT in the `Authorization` header (when auth is enabled).

---

## 2. Application startup and database

- FastAPI is created **without** a `lifespan` context manager.
- On the **first request that opens a DB session**, `get_db()` in `app/core/db.py` calls `ensure_schema()` once (thread-locked), which runs `Base.metadata.create_all(...)`.
- **`GET /health`** does **not** touch the database; it always returns `{ "status": "ok" }`.
- Model modules are imported from `app/main.py` (side-effect imports) so all tables are registered on `Base` before `create_all` runs.

---

## 3. Configuration (environment)

Key settings come from `app/core/config.py` (Pydantic Settings), including optional `.env` in the app directory.

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | SQLAlchemy engine URL. |
| `JWT_SECRET` | **HS256 signing key** for access tokens. If empty, “auth off” mode (see below). |
| `JWT_EXPIRE_MINUTES` | Access token lifetime (default: 7 days). |
| `ADMIN_EMAILS` | Comma-separated emails that receive `is_admin=True` on **register** (in addition to the **first** user, who is always admin). |
| OpenAI / DeepSeek / Drive / Sheets vars | Resume generation and uploads (unchanged from product behavior). |

---

## 4. Authentication model (stateless JWT)

### 4.1 When is auth “on”?

- **`auth_enabled()`** (`app/core/deps.py`) is `True` iff **`JWT_SECRET`** is non-empty after trim.
- If **`JWT_SECRET` is unset**:
  - `get_current_user_optional` returns **`None`** (no Bearer required for dependency wiring, but see protected routes below).
  - **`POST /api/auth/register`** and **`POST /api/auth/login`** return **400** (registration/login disabled).
  - Protected business routes treat the caller as **anonymous** where implemented (`user is None`), and **do not** require a Bearer header in that mode.

If **`JWT_SECRET` is set**:

- Protected routes require a valid **`Authorization: Bearer <access_token>`** header.
- Token is created at **login** or **register** (`app/core/security.py`: `create_access_token`).
- Each request: **`decode_access_token`** → payload `sub` (user id) → load **`User`** from DB.

### 4.2 JWT payload (claims)

| Claim | Meaning |
|-------|---------|
| `sub` | User id (string). |
| `email` | Email (informational). |
| `adm` | Admin flag at issue time. |
| `iat` / `exp` | Issued-at and expiry (Unix seconds). |

Passwords are stored as **bcrypt** hashes only (`hash_password` / `verify_password`).

### 4.3 Auth HTTP surface (`app/api/routes/auth.py`)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/api/auth/config` | `{ "auth_required": bool }` — mirrors `auth_enabled()`. |
| `POST` | `/api/auth/register` | Body: email + password; returns `access_token` + `user`. |
| `POST` | `/api/auth/login` | Same. |
| `GET` | `/api/me` | Requires Bearer; returns email, `is_admin`, `generation_count` (rows with `generations.user_id` = caller). |

**Admin rule on register:** first user in DB is admin; any email in `ADMIN_EMAILS` is admin; others are not.

---

## 5. Protected API behavior (when `JWT_SECRET` is set)

Routers enforce: **`if auth_enabled() and user is None: raise 401`**.

Affected areas (representative):

- **`app/api/routes/generate.py`**: `POST /api/generate`, `POST /api/generate/manual`, duplicate checks, list/get/patch/delete generations, etc. New generations get **`user_id`** set to the authenticated user (or `NULL` if auth off).
- **`app/api/routes/upload.py`**: Application screenshot upload and listing; scoped by `user_id` when not admin.
- **`app/api/routes/dashboard.py`**: Analytics; non-admins see only their `generations`.

**Ownership:** `ensure_generation_owner` blocks non-admins from touching another user’s generation row (when auth is on).

---

## 6. CORS and Chrome extension

- `CORSMiddleware` allows `*` origins and `chrome-extension://…` via regex.
- Extra middleware forces `Access-Control-Allow-Origin: *` if missing on the response (helps some proxies).
- **`OPTIONS /{path}`** returns explicit CORS preflight headers.

---

## 7. Manual JD extension workflow

**Paths:** `extensions/manual-jd/`

### 7.1 Components

| File | Role |
|------|------|
| `manifest.json` | MV3: `sidePanel`, `storage`, `tabs`, `scripting`; host permissions for API + Greenhouse/Ashby. |
| `manualExtensionCore.js` | Shared `API_URL`, SHA-256 canonical job URL (must match server), API helpers, **Bearer** from `chrome.storage.local`. |
| `content.js` | Shadow-DOM **rail**: autofill-from-job-tab (message to background) + open side panel. |
| `background.js` | Opens side panel; scrapes Greenhouse/Ashby tab via `chrome.scripting`; stashes payload in `chrome.storage.local` for the panel. |
| `popup.html` + `popup.js` | Side panel: Run (JD, questions, autofill, Start, downloads, screenshot), Profiles (sync `profiles`), Account (login/register/logout). |

### 7.2 Token storage (extension)

- Key: **`manualJd_accessToken`** in `chrome.storage.local`.
- API calls (`check-generation-keys`, `generate/manual`, screenshot upload) attach **`Authorization: Bearer`** when a token exists.

### 7.3 Typical user flows

1. **Account (optional):** Open **Account** tab → register or login → token stored → Run tab banner reflects signed-in state when `auth_required` is true (`GET /api/auth/config`).
2. **Autofill:** From rail or side panel → scrape job tab → fill fields; rail path uses background + `manualJd_autofillPayload` consumed by `popup.js`.
3. **Generate:** For each profile with text → `canonicalJobUrl` → `POST /api/check-generation-keys` → `POST /api/generate/manual` with job + profile + optional questions.
4. **Screenshot:** Multipart upload to `POST /api/upload/application-screenshot`; optional `job_urls_json` links rows to mark `generated` → `applied`.

### 7.4 Profiles

- Stored in **`chrome.storage.sync`** under key **`profiles`**, shared with the Indeed extension convention.

---

## 8. Dashboard workflow

**Paths:** `dashboard/src/`

- **`VITE_API_URL`**: Base URL for `fetch` (same host as API).
- **Token:** `localStorage` key **`rb_access_token`** (`dashboard/src/api/client.ts`).
- On load: **`GET /api/auth/config`** → if `auth_required` and no valid session, show login; **`POST /api/auth/login`** stores token; subsequent `request()` adds **`Authorization: Bearer`**.
- **`GET /api/me`** shows email, admin flag, and generation count in the header when authenticated.

---

## 9. Duplicate job identity (manual flow)

- If the user supplies a **reference URL**, it is truncated and used as the canonical job URL (dedupe key).
- Otherwise server + extension use the same **SHA-256** of `profile_name + title + company + JD` → URL shaped as `manual:<hex>` (see `app/schemas/generate.py` and `manualExtensionCore.js`).

Duplicate checks and screenshot linking use the same strings as stored on **`generations.url`**.

---

## 10. Operational checklist

1. Set **`DATABASE_URL`** and run the app; first DB request creates tables.
2. Set **`JWT_SECRET`** in the host environment (e.g. Vercel secret) to enforce Bearer auth and enable register/login.
3. Align **`API_URL`** in the extension and **`VITE_API_URL`** in the dashboard build with the deployed API origin.
4. Configure AI + Drive + Sheets env vars for full generation pipeline.

---

## 11. File map (quick reference)

| Area | Main entry / routes |
|------|---------------------|
| App | `app/main.py` |
| Auth deps | `app/core/deps.py` |
| JWT + passwords | `app/core/security.py` |
| DB session + schema | `app/core/db.py` |
| Auth routes | `app/api/routes/auth.py` |
| Generations | `app/api/routes/generate.py` |
| Screenshots | `app/api/routes/upload.py` |
| Analytics | `app/api/routes/dashboard.py` |
| Extension | `extensions/manual-jd/*` |
| Dashboard API client | `dashboard/src/api/client.ts` |

This document reflects the codebase as of the last update; if behavior diverges, prefer the source files above.
