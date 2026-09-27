import hashlib
import json
import re
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.features.models.url import Url, UrlStats
from app.features.schemas.url import UrlUpdate
from app.features.services.url import (
    CODE_LENGTH,
    delete_url_function,
    get_url_information,
    get_url_stats_function,
    is_expired,
    shorten_url,
    update_url_function,
)

CODE_PATTERN = re.compile(rf"^[0-9A-Za-z]{{{CODE_LENGTH}}}$")


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


def test_shorten_url_creates_row_with_random_code(db_session):
    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_201_CREATED

    url_model = db_session.execute(select(Url)).scalar_one()
    assert url_model.url == "https://example.com"
    assert CODE_PATTERN.fullmatch(url_model.code)

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
    assert CODE_PATTERN.fullmatch(payload["short_url"])
    assert payload["expiry"] is None
    assert isinstance(payload["delete_token"], str)
    assert payload["delete_token"] != ""


def test_shorten_url_owner_token_hash_is_sha256_of_returned_token(db_session):
    response = shorten_url("https://example.com", None, db_session)
    token = json.loads(response.body)["delete_token"]

    url_model = db_session.execute(select(Url)).scalar_one()

    assert url_model.owner_token_hash is not None
    assert len(url_model.owner_token_hash) == 64
    assert url_model.owner_token_hash != token
    assert url_model.owner_token_hash == hashlib.sha256(token.encode()).hexdigest()


def test_shorten_url_multiple_urls_yield_distinct_codes(db_session):
    r1 = shorten_url("https://example.com/one", None, db_session)
    r2 = shorten_url("https://example.com/two", None, db_session)

    rows = db_session.execute(select(Url)).scalars().all()
    codes = {row.code for row in rows}

    assert r1.status_code == status.HTTP_201_CREATED
    assert r2.status_code == status.HTTP_201_CREATED
    assert len(codes) == 2
    assert all(CODE_PATTERN.fullmatch(code) for code in codes)


def test_shorten_url_retries_on_code_collision(db_session, monkeypatch):
    existing = Url(url="https://existing.example.com", code="AAAAAAA", expiry=None)
    db_session.add(existing)
    db_session.commit()

    candidates = iter(["AAAAAAA", "BBBBBBB"])
    monkeypatch.setattr(
        "app.features.services.url._generate_code", lambda: next(candidates)
    )

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_201_CREATED
    payload = json.loads(response.body)
    assert payload["short_url"] == "BBBBBBB"


def test_shorten_url_returns_500_when_all_code_attempts_collide(db_session, monkeypatch):
    existing = Url(url="https://existing.example.com", code="AAAAAAA", expiry=None)
    db_session.add(existing)
    db_session.commit()

    monkeypatch.setattr(
        "app.features.services.url._generate_code", lambda: "AAAAAAA"
    )

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    payload = json.loads(response.body)
    assert payload == {"message": "Error shortening the URL"}

    rows = db_session.execute(
        select(Url).where(Url.url == "https://example.com")
    ).scalars().all()
    assert rows == []


def test_shorten_url_distinct_links_get_distinct_delete_tokens(db_session):
    r1 = shorten_url("https://example.com/one", None, db_session)
    r2 = shorten_url("https://example.com/two", None, db_session)

    token_1 = json.loads(r1.body)["delete_token"]
    token_2 = json.loads(r2.body)["delete_token"]

    assert token_1 != token_2

    code_2 = json.loads(r2.body)["short_url"]

    # link 1's token must not be able to delete link 2.
    cross_delete = delete_url_function(code_2, token_1, db_session)
    assert cross_delete.status_code == status.HTTP_403_FORBIDDEN

    assert (
        db_session.execute(select(Url).where(Url.code == code_2)).scalar_one_or_none()
        is not None
    )


def test_shorten_url_duplicate_url_returns_409(db_session):
    first = shorten_url("https://example.com", None, db_session)
    original_code = json.loads(first.body)["short_url"]

    response = shorten_url("https://example.com", None, db_session)

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "URL already shortened", "code": original_code}
    assert not any("token" in key.lower() or "hash" in key.lower() for key in payload)

    rows = db_session.execute(select(Url)).scalars().all()
    assert len(rows) == 1


