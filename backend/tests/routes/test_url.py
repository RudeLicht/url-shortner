from datetime import datetime, timedelta, timezone

import base62


def test_root_health_route(client):
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_post_url_creates_short_url(client):
    response = client.post("/api/v1/url/", json={"url": "https://example.com"})

    assert response.status_code == 201
    body = response.json()
    assert body["url"] == "https://example.com"
    assert body["short_url"] == base62.encode(1)
    assert body["expiry"] is None


def test_post_url_distinct_codes_for_distinct_urls(client):
    r1 = client.post("/api/v1/url/", json={"url": "https://example.com/one"})
    r2 = client.post("/api/v1/url/", json={"url": "https://example.com/two"})

    assert r1.status_code == 201
    assert r2.status_code == 201
    assert r1.json()["short_url"] != r2.json()["short_url"]


def test_post_url_duplicate_returns_409(client):
    first = client.post("/api/v1/url/", json={"url": "https://example.com"})
    response = client.post("/api/v1/url/", json={"url": "https://example.com"})

    assert response.status_code == 409
    assert response.json()["code"] == first.json()["short_url"]


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

    # Create an unrelated URL *after* the expired one so it isn't the max id
    # in the table -- SQLite (used in tests) would otherwise reuse that id
    # for the replacement row once the expired one is deleted, masking what
    # would be a genuinely new id/code on Postgres in production.
    client.post("/api/v1/url/", json={"url": "https://unrelated.com"})

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


def test_post_url_past_expiry_returns_400(client):
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    response = client.post(
        "/api/v1/url/", json={"url": "https://example.com", "expiry": past}
    )
    assert response.status_code == 400


def test_get_url_returns_json_and_counts_clicks(client):
    created = client.post("/api/v1/url/", json={"url": "https://example.com"})
    code = created.json()["short_url"]

    response = client.get(f"/api/v1/url/{code}")
    assert response.status_code == 200
    assert response.json()["url"] == "https://example.com"

    stats = client.get(f"/api/v1/url/stats/{code}")
    assert stats.json()["clicks"] == 1


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

    response = client.delete(f"/api/v1/url/{code}")
    assert response.status_code == 204

    follow_up = client.get(f"/api/v1/url/{code}")
    assert follow_up.status_code == 404

    stats_follow_up = client.get(f"/api/v1/url/stats/{code}")
    assert stats_follow_up.status_code == 404


def test_delete_url_unknown_code_returns_404(client):
    response = client.delete("/api/v1/url/doesnotexist")
    assert response.status_code == 404
