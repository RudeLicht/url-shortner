"""Guard tests: make sure the test suite never touches the real database.

app.core.database.db builds its module-level `engine`/`SessionLocal` from
DATABASE_URL at import time. These tests confirm that, in the test process,
that resolves to the in-memory SQLite database forced by conftest.py rather
than the real Postgres URL that may be present in backend/.env locally.
"""

import os

from app.core.database import db as db_module
from tests.conftest import test_engine


def test_database_url_env_is_sqlite():
    assert os.environ["DATABASE_URL"] == "sqlite://"


def test_app_module_engine_is_sqlite():
    # app.core.database.db.engine was built at import time from the forced
    # DATABASE_URL, so it must be SQLite, never the real Postgres engine.
    assert db_module.engine.url.get_backend_name() == "sqlite"


def test_dedicated_test_engine_is_sqlite():
    assert test_engine.url.get_backend_name() == "sqlite"