def test_shorten_url_duplicate_of_expired_url_replaces_row_with_new_code(db_session):
    future = datetime.now(timezone.utc) + timedelta(days=1)
    # The service itself rejects an already-past expiry, so create the
    # soon-to-be-expired row via the service with a future expiry (giving it
    # a realistic random code), then flip its expiry into the past directly
    # to simulate a link that was valid when created and has since expired.
    create_response = shorten_url("https://example.com", future, db_session)
    old_code = json.loads(create_response.body)["short_url"]
    old_url_model = db_session.execute(select(Url)).scalar_one()

    # Register a couple of clicks so the cascade-delete of the stats row is
    # actually meaningful (not just deleting an already-empty row).
    get_url_information(old_code, db_session)
    get_url_information(old_code, db_session)

    old_url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    new_expiry = datetime.now(timezone.utc) + timedelta(days=2)
    response = shorten_url("https://example.com", new_expiry, db_session)

    assert response.status_code == status.HTTP_201_CREATED
    payload = json.loads(response.body)
    new_code = payload["short_url"]
    assert new_code != old_code

    # The old row -- and its stats row, via cascade -- is gone: no row keeps
    # the old code anymore.
    assert (
        db_session.execute(select(Url).where(Url.code == old_code)).scalar_one_or_none()
        is None
    )

    # Exactly one Url row exists for this url, with exactly one fresh stats
    # row attached to it.
    rows = db_session.execute(
        select(Url).where(Url.url == "https://example.com")
    ).scalars().all()
    assert len(rows) == 1
    new_url_model = rows[0]
    assert new_url_model.code == new_code

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


def test_shorten_url_duplicate_of_expired_url_gets_a_fresh_delete_token(db_session):
    # The replacement row created when a duplicate expired URL is
    # re-shortened must get its own delete_token: the old row's token must
    # stop working (there is no row left for it to match), and only the new
    # token should be able to delete the new code.
    future = datetime.now(timezone.utc) + timedelta(days=1)
    create_response = shorten_url("https://example.com", future, db_session)
    old_code = json.loads(create_response.body)["short_url"]
    old_token = json.loads(create_response.body)["delete_token"]

    old_url_model = db_session.execute(select(Url)).scalar_one()
    old_url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = shorten_url("https://example.com", None, db_session)
    assert response.status_code == status.HTTP_201_CREATED
    payload = json.loads(response.body)
    new_code = payload["short_url"]
    new_token = payload["delete_token"]

    assert new_token != old_token

    # The old token can no longer delete anything: the old row is gone, and
    # it must not incorrectly delete the new row at the same code either.
    old_token_attempt = delete_url_function(new_code, old_token, db_session)
    assert old_token_attempt.status_code == status.HTTP_403_FORBIDDEN
    assert (
        db_session.execute(select(Url).where(Url.code == new_code)).scalar_one_or_none()
        is not None
    )

    new_token_attempt = delete_url_function(new_code, new_token, db_session)
    assert new_token_attempt.status_code == status.HTTP_204_NO_CONTENT
    assert (
        db_session.execute(select(Url).where(Url.code == new_code)).scalar_one_or_none()
        is None
    )


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
    assert not any("token" in key.lower() or "hash" in key.lower() for key in payload)

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
    assert not any("token" in key.lower() or "hash" in key.lower() for key in payload)


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


# --- shorten_url (alias) --------------------------------------------------


def test_shorten_url_with_alias_uses_it_as_code(db_session):
    response = shorten_url("https://example.com", None, db_session, alias="my-alias")

    assert response.status_code == status.HTTP_201_CREATED
    payload = json.loads(response.body)
    assert payload["short_url"] == "my-alias"

    url_model = db_session.execute(select(Url)).scalar_one()
    assert url_model.code == "my-alias"


def test_shorten_url_alias_already_taken_returns_409(db_session):
    shorten_url("https://example.com/one", None, db_session, alias="taken")

    response = shorten_url("https://example.com/two", None, db_session, alias="taken")

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "Alias already taken", "error": "alias_taken"}
    assert "code" not in payload

    rows = db_session.execute(
        select(Url).where(Url.url == "https://example.com/two")
    ).scalars().all()
    assert rows == []


def test_shorten_url_cannot_reclaim_expired_alias_without_token(db_session):
    # A POST has no ownership proof. Even when the POST targets the exact
    # same url+alias as an existing (now expired) row, anyone could send it,
    # so it must not be able to delete that row and steal its alias -- the
    # owner must instead revive it via PATCH with their delete token.
    create_response = shorten_url(
        "https://x.example", None, db_session, alias="mine"
    )
    assert create_response.status_code == status.HTTP_201_CREATED

    url_model = db_session.execute(select(Url)).scalar_one()
    old_id = url_model.id
    url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = shorten_url("https://x.example", None, db_session, alias="mine")

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "Alias already taken", "error": "alias_taken"}
    assert "delete_token" not in payload

    db_session.expire_all()
    rows = db_session.execute(
        select(Url).where(Url.url == "https://x.example")
    ).scalars().all()
    assert len(rows) == 1
    assert rows[0].id == old_id
    assert rows[0].code == "mine"
    assert is_expired(rows[0].expiry)


