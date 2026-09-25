import json
from datetime import datetime, timedelta, timezone

import base62
import pytest
from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.features.models.url import Url, UrlStats
from app.features.services.url import (
    delete_url_function,
    get_url_information,
    get_url_stats_function,
    is_expired,
    shorten_url,
)


# --- is_expired ---------------------------------------------------------


def test_is_expired_none_is_not_expired():
    assert is_expired(None) is False


def test_is_expired_future_is_not_expired():
    future = datetime.now(timezone.utc) + timedelta(days=1)
    assert is_expired(future) is False


def test_is_expired_past_is_expired():
    past = datetime.now(timezone.utc) - timedelta(days=1)
    assert is_expired(past) is True


def test_is_expired_naive_datetime_is_treated_as_utc():
    # is_expired() assumes naive datetimes are UTC and localizes them before
    # comparing.
    naive_past = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(days=1)
    assert is_expired(naive_past) is True

    naive_future = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
    assert is_expired(naive_future) is False


# --- shorten_url ---------------------------------------------------------


def test_shorten_url_creates_row_with_base62_code(db_session):
    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_201_CREATED

    url_model = db_session.execute(select(Url)).scalar_one()
    assert url_model.url == "https://example.com"
    assert url_model.code == base62.encode(url_model.id)

    # stats row is created 1:1 alongside the url row
    stats = db_session.execute(select(UrlStats)).scalar_one()
    assert stats.url_id == url_model.id
    assert stats.clicks == 0


def test_shorten_url_response_body_shape(db_session):
    response = shorten_url("https://example.com", None, db_session)
    body = response.body

    import json

    payload = json.loads(body)
    assert payload["url"] == "https://example.com"
    assert payload["short_url"] == base62.encode(1)
    assert payload["expiry"] is None


def test_shorten_url_multiple_urls_yield_distinct_codes(db_session):
    r1 = shorten_url("https://example.com/one", None, db_session)
    r2 = shorten_url("https://example.com/two", None, db_session)

    rows = db_session.execute(select(Url)).scalars().all()
    codes = {row.code for row in rows}

    assert r1.status_code == status.HTTP_201_CREATED
    assert r2.status_code == status.HTTP_201_CREATED
    assert len(codes) == 2
    assert codes == {base62.encode(row.id) for row in rows}


def test_shorten_url_duplicate_url_returns_409(db_session):
    first = shorten_url("https://example.com", None, db_session)
    original_code = json.loads(first.body)["short_url"]

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "URL already shortened", "code": original_code}

    rows = db_session.execute(select(Url)).scalars().all()
    assert len(rows) == 1


def test_shorten_url_duplicate_of_expired_url_replaces_row_with_new_code(db_session):
    future = datetime.now(timezone.utc) + timedelta(days=1)
    # The service itself rejects an already-past expiry, so create the
    # soon-to-be-expired row via the service with a future expiry (giving it
    # a realistic base62 code), then flip its expiry into the past directly
    # to simulate a link that was valid when created and has since expired.
    create_response = shorten_url("https://example.com", future, db_session)
    old_code = json.loads(create_response.body)["short_url"]
    old_url_model = db_session.execute(select(Url)).scalar_one()
    old_id = old_url_model.id

    # Register a couple of clicks so the cascade-delete of the stats row is
    # actually meaningful (not just deleting an already-empty row).
    get_url_information(old_code, db_session)
    get_url_information(old_code, db_session)
    old_stats_id = old_url_model.stats.id

    old_url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    # Create an unrelated URL *after* the expired one so the expired row is
    # not the highest id in the table. SQLite (used in these tests) reuses
    # the max rowid once the row holding it is deleted, since the `id`
    # column isn't declared with the AUTOINCREMENT keyword. Without this,
    # the replacement row would coincidentally land on the exact same id
    # (and therefore the same base62 code) as the row it replaced, masking
    # what would be a genuinely new id on Postgres in production.
    shorten_url("https://unrelated.com", None, db_session)

    new_expiry = datetime.now(timezone.utc) + timedelta(days=2)
    response = shorten_url("https://example.com", new_expiry, db_session)

    assert response.status_code == status.HTTP_201_CREATED
    payload = json.loads(response.body)
    new_code = payload["short_url"]
    assert new_code != old_code

    # The old row -- and its stats row, via cascade -- is gone.
    assert (
        db_session.execute(select(Url).where(Url.id == old_id)).scalar_one_or_none()
        is None
    )
    assert (
        db_session.execute(
            select(UrlStats).where(UrlStats.id == old_stats_id)
        ).scalar_one_or_none()
        is None
    )

    # Exactly one Url row exists for this url, with exactly one fresh stats
    # row attached to it.
    rows = db_session.execute(
        select(Url).where(Url.url == "https://example.com")
    ).scalars().all()
    assert len(rows) == 1
    new_url_model = rows[0]
    assert new_url_model.id != old_id
    assert new_url_model.code == new_code
    assert new_url_model.code == base62.encode(new_url_model.id)

    stats_rows = db_session.execute(
        select(UrlStats).where(UrlStats.url_id == new_url_model.id)
    ).scalars().all()
    assert len(stats_rows) == 1
    assert stats_rows[0].clicks == 0

    actual_expiry = new_url_model.expiry
    assert actual_expiry is not None
    if actual_expiry.tzinfo is None:
        actual_expiry = actual_expiry.replace(tzinfo=timezone.utc)
    assert abs((actual_expiry - new_expiry).total_seconds()) < 1


