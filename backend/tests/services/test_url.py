from datetime import datetime, timedelta, timezone

import base62
import pytest
from fastapi import status
from sqlalchemy import select

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
    shorten_url("https://example.com", None, db_session)
    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_409_CONFLICT

    rows = db_session.execute(select(Url)).scalars().all()
    assert len(rows) == 1


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