def test_shorten_url_duplicate_live_url_with_alias_still_returns_duplicate_conflict(
    db_session,
):
    first = shorten_url("https://example.com", None, db_session)
    original_code = json.loads(first.body)["short_url"]

    response = shorten_url("https://example.com", None, db_session, alias="wanted")

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "URL already shortened", "code": original_code}

    # The alias must not have been consumed by the rejected request.
    assert (
        db_session.execute(select(Url).where(Url.code == "wanted")).scalar_one_or_none()
        is None
    )


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


def test_get_url_stats_response_excludes_delete_token_and_hash(db_session):
    shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()

    response = get_url_stats_function(url_model.code, db_session)
    payload = json.loads(response.body)

    assert not any("token" in key.lower() or "hash" in key.lower() for key in payload)


def test_get_url_information_response_excludes_delete_token_and_hash(db_session):
    shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()

    response = get_url_information(url_model.code, db_session)
    payload = json.loads(response.body)

    assert not any("token" in key.lower() or "hash" in key.lower() for key in payload)


# --- delete_url_function -----------------------------------------------


def test_delete_url_removes_row_and_cascades_stats(db_session):
    create_response = shorten_url("https://example.com", None, db_session)
    token = json.loads(create_response.body)["delete_token"]
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code
    url_id = url_model.id

    response = delete_url_function(code, token, db_session)
    assert response.status_code == status.HTTP_204_NO_CONTENT

    assert db_session.execute(select(Url).where(Url.id == url_id)).scalar_one_or_none() is None
    assert (
        db_session.execute(select(UrlStats).where(UrlStats.url_id == url_id)).scalar_one_or_none()
        is None
    )


def test_delete_url_unknown_code_returns_404(db_session):
    response = delete_url_function("doesnotexist", "some-token", db_session)
    assert response.status_code == status.HTTP_404_NOT_FOUND


def test_delete_url_missing_token_returns_403(db_session):
    create_response = shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code

    response = delete_url_function(code, None, db_session)
    assert response.status_code == status.HTTP_403_FORBIDDEN
    payload = json.loads(response.body)
    assert payload == {"message": "You are not allowed to delete this URL"}

    assert db_session.execute(select(Url).where(Url.code == code)).scalar_one_or_none() is not None


def test_delete_url_wrong_token_returns_403(db_session):
    shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code

    response = delete_url_function(code, "wrong-token", db_session)
    assert response.status_code == status.HTTP_403_FORBIDDEN
    payload = json.loads(response.body)
    assert payload == {"message": "You are not allowed to delete this URL"}

    assert db_session.execute(select(Url).where(Url.code == code)).scalar_one_or_none() is not None


def test_delete_url_empty_token_returns_403(db_session):
    create_response = shorten_url("https://example.com", None, db_session)
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code
    # Sanity: an empty string is falsy and must be treated the same as a
    # missing token, not compared against the real hash.
    assert json.loads(create_response.body)["delete_token"] != ""

    response = delete_url_function(code, "", db_session)
    assert response.status_code == status.HTTP_403_FORBIDDEN
    payload = json.loads(response.body)
    assert payload == {"message": "You are not allowed to delete this URL"}

    assert db_session.execute(select(Url).where(Url.code == code)).scalar_one_or_none() is not None


def test_delete_url_row_without_owner_token_hash_returns_403(db_session):
    # Pre-existing rows created before this feature have owner_token_hash =
    # NULL; they must never be deletable via any token.
    existing = Url(url="https://example.com", code="legacycode", expiry=None)
    existing.stats = UrlStats()
    db_session.add(existing)
    db_session.commit()

    response = delete_url_function("legacycode", "any-token", db_session)
    assert response.status_code == status.HTTP_403_FORBIDDEN
    payload = json.loads(response.body)
    assert payload == {"message": "You are not allowed to delete this URL"}

    assert (
        db_session.execute(select(Url).where(Url.code == "legacycode")).scalar_one_or_none()
        is not None
    )


def test_delete_url_403_bodies_are_identical_regardless_of_cause(db_session):
    # Missing token, wrong token, and a legacy NULL-hash row must all produce
    # the exact same 403 body -- no oracle that would let a caller tell them
    # apart.
    create_response = shorten_url("https://example.com", None, db_session)
    code = json.loads(create_response.body)["short_url"]

    legacy = Url(url="https://legacy.example.com", code="legacycode", expiry=None)
    legacy.stats = UrlStats()
    db_session.add(legacy)
    db_session.commit()

    missing = delete_url_function(code, None, db_session)
    wrong = delete_url_function(code, "wrong-token", db_session)
    legacy_response = delete_url_function("legacycode", "any-token", db_session)

    bodies = [json.loads(r.body) for r in (missing, wrong, legacy_response)]
    statuses = [r.status_code for r in (missing, wrong, legacy_response)]

    assert statuses == [status.HTTP_403_FORBIDDEN] * 3
    assert bodies[0] == bodies[1] == bodies[2]
    assert bodies[0] == {"message": "You are not allowed to delete this URL"}


