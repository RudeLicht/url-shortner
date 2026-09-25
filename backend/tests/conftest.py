import os

# IMPORTANT: this must happen before anything under `app` (in particular
# app.core.database.db) is imported. app.core.database.db calls
# create_engine(os.getenv("DATABASE_URL")) at *import time*, so on a CI
# runner with no DATABASE_URL set, importing the app would crash with
# create_engine(None); locally it would instead build an engine pointing at
# the real Postgres database from backend/.env. We never want either of
# those, so we force DATABASE_URL to point at SQLite before any app import.
#
# python-dotenv's load_dotenv() (called inside app.core.database.db) does
# NOT override a variable that is already present in os.environ (its
# `override` kwarg defaults to False), so setting this here first is enough
# to win over whatever is in backend/.env even when that file exists
# locally.
os.environ["DATABASE_URL"] = "sqlite://"

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.database.db import Base, get_db
from app.main import app

# Dedicated in-memory SQLite engine used only by the tests. A single
# StaticPool connection is required so that the in-memory database survives
# across the multiple sessions/connections a test (and the app's request
# lifecycle) may open.
test_engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


# Guard: fail fast at collection time if we somehow ended up pointed at a
# real database instead of the in-memory SQLite one.
assert os.environ["DATABASE_URL"] == "sqlite://"
assert test_engine.url.get_backend_name() == "sqlite"


@pytest.fixture()
def db_session():
    """Function-scoped session against a fresh, empty in-memory SQLite schema."""
    Base.metadata.create_all(bind=test_engine)
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=test_engine)


@pytest.fixture()
def client(db_session):
    """TestClient with the app's get_db dependency overridden to use the
    test session, so requests never touch the real database."""

    def override_get_db():
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as test_client:
            yield test_client
    finally:
        app.dependency_overrides.clear()
