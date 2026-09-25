"""One-off schema initializer for the throwaway e2e SQLite database.

This is NOT a pytest test (pytest only collects `test_*.py` files, so it's
never picked up by `uv run pytest`) - it's a small setup script that the
frontend's Playwright suite runs before starting the backend, so the API has
real tables to read/write against instead of crashing on first query.

Usage (from `backend/`, with DATABASE_URL already pointed at a throwaway
file - see `frontend/playwright.config.ts`):

    DATABASE_URL=sqlite:////tmp/url-shortener-e2e.db uv run python -m tests.e2e_init_db

Deletes any existing file at the DATABASE_URL's path first, so re-running
the e2e suite always starts from an empty schema.
"""

import os

from sqlalchemy.engine import make_url

DATABASE_URL = os.environ.get("DATABASE_URL")

if not DATABASE_URL:
    raise SystemExit(
        "DATABASE_URL must be set to a throwaway sqlite database before "
        "running this script - refusing to guess."
    )

if not DATABASE_URL.startswith("sqlite"):
    raise SystemExit(
        f"Refusing to run against a non-sqlite DATABASE_URL ({DATABASE_URL!r}) "
        "- this script is only for the disposable e2e database."
    )

# Extract the filesystem path from the sqlite URL (handles sqlite:///path,
# sqlite:////abs/posix/path, and sqlite:///C:/win/path alike - unlike a
# hand-rolled regex, this also correctly leaves in-memory URLs (`:memory:`
# or no database at all) untouched instead of mangling them into a bogus
# relative path) and delete any leftover file from a previous run, so the
# schema (and any data) always starts fresh.
db_path = make_url(DATABASE_URL).database
if db_path and db_path != ":memory:" and os.path.exists(db_path):
    os.remove(db_path)

# Importing app.core.database.db builds the engine from the DATABASE_URL
# above; importing the models registers them on `Base` so create_all knows
# about the `urls` / `urls_stats` tables.
from app.core.database.db import Base, engine  # noqa: E402
from app.features.models.url import Url, UrlStats  # noqa: E402,F401

Base.metadata.create_all(bind=engine)
print(f"[e2e_init_db] Initialized schema at {DATABASE_URL}")
