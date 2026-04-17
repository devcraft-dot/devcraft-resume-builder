# Backend Improvement Plan

> Current status snapshot taken 2026-04-17. This document covers clarity, brevity, and data-handling efficiency across the FastAPI + SQLAlchemy backend in `app/`.

---

## Table of Contents

1. [Dead / Duplicate Code](#1-dead--duplicate-code)
2. [Model Layer Cleanup](#2-model-layer-cleanup)
3. [Database & Query Efficiency](#3-database--query-efficiency)
4. [Schema & Validation Gaps](#4-schema--validation-gaps)
5. [Service Layer Simplification](#5-service-layer-simplification)
6. [Route Layer Cleanup](#6-route-layer-cleanup)
7. [Migration Strategy](#7-migration-strategy)
8. [Dependency & Config Hygiene](#8-dependency--config-hygiene)
9. [Error Handling Improvements](#9-error-handling-improvements)
10. [Priority Roadmap](#10-priority-roadmap)

---

## 1. Dead / Duplicate Code

### 1a. Remove `resume_service.py` + `ResumeGeneration` model

| Item | Detail |
|------|--------|
| `app/services/resume_service.py` | Uses legacy `client.responses.create` and persists to `ResumeGeneration` — **no route calls this**. |
| `app/models/resume.py` | Defines `ResumeGeneration` (`resume_generations` table) — not imported in `main.py`, so `create_all` never creates the table. |

**Action:** Delete both files. If `resume_generations` exists in your DB, add a `DROP TABLE IF EXISTS resume_generations` to `migrate.py` for one release, then remove it.

### 1b. Duplicate generation logic in `automation_service.py`

`automation_service.try_run_automation_pipeline` reimplements the same "for each profile → skip if exists → run_generation" loop that `generation_service.run_generations_for_all_profiles` already does. This means two places to maintain the same logic.

**Action:** Have `try_run_automation_pipeline` call `run_generations_for_all_profiles` directly and just wrap it with the automation-gate checks:

```python
def try_run_automation_pipeline(db: Session, job: Job) -> None:
    ws = get_workspace_settings_read()
    if not ws.automation_enabled or job.source not in ws.automation_sources:
        return
    try:
        run_generations_for_all_profiles(db, job)
    except ValueError:
        logger.warning("No profiles; skipping automation for job %s", job.id)
    except Exception:
        logger.exception("Automation failed for job %s", job.id)
```

### 1c. `get_all_jobs` is unused

`job_service.get_all_jobs` returns every job without pagination. No route calls it.

**Action:** Remove it or mark it explicitly as an internal utility if tests use it.

---

## 2. Model Layer Cleanup

### 2a. Extract shared `utc_now` helper

`utc_now()` is copy-pasted in **4 model files**. A one-liner change:

```python
# app/core/db.py  (add at bottom)
def utc_now() -> datetime:
    return datetime.now(timezone.utc)
```

Then import from `app.core.db` in each model instead of redefining.

### 2b. Drop redundant `index=True` on primary keys

All four models have `primary_key=True, index=True` on their `id` column. Primary keys are automatically indexed — `index=True` is redundant noise.

### 2c. Add ORM `relationship()` where it matters

Currently there are **zero** relationships defined, so every detail fetch requires manual joins/subqueries. Adding relationships would simplify service code:

```python
# job.py
generations: Mapped[list["Generation"]] = relationship(back_populates="job", lazy="select")

# generation.py
job: Mapped["Job"] = relationship(back_populates="generations")
profile: Mapped["ApplicationProfile | None"] = relationship()
```

With `selectinload` or `joinedload` in queries, this eliminates separate `get_generations_for_job` calls and the manual dict-building in `list_jobs_paginated`.

### 2d. Use `server_default` for timestamps

Instead of Python-side `default=utc_now`, use `server_default=func.now()` so the DB generates timestamps even for raw SQL inserts, and you avoid clock skew between app servers.

---

## 3. Database & Query Efficiency

### 3a. `list_jobs_paginated` — eliminate manual dict construction

Currently line 141 does:
```python
d = {c.key: getattr(job, c.key) for c in Job.__table__.columns}
```

This is fragile and verbose. With `from_attributes=True` on `JobRead`, just pass the ORM object:

```python
items = [
    JobRead.model_validate(job, update={"generation_count": gc or 0})
    for job, gc in rows
]
```

Or even cleaner: add a `generation_count` hybrid property or use a DTO.

### 3b. `check_urls_exist` — use batch `IN` query (already done, good)

This is already efficient. No change needed.

### 3c. Bulk ingest — avoid per-row commits

`ingest_job` calls `db.commit()` per row even in bulk mode. For 100-job bulk ingests this means 100 round-trips.

**Action:** Accept an optional `flush_only=True` parameter in `ingest_job`. In `bulk_ingest_jobs`, flush after each add but commit once at the end:

```python
def bulk_ingest_jobs(db, payloads):
    results = [ingest_job(db, p, commit=False, ...) for p in payloads]
    db.commit()
    return results
```

### 3d. `has_generation_for_profile` — use `EXISTS` instead of `COUNT`

`EXISTS` short-circuits on the first match; `COUNT` scans all matching rows:

```python
def has_generation_for_profile(db, job_id, profile_id):
    return db.query(
        exists().where(Generation.job_id == job_id, Generation.application_profile_id == profile_id)
    ).scalar()
```

### 3e. Repeated `get_workspace_settings_read()` in bulk loop

In `jobs.py` route `create_jobs_bulk`, `get_workspace_settings_read()` is called **inside the loop** for every saved job. It reads from disk each time.

**Action:** Read once before the loop:

```python
ws = get_workspace_settings_read()
for job, status in pairs:
    if status == "saved" and job and ws.automation_server_generate_on_ingest:
        try_run_automation_pipeline(db, job)
```

### 3f. Google Sheets `get_all_values()` on every append

`sheets_service.append_generation_row` fetches all sheet values to find the next row. For large sheets this is O(rows) per generation.

**Action:** Use `worksheet.append_row(values)` which appends without reading, or cache the row count per session.

---

## 4. Schema & Validation Gaps

### 4a. `JobCreate` lacks length/format validation

The DB enforces `String(500)` on `title` and `String(2000)` on `url`, but `JobCreate` has no `max_length` or `HttpUrl` type. An oversized string will crash with a DB error instead of a clean 422.

**Action:**

```python
class JobCreate(BaseModel):
    source: str = Field(..., min_length=1, max_length=100)
    title: str = Field(..., min_length=1, max_length=500)
    url: str = Field(..., min_length=1, max_length=2000)
    ...
```

### 4b. `check_urls` endpoint uses raw `dict` instead of Pydantic

```python
@router.post("/jobs/check-urls")
def check_urls(payload: dict, ...):
```

**Action:** Create a proper schema:

```python
class CheckUrlsRequest(BaseModel):
    urls: list[str]
```

### 4c. `JobRead.fields` type mismatch

Ingest uses `list[JobField]` but read returns `list[dict]`. This makes the API contract inconsistent.

**Action:** Use `list[JobField]` in `JobRead` as well, or document the intentional difference.

### 4d. `GenerationSummary` missing useful fields

Currently omits `resume_docx_path`, `answers_docx_path`, Drive URLs. If the frontend needs them, add optional fields. If not, this is fine.

---

## 5. Service Layer Simplification

### 5a. Consolidate generation orchestration

Three places touch generation logic:
- `generation_service.run_generation`
- `generation_service.run_generations_for_all_profiles`
- `automation_service.try_run_automation_pipeline`

After the fix in [1b](#1b-duplicate-generation-logic-in-automation_servicepy), only `generation_service` owns generation logic.

### 5b. `openai_client.py` — evaluate if a separate file is needed

It's a 22-line file with a single `get_openai_client()` function. Consider inlining it into `openai_service.py` since that's the only consumer, or keep it if you plan multiple AI consumers.

### 5c. `workspace_file_settings.py` reads from disk on every call

`get_workspace_settings_read()` reads JSON files from disk each time. For hot paths (bulk ingest loop), this is wasteful.

**Action:** Add a simple TTL cache or `functools.lru_cache` with a short expiry, or read-once-per-request pattern.

### 5d. Type hints on service functions

Many service functions use bare `job` parameter without type annotation:

```python
def run_generation(db: Session, job, profile: dict, ...) -> Generation:
```

**Action:** Type all parameters: `job: Job`, `profile: dict`, etc. This helps IDE support and catches bugs.

---

## 6. Route Layer Cleanup

### 6a. `jobs.py` — repeated `JobIngestResult` construction

Both `create_job` and `create_jobs_bulk` build `JobIngestResult` with the same pattern. Extract a helper:

```python
def _to_ingest_result(job: Job | None, status: str) -> JobIngestResult:
    return JobIngestResult(
        job=JobRead.model_validate(job) if job else None,
        saved=(status == "saved"),
        reason=None if status == "saved" else status,
    )
```

### 6b. `get_job` — redundant dict conversion

```python
job_data = JobRead.model_validate(job).model_dump()
job_data["generation_count"] = len(generations)
return JobDetailRead(**job_data, generations=...)
```

This validates → dumps → re-validates. Simplify with:

```python
return JobDetailRead.model_validate(job, update={
    "generation_count": len(generations),
    "generations": generations,
})
```

### 6c. Move profile CRUD out of `settings.py` router

`settings.py` handles both workspace settings **and** profile CRUD. These are different domains.

**Action:** Create `app/api/routes/profiles.py` with its own router. Keeps each file focused.

---

## 7. Migration Strategy

### 7a. Replace hand-rolled `migrate.py` with Alembic

The current approach (`ALTER TABLE` with column-existence checks) does not scale. It can't handle renames, type changes, or data migrations.

**Action:**
1. `pip install alembic` + `alembic init`
2. Generate an initial migration from current models (`alembic revision --autogenerate`)
3. Mark it as "already applied" with `alembic stamp head`
4. Future changes use `alembic revision --autogenerate -m "add_xyz"`
5. Remove `migrate.py` once Alembic is the source of truth

### 7b. Stop running `create_all` in production

`Base.metadata.create_all` on every startup is a development convenience. With Alembic, startup should just run `alembic upgrade head`.

---

## 8. Dependency & Config Hygiene

### 8a. Pin dependency versions

`requirements.txt` has **zero version pins**:

```
fastapi
uvicorn[standard]
sqlalchemy
...
```

A `pip install` today vs. next month could break things silently.

**Action:** Pin at least major.minor:

```
fastapi>=0.115,<1.0
sqlalchemy>=2.0,<3.0
pydantic>=2.0,<3.0
...
```

Or better: use `pip-compile` / `uv` to generate a lockfile.

### 8b. Add `app/__init__.py`

There is no `app/__init__.py`. While implicit namespace packages work, an explicit init prevents import ambiguity and tools like pytest discovering the package.

### 8c. Move `.env` outside `app/`

Having `.env` inside `app/` is unusual. Convention is repo root or a dedicated `config/` dir. This also means `config.py`'s `env_file` path uses `Path(__file__).parent.parent` which is fragile.

### 8d. CORS — restrict in production

`allow_origins=["*"]` is fine for dev but a security risk in production. Make it configurable:

```python
class Settings(BaseSettings):
    cors_origins: list[str] = ["*"]
```

---

## 9. Error Handling Improvements

### 9a. Structured error responses

Currently errors are bare strings in `HTTPException(detail=...)`. A consistent error envelope helps the frontend:

```python
class ErrorResponse(BaseModel):
    error: str
    detail: str | None = None
    code: str | None = None
```

### 9b. OpenAI errors surface as 500

If OpenAI returns a rate-limit or auth error, it bubbles as an unhandled 500. Wrap with a domain exception:

```python
try:
    response = client.responses.create(...)
except openai.APIError as e:
    raise GenerationError(f"OpenAI API error: {e}") from e
```

Then map `GenerationError` to a 502 or 503 in the route layer.

### 9c. Add request-level logging middleware

No request logging exists. A simple middleware that logs method, path, status, and duration would help debugging without adding per-route boilerplate.

---

## 10. Priority Roadmap

Grouped by effort and impact:

### Quick Wins (< 1 hour each)

| # | Change | Impact |
|---|--------|--------|
| 1 | Delete `resume_service.py` + `models/resume.py` | Remove dead code, reduce confusion |
| 2 | Extract `utc_now` to `core/db.py` | DRY across 4 files |
| 3 | Remove `index=True` from PK columns | Cleaner model definitions |
| 4 | Fix bulk-ingest workspace settings read (once before loop) | Fewer disk reads per request |
| 5 | Type-hint all service function parameters | Better IDE support, fewer bugs |
| 6 | Add `max_length` to `JobCreate` fields | Prevent DB-level crashes |
| 7 | Replace `dict` param in `check_urls` with Pydantic model | Type safety |

### Medium Effort (1-3 hours each)

| # | Change | Impact |
|---|--------|--------|
| 8 | Consolidate automation → call `run_generations_for_all_profiles` | Single source of truth for generation loop |
| 9 | Add ORM `relationship()` + use `selectinload` | Simpler queries, fewer round-trips |
| 10 | Bulk ingest: batch commit instead of per-row | Major perf boost for large ingests |
| 11 | Simplify `list_jobs_paginated` dict construction | Cleaner, less fragile code |
| 12 | Split profiles router out of `settings.py` | Separation of concerns |
| 13 | Pin dependency versions | Reproducible builds |
| 14 | Add request logging middleware | Observability |

### Larger Efforts (half-day+)

| # | Change | Impact |
|---|--------|--------|
| 15 | Migrate from hand-rolled `migrate.py` to Alembic | Proper schema evolution |
| 16 | Add structured error handling + OpenAI error wrapping | Better UX, no raw 500s |
| 17 | Workspace settings caching (TTL or per-request) | Reduce disk I/O on hot paths |
| 18 | Configurable CORS + production hardening | Security |

---

## Summary

The backend is well-structured for its size. The main themes for improvement are:

1. **Remove dead code** — `resume_service` + `ResumeGeneration` model, unused `get_all_jobs`
2. **DRY up patterns** — shared `utc_now`, consolidated generation loop, extracted route helpers
3. **Tighten validation** — Pydantic schemas should mirror DB constraints
4. **Optimize hot paths** — batch commits, `EXISTS` over `COUNT`, cache workspace settings
5. **Adopt Alembic** — the hand-rolled migration approach won't scale
6. **Pin dependencies** — zero version pins is a ticking time bomb
