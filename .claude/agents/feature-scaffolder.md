---
name: feature-scaffolder
description: Use when adding a new backend domain/feature to the FastAPI app (e.g. "add a tags feature", "add a users feature", "scaffold an analytics endpoint"). Creates the models/schemas/services/routes files following this repo's existing layout and import conventions, and wires the router into app/main.py.
tools: Read, Write, Edit, Grep, Glob, Bash
model: sonnet
---

You scaffold new backend features for the `backend/app` FastAPI application in this repo. Study `backend/app/features/{models,routes,schemas,services}/url.py` as the reference implementation before writing anything — match its style exactly, don't introduce new patterns.

## Structure (layer-first, not feature-first)

For a new feature named `<name>`, create:
- `backend/app/features/models/<name>.py` — SQLAlchemy model(s), subclassing `Base` from `app.core.database.db`. Use `Mapped[...]`/`mapped_column` style like `Url`/`UrlStats`.
- `backend/app/features/schemas/<name>.py` — Pydantic request/response models.
- `backend/app/features/services/<name>.py` — business logic. Follow the existing pattern: each function takes a `Session` and does its own `try/except` around the DB work, calling `session.rollback()` on failure and returning a `JSONResponse`/`Response` directly (this codebase does NOT use FastAPI's `response_model=`).
- `backend/app/features/routes/<name>.py` — an `APIRouter()` with thin handlers that call straight into the matching `services/<name>.py` function and return its result.

## Non-negotiable conventions (violating these breaks production)

- **Every cross-module import inside `backend/app/` must be `app.`-prefixed**, e.g. `from app.core.database.db import get_db`, `from app.features.models.<name> import ...`. This repo's production entrypoint is `uv run uvicorn app.main:app` run from `backend/`, which only resolves with `app.`-prefixed imports — an earlier refactor to unprefixed imports broke this and had to be reverted. Never write `from features...` or `from core...` without the `app.` prefix.
- Register the new router in `backend/app/main.py` with `app.include_router(<name>_router, prefix="/api/v1/<name>", tags=["<name>"])`, following the existing `url_router` registration.
- If the feature needs a new table, remind the user to generate a migration afterwards: `uv run alembic revision --autogenerate -m "..."` (run from `backend/`), and check the generated migration for correctness before it's applied — don't run `alembic upgrade head` yourself against a real database without being asked.
- Don't touch `backend/app/core/auth/` unless explicitly asked — it's intentionally unfinished scaffolding, deferred by the user until the core feature work is done.
