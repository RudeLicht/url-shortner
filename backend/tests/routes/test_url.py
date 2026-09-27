import re
from datetime import datetime, timedelta, timezone

import pytest

CODE_PATTERN = re.compile(r"^[0-9A-Za-z]{7}$")


def test_root_health_route(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_url_without_trailing_slash_creates_without_redirect(client):
    response = client.post(
        "/api/v1/url", json={"url": "https://example.com"}, follow_redirects=False
    )

    assert response.status_code == 201
    assert CODE_PATTERN.fullmatch(response.json()["short_url"])


def test_post_url_creates_short_url(client):
    response = client.post("/api/v1/url/", json={"url": "https://example.com"})

    assert response.status_code == 201
    body = response.json()
    assert body["url"] == "https://example.com"
    assert CODE_PATTERN.fullmatch(body["short_url"])
    assert body["expiry"] is None
    assert isinstance(body["delete_token"], str)
    assert body["delete_token"] != ""


def test_post_url_distinct_codes_for_distinct_urls(client):
    r1 = client.post("/api/v1/url/", json={"url": "https://example.com/one"})
    r2 = client.post("/api/v1/url/", json={"url": "https://example.com/two"})

    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["short_url"] != r2.json()["short_url"]
    assert r1.json()["delete_token"] != r2.json()["delete_token"]

    # Link 1's token must not be able to delete link 2.
    cross_delete = client.delete(
        f"/api/v1/url/{r2.json()['short_url']}",
        headers={"X-Delete-Token": r1.json()["delete_token"]},
    )
    assert cross_delete.status_code == 403
    assert client.get(f"/api/v1/url/{r2.json()['short_url']}").status_code == 200


def test_post_url_duplicate_returns_409(client):
    first = client.post("/api/v1/url/", json={"url": "https://example.com"})
    response = client.post("/api/v1/url/", json={"url": "https://example.com"})

    assert response.status_code == 409
    body = response.json()
    assert body["code"] == first.json()["short_url"]
    assert not any("token" in key.lower() or "hash" in key.lower() for key in body)


def test_post_url_duplicate_of_expired_url_returns_201_with_new_code(client, db_session):
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    created = client.post(
        "/api/v1/url/", json={"url": "https://example.com", "expiry": future}
    )
    old_code = created.json()["short_url"]

    # shorten_url rejects an already-past expiry outright (400), so create
    # the row with a future expiry via the API, then advance time by
    # flipping the row directly, same as test_get_url_expired_returns_410.
    from app.features.models.url import Url
    from sqlalchemy import select

    url_model = db_session.execute(select(Url).where(Url.code == old_code)).scalar_one()
    url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = client.post("/api/v1/url/", json={"url": "https://example.com"})

    assert response.status_code == 201
    new_code = response.json()["short_url"]
    assert new_code != old_code

    follow_up_new = client.get(f"/api/v1/url/{new_code}")
    assert follow_up_new.status_code == 200

    follow_up_old = client.get(f"/api/v1/url/{old_code}")
    assert follow_up_old.status_code == 404


def test_post_url_missing_url_field_returns_422(client):
    response = client.post("/api/v1/url/", json={})
    assert response.status_code == 422


def test_post_url_wrong_type_returns_422(client):
    response = client.post("/api/v1/url/", json={"url": 12345})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "url",
    [
        "javascript:alert(1)",
        "not-a-url",
        "https://:443",
        "http://user@",
        "https://exa mple.com",
        "https://example.com/\u0000",
    ],
    ids=[
        "javascript-scheme",
        "no-scheme",
        "empty-host-with-port",
        "empty-host-with-userinfo",
        "whitespace-in-host",
        "control-character",
    ],
)
def test_post_url_invalid_url_returns_422(client, url):
    response = client.post("/api/v1/url/", json={"url": url})
    assert response.status_code == 422


def test_post_url_past_expiry_returns_400(client):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    response = client.post(
        "/api/v1/url/", json={"url": "https://example.com", "expiry": past}
    )
    assert response.status_code == 400


def test_post_url_with_alias_creates_short_url_with_that_alias(client):
    response = client.post(
        "/api/v1/url/", json={"url": "https://example.com", "alias": "my-alias"}
    )

    assert response.status_code == 201
    assert response.json()["short_url"] == "my-alias"

    follow_up = client.get("/api/v1/url/my-alias")
    assert follow_up.status_code == 200


@pytest.mark.parametrize(
    "alias",
    ["!!", "API", "_not-found"],
    ids=["invalid-pattern", "reserved-case-insensitive", "reserved-not-found"],
)
def test_post_url_invalid_alias_returns_422(client, alias):
    response = client.post(
        "/api/v1/url/", json={"url": "https://example.com", "alias": alias}
    )
    assert response.status_code == 422


def test_get_url_returns_json_and_counts_clicks(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]

    response = client.get(f"/api/v1/url/{code}")
    assert response.status_code == 200
    assert response.json()["url"] == "https://example.com"
    assert not any(
        "token" in key.lower() or "hash" in key.lower() for key in response.json()
    )

    stats = client.get(f"/api/v1/url/stats/{code}")
    assert stats.json()["clicks"] == 1
    assert not any(
        "token" in key.lower() or "hash" in key.lower() for key in stats.json()
    )