# --- update_url_function -------------------------------------------------


def test_update_url_owner_updates_url_and_revives_expired_link(db_session):
    create_response = shorten_url("https://example.com", None, db_session)
    token = json.loads(create_response.body)["delete_token"]
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code

    # Simulate a link that has since expired.
    url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    new_expiry = datetime.now(timezone.utc) + timedelta(days=1)
    data = UrlUpdate(url="https://updated.example.com", expiry=new_expiry)

    response = update_url_function(code, token, data, db_session)

    assert response.status_code == status.HTTP_200_OK
    payload = json.loads(response.body)
    assert payload["url"] == "https://updated.example.com"
    assert payload["code"] == code
    assert not any("token" in key.lower() or "hash" in key.lower() for key in payload)

    db_session.refresh(url_model)
    assert url_model.url == "https://updated.example.com"
    assert is_expired(url_model.expiry) is False


def test_update_url_expiry_omitted_leaves_unchanged_but_explicit_null_clears_it(
    db_session,
):
    future = datetime.now(timezone.utc) + timedelta(days=1)
    create_response = shorten_url("https://example.com", future, db_session)
    token = json.loads(create_response.body)["delete_token"]
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code

    omitted_response = update_url_function(code, token, UrlUpdate(), db_session)
    assert omitted_response.status_code == status.HTTP_200_OK
    db_session.refresh(url_model)
    assert url_model.expiry is not None

    clearing_response = update_url_function(
        code, token, UrlUpdate(expiry=None), db_session
    )
    assert clearing_response.status_code == status.HTTP_200_OK
    db_session.refresh(url_model)
    assert url_model.expiry is None


def test_update_url_past_expiry_returns_400(db_session):
    create_response = shorten_url("https://example.com", None, db_session)
    token = json.loads(create_response.body)["delete_token"]
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code

    past = datetime.now(timezone.utc) - timedelta(days=1)
    response = update_url_function(code, token, UrlUpdate(expiry=past), db_session)

    assert response.status_code == status.HTTP_400_BAD_REQUEST
    db_session.refresh(url_model)
    assert url_model.expiry is None


@pytest.mark.parametrize(
    "make_token",
    [
        lambda real_token: None,
        lambda real_token: "wrong-token",
    ],
    ids=["missing-token", "wrong-token"],
)
def test_update_url_wrong_or_missing_token_returns_403(db_session, make_token):
    create_response = shorten_url("https://example.com", None, db_session)
    real_token = json.loads(create_response.body)["delete_token"]
    url_model = db_session.execute(select(Url)).scalar_one()
    code = url_model.code

    response = update_url_function(
        code, make_token(real_token), UrlUpdate(url="https://changed.example.com"), db_session
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    payload = json.loads(response.body)
    assert payload == {"message": "You are not allowed to modify this URL"}

    db_session.refresh(url_model)
    assert url_model.url == "https://example.com"


def test_update_url_legacy_row_without_owner_token_hash_returns_403(db_session):
    legacy = Url(url="https://legacy.example.com", code="legacycode", expiry=None)
    legacy.stats = UrlStats()
    db_session.add(legacy)
    db_session.commit()

    response = update_url_function(
        "legacycode", "any-token", UrlUpdate(url="https://changed.example.com"), db_session
    )

    assert response.status_code == status.HTTP_403_FORBIDDEN
    payload = json.loads(response.body)
    assert payload == {"message": "You are not allowed to modify this URL"}

    db_session.refresh(legacy)
    assert legacy.url == "https://legacy.example.com"


def test_update_url_conflict_rolls_back_pending_expiry_change(db_session):
    # Setting a new expiry AND a conflicting (live) url in the same PATCH
    # must not leave the expiry change applied to the session once the url
    # conflict is detected and the request is rejected with 409.
    other_response = shorten_url("https://taken.example.com", None, db_session)
    other_code = json.loads(other_response.body)["short_url"]

    create_response = shorten_url("https://example.com", None, db_session)
    token = json.loads(create_response.body)["delete_token"]
    url_model = db_session.execute(
        select(Url).where(Url.url == "https://example.com")
    ).scalar_one()
    code = url_model.code
    original_expiry = url_model.expiry

    new_expiry = datetime.now(timezone.utc) + timedelta(days=1)
    response = update_url_function(
        code,
        token,
        UrlUpdate(url="https://taken.example.com", expiry=new_expiry),
        db_session,
    )

    assert response.status_code == status.HTTP_409_CONFLICT
    payload = json.loads(response.body)
    assert payload == {"message": "URL already shortened", "code": other_code}

    db_session.expire_all()
    reloaded = db_session.execute(select(Url).where(Url.code == code)).scalar_one()
    assert reloaded.expiry == original_expiry
    assert reloaded.url == "https://example.com"


