# Resume Builder — Agent Instructions

Read `PROJECT.md` for architecture. Do **not** re-scan the repo unless the active task requires it.

## Stack (short)

| Area | Path | Notes |
|------|------|-------|
| Backend | `app/` | FastAPI, SQLAlchemy, PostgreSQL |
| Dashboard | `dashboard/` | Vite, React 19, TS, Tailwind 4 |
| Extension | `extensions/indeed/` | MV3 Chrome extension |
| Deploy | `api/index.py`, `vercel.json` | Vercel serverless |

## Token budget (mandatory)

1. Read `.cursor/plans/ACTIVE_TASK.md` first. Work **only** on that scope.
2. Do not explore unrelated directories (`scrapping/`, `samples/`, `docs/` unless the task says so).
3. Before editing, name the exact files you will touch (max ~5 unless the task lists more).
4. Prefer `grep` / targeted reads over broad directory listing.
5. One logical change per chat. When done, update `ACTIVE_TASK.md` status — do not start the next task in the same chat.
6. No unsolicited docs, refactors, or tests. No `git commit` unless asked.
7. Ask one clarifying question if blocked; do not guess across the codebase.

## Code conventions

- **Python:** Match existing route/service layout under `app/`. Config via `app/core/config.py` and env vars — never hardcode secrets.
- **Dashboard:** API client in `dashboard/src/api/client.ts`; use `VITE_API_URL`.
- **Tests:** Only run tests the task specifies (e.g. `npm run lint` in `dashboard/`, targeted pytest if added later).
- **Diffs:** Minimal, focused changes. Reuse existing helpers in `app/services/`.

## Common commands

```bash
# Backend (repo root)
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Dashboard
cd dashboard && npm install && npm run dev
cd dashboard && npm run lint
```

## When stuck

Stop and report: what you tried, which file(s), what is missing. Do not widen scope.