def test_shorten_url_duplicate_url_with_future_expiry_returns_409(db_session):
    # The boundary of the new "expired duplicate" branch: a live row with a
    # *future* expiry must still 409 with its existing code, same as a row
    # with no expiry at all.
    future = datetime.now(timezone.utc) + timedelta(days=1)
    first = shorten_url("https://example.com", future, db_session)
    original_code = json.loads(first.body)["short_url"]

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "URL already shortened", "code": original_code}

    rows = db_session.execute(select(Url)).scalars().all()
    assert len(rows) == 1


def test_shorten_url_integrity_error_race_falls_back_to_existing_row(
    db_session, monkeypatch
):
    # Simulate a concurrent insert: the pre-check query misses the row (as if
    # another request committed it in the gap between the check and the
    # flush), the flush then hits the unique constraint, and the fallback
    # re-query inside the except block finds the row that "just" landed.
    existing = Url(url="https://example.com", code="existing123", expiry=None)
    db_session.add(existing)
    db_session.commit()

    real_query = db_session.query
    calls = {"n": 0}

    class EmptyQuery:
        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return None

    def fake_query(model):
        calls["n"] += 1
        if calls["n"] == 1:
            return EmptyQuery()
        return real_query(model)

    def fake_flush():
        raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))

    monkeypatch.setattr(db_session, "query", fake_query)
    monkeypatch.setattr(db_session, "flush", fake_flush)

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "URL already shortened", "code": "existing123"}


def test_shorten_url_integrity_error_race_with_expired_row_returns_500(
    db_session, monkeypatch
):
    # Same shape as the race above, but the row the fallback re-query finds
    # is expired. An expired row isn't a "real" duplicate winning the race,
    # so this must surface as a 500, not a 409-with-code.
    past = datetime.now(timezone.utc) - timedelta(days=1)
    existing = Url(url="https://example.com", code="expired123", expiry=past)
    db_session.add(existing)
    db_session.commit()

    real_query = db_session.query
    calls = {"n": 0}

    class EmptyQuery:
        def filter(self, *args, **kwargs):
            return self

        def first(self):
            return None

    def fake_query(model):
        calls["n"] += 1
        if calls["n"] == 1:
            return EmptyQuery()
        return real_query(model)

    def fake_flush():
        raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))

    monkeypatch.setattr(db_session, "query", fake_query)
    monkeypatch.setattr(db_session, "flush", fake_flush)

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    payload = json.loads(response.body)
    assert payload == {"message": "Error shortening the URL"}


def test_shorten_url_failed_replacement_of_expired_row_rolls_back_and_returns_500(
    db_session, monkeypatch
):
    # Unlike the race tests above (which fake `query` so the delete-and-
    # recreate branch never actually runs), this exercises the real failed-
    # replacement path: the expired row's DELETE really executes, the
    # *second* flush (the new row's INSERT) blows up, and the resulting
    # rollback must restore the original expired row -- not leave the table
    # empty or half-migrated.
    future = datetime.now(timezone.utc) + timedelta(days=1)
    create_response = shorten_url("https://example.com", future, db_session)
    old_code = json.loads(create_response.body)["short_url"]
    old_url_model = db_session.execute(select(Url)).scalar_one()
    old_id = old_url_model.id

    get_url_information(old_code, db_session)
    get_url_information(old_code, db_session)
    old_stats_id = old_url_model.stats.id

    old_url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    real_flush = db_session.flush
    calls = {"n": 0}

    def fake_flush(*args, **kwargs):
        calls["n"] += 1
        if calls["n"] == 1:
            # The DELETE flush for the expired row: let it really execute.
            return real_flush(*args, **kwargs)
        # The INSERT flush for the replacement row: simulate a failure.
        raise IntegrityError("INSERT", {}, Exception("simulated"))

    monkeypatch.setattr(db_session, "flush", fake_flush)

    response = shorten_url("https://example.com", None, db_session)

    monkeypatch.undo()

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    payload = json.loads(response.body)
    assert payload == {"message": "Error shortening the URL"}

    rows = db_session.execute(
        select(Url).where(Url.url == "https://example.com")
    ).scalars().all()
    assert len(rows) == 1
    restored = rows[0]
    assert restored.id == old_id
    assert restored.code == old_code
    assert is_expired(restored.expiry)

    stats = db_session.execute(
        select(UrlStats).where(UrlStats.id == old_stats_id)
    ).scalar_one_or_none()
    assert stats is not None
    assert stats.clicks == 2