def test_get_url_unknown_code_returns_404(client):
    response = client.get("/api/v1/url/doesnotexist")
    assert response.status_code == 404


def test_get_url_expired_returns_410(client, db_session):
    future = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    created = client.post(
        "/api/v1/url/", json={"url": "https://example.com", "expiry": future}
    )
    code = created.json()["short_url"]

    # shorten_url rejects an already-past expiry outright (400), so to
    # exercise the "was valid, has since elapsed" path we create it with a
    # future expiry via the API and then advance time by flipping the row
    # directly, the same way the service-level test does.
    from app.features.models.url import Url
    from sqlalchemy import select

    url_model = db_session.execute(select(Url).where(Url.code == code)).scalar_one()
    url_model.expiry = datetime.now(timezone.utc) - timedelta(seconds=1)
    db_session.commit()

    response = client.get(f"/api/v1/url/{code}")
    assert response.status_code == 410


def test_get_url_stats_unknown_code_returns_404(client):
    response = client.get("/api/v1/url/stats/doesnotexist")
    assert response.status_code == 404


def test_delete_url_removes_it(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]
    token = created.json()["delete_token"]

    response = client.delete(
        f"/api/v1/url/{code}", headers={"X-Delete-Token": token}
    )
    assert response.status_code == 204

    follow_up = client.get(f"/api/v1/url/{code}")
    assert follow_up.status_code == 404

    stats_follow_up = client.get(f"/api/v1/url/stats/{code}")
    assert stats_follow_up.status_code == 404


def test_delete_url_unknown_code_returns_404(client):
    response = client.delete(
        "/api/v1/url/doesnotexist", headers={"X-Delete-Token": "whatever"}
    )
    assert response.status_code == 404


def test_delete_url_missing_token_returns_403(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]

    response = client.delete(f"/api/v1/url/{code}")
    assert response.status_code == 403
    assert response.json() == {"message": "You are not allowed to delete this URL"}

    follow_up = client.get(f"/api/v1/url/{code}")
    assert follow_up.status_code == 200


def test_delete_url_empty_token_returns_403(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]

    response = client.delete(f"/api/v1/url/{code}", headers={"X-Delete-Token": ""})
    assert response.status_code == 403
    assert response.json() == {"message": "You are not allowed to delete this URL"}

    follow_up = client.get(f"/api/v1/url/{code}")
    assert follow_up.status_code == 200


def test_delete_url_wrong_token_returns_403(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]

    response = client.delete(
        f"/api/v1/url/{code}", headers={"X-Delete-Token": "wrong-token"}
    )
    assert response.status_code == 403
    assert response.json() == {"message": "You are not allowed to delete this URL"}

    follow_up = client.get(f"/api/v1/url/{code}")
    assert follow_up.status_code == 200


def test_delete_url_legacy_row_without_owner_token_hash_returns_403(client, db_session):
    # Simulate a pre-existing row created before delete tokens existed:
    # owner_token_hash is NULL. No token should ever be able to delete it.
    from app.features.models.url import Url, UrlStats

    legacy = Url(url="https://legacy.example.com", code="legacycode", expiry=None)
    legacy.stats = UrlStats()
    db_session.add(legacy)
    db_session.commit()

    response = client.delete(
        "/api/v1/url/legacycode", headers={"X-Delete-Token": "any-token"}
    )
    assert response.status_code == 403
    assert response.json() == {"message": "You are not allowed to delete this URL"}

    follow_up = client.get("/api/v1/url/legacycode")
    assert follow_up.status_code == 200


def test_patch_url_updates_url_via_delete_token_header(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]
    token = created.json()["delete_token"]

    response = client.patch(
        f"/api/v1/url/{code}",
        json={"url": "https://updated.example.com"},
        headers={"X-Delete-Token": token},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["url"] == "https://updated.example.com"
    assert body["code"] == code
    assert not any("token" in key.lower() or "hash" in key.lower() for key in body)

    follow_up = client.get(f"/api/v1/url/{code}")
    assert follow_up.json()["url"] == "https://updated.example.com"


def test_patch_url_unknown_code_returns_404(client):
    response = client.patch(
        "/api/v1/url/doesnotexist",
        json={"url": "https://example.com"},
        headers={"X-Delete-Token": "whatever"},
    )
    assert response.status_code == 404


def test_patch_url_non_http_url_returns_422(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]
    token = created.json()["delete_token"]

    response = client.patch(
        f"/api/v1/url/{code}",
        json={"url": "not-a-url"},
        headers={"X-Delete-Token": token},
    )
    assert response.status_code == 422


def test_delete_url_403_bodies_are_identical_regardless_of_cause(client, db_session):
    from app.features.models.url import Url, UrlStats

    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]

    legacy = Url(url="https://legacy.example.com", code="legacycode", expiry=None)
    legacy.stats = UrlStats()
    db_session.add(legacy)
    db_session.commit()

    missing = client.delete(f"/api/v1/url/{code}")
    wrong = client.delete(f"/api/v1/url/{code}", headers={"X-Delete-Token": "wrong"})
    legacy_response = client.delete(
        "/api/v1/url/legacycode", headers={"X-Delete-Token": "any-token"}
    )

    assert [missing.status_code, wrong.status_code, legacy_response.status_code] == [
        403,
        403,
        403,
    ]
    assert missing.json() == wrong.json() == legacy_response.json()