def test_shorten_url_integrity_error_without_matching_row_returns_500(
    db_session, monkeypatch
):
    # An IntegrityError not caused by the `url` unique constraint (or one
    # where the fallback re-query otherwise finds nothing) should surface as
    # a generic 500 rather than a bogus 409.
    def fake_flush():
        raise IntegrityError("INSERT", {}, Exception("some other constraint"))

    monkeypatch.setattr(db_session, "flush", fake_flush)

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    payload = json.loads(response.body)
    assert payload == {"message": "Error shortening the URL"}

    rows = db_session.execute(select(Url)).scalars().all()
    assert rows == []


def test_shorten_url_with_future_expiry_succeeds(db_session):
    future = datetime.now(timezone.utc) + timedelta(days=1)
    response = shorten_url("https://example.com", future, db_session)

    assert response.status_code == status.HTTP_201_CREATED

    url_model = db_session.execute(select(Url)).scalar_one()
    assert url_model.expiry is not None


def test_shorten_url_with_past_expiry_returns_400(db_session):
    past = datetime.now(timezone.utc) - timedelta(days=1)
    response = shorten_url("https://example.com", past, db_session)

    assert response.status_code == status.HTTP_400_BAD_REQUEST

    rows = db_session.execute(select(Url)).scalars().all()
    assert rows == []


# --- get_url_information --------------------------------------------------


def test_get_url_information_returns_url_and_increments_clicks(db_session):
    shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()

    response = get_url_information(url_model.code, db_session)

    assert response.status_code == status.HTTP_200_OK

    db_session.refresh(url_model.stats)
    assert url_model.stats.clicks == 1

    response_2 = get_url_information(url_model.code, db_session)
    assert response_2.status_code == status.HTTP_200_OK
    db_session.refresh(url_model.stats)
    assert url_model.stats.clicks == 2


def test_get_url_information_unknown_code_returns_404(db_session):
    response = get_url_information("doesnotexist", db_session)
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_get_url_information_expired_returns_410_and_does_not_count_click(db_session):
    future = datetime.now(timezone.utc) + timedelta(days=1)
    shorten_url("https://example.com", future, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()

    # flip expiry into the past directly on the row to simulate elapsed time
    url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = get_url_information(url_model.code, db_session)

    assert response.status_code == status.HTTP_410_GONE

    db_session.refresh(url_model.stats)
    assert url_model.stats.clicks == 0


# --- get_url_stats_function ------------------------------------------------


def test_get_url_stats_returns_clicks(db_session):
    shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()

    get_url_information(url_model.code, db_session)
    get_url_information(url_model.code, db_session)

    response = get_url_stats_function(url_model.code, db_session)
    assert response.status_code == status.HTTP_200_OK

    import json

    payload = json.loads(response.body)
    assert payload["clicks"] == 2
    assert payload["url"] == "https://example.com"


def test_get_url_stats_unknown_code_returns_404(db_session):
    response = get_url_stats_function("doesnotexist", db_session)
    assert response.status_code == status.HTTP_404_NOT_FOUND


# --- delete_url_function -----------------------------------------------


def test_delete_url_removes_row_and_cascades_stats(db_session):
    shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code
    url_id = url_model.id

    response = delete_url_function(code, db_session)
    assert response.status_code == status.HTTP_204_NO_CONTENT

    assert db_session.execute(select(Url).where(Url.id == url_id)).scalar_one_or_none() is None
    assert (
        db_session.execute(select(UrlStats).where(UrlStats.url_id == url_id)).scalar_one_or_none()
        is None
    )


def test_delete_url_unknown_code_returns_404(db_session):
    response = delete_url_function("doesnotexist", db_session)
    assert response.status_code == status.HTTP_404_NOT_FOUND
