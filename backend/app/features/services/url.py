import hashlib
import hmac
import secrets
import string
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fastapi import status
from fastapi.responses import JSONResponse, Response

from app.features.models.url import Url, UrlStats
from app.features.schemas.url import UrlUpdate

CODE_LENGTH = 7
CODE_ALPHABET = string.digits + string.ascii_uppercase + string.ascii_lowercase
MAX_CODE_GENERATION_ATTEMPTS = 5


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _is_owner(delete_token: str | None, url_model: Url) -> bool:
    # False whether the token is missing, the row has no owner_token_hash
    # (pre-existing row), or the token doesn't match -- callers must turn
    # each of those into the exact same response, never leaking which case
    # it was.
    return bool(
        delete_token
        and url_model.owner_token_hash is not None
        and hmac.compare_digest(_hash_token(delete_token), url_model.owner_token_hash)
    )


def _generate_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(CODE_LENGTH))


def _code_exists(code: str, session: Session) -> bool:
    # Any row -- live or expired -- counts: the owner of an expired link can
    # still revive it via PATCH, so its code must stay reserved.
    return (
        session.execute(select(Url.id).where(Url.code == code)).scalar_one_or_none()
        is not None
    )


def _generate_unique_code(session: Session) -> str | None:
    for _ in range(MAX_CODE_GENERATION_ATTEMPTS):
        candidate = _generate_code()
        if not _code_exists(candidate, session):
            return candidate
    return None


def is_expired(expiry: datetime | None) -> bool:
    if expiry is None:
        return False
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    return expiry <= datetime.now(timezone.utc)


def _duplicate_url_response(existing_url: Url) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "message": "URL already shortened",
            "code": existing_url.code,
        },
    )


def _alias_taken_response() -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={
            "message": "Alias already taken",
            "error": "alias_taken",
        },
    )


def _find_url_conflict(url: str, session: Session) -> Url | None:
    return session.query(Url).filter(Url.url == url).first()


def _resolve_url_conflict(
    url: str, session: Session
) -> tuple[Url | None, JSONResponse | None]:
    """Look up any existing row for `url`.

    Returns `(expired_row, None)` if the only row found is expired -- callers
    must delete+flush it before reusing `url` -- or `(None, conflict)` if a
    live row already owns it, where `conflict` is the 409 to return
    immediately. `(None, None)` means `url` is free.
    """
    conflict = _find_url_conflict(url, session)

    if conflict is None:
        return None, None

    if not is_expired(conflict.expiry):
        return None, _duplicate_url_response(conflict)

    return conflict, None


def _live_duplicate_response_after_error(url: str, session: Session) -> JSONResponse | None:
    """Re-query for a live conflicting row after a failed flush/commit.

    Returns the 409 response for it, or None if there's no row for `url`, the
    row is expired, or the re-query itself fails -- all of which mean the
    original failure was a genuine error rather than a duplicate.
    """
    try:
        conflict = _find_url_conflict(url, session)
    except Exception as e:
        session.rollback()
        print(e)
        return None

    if conflict is not None and not is_expired(conflict.expiry):
        return _duplicate_url_response(conflict)

    return None


def shorten_url(
    url: str,
    expiry: datetime | None,
    session: Session,
    alias: str | None = None,
):
    try:
        if expiry is not None and is_expired(expiry):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"message": "Expiry must be in the future"},
            )

        existing_url, conflict_response = _resolve_url_conflict(url, session)
        if conflict_response is not None:
            return conflict_response

        # existing_url, if present here, is expired -- resolve the new code
        # (and any alias conflict) before mutating anything, so a 409/500
        # returned below never leaves a pending delete in the session.
        if alias is not None:
            # An alias held by any row -- live or expired -- is always taken.
            # A POST has no way to prove ownership of the row it would
            # replace, so there is no exemption for reclaiming an alias held
            # by an expired row here: the owner revives it via PATCH with
            # their delete token instead.
            if _code_exists(alias, session):
                return _alias_taken_response()
            code = alias
        else:
            code = _generate_unique_code(session)

            if code is None:
                return JSONResponse(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    content={"message": "Error shortening the URL"},
                )

        if existing_url is not None:
            # Existing row is expired: delete it and flush immediately so the
            # DELETE is emitted before the new row's INSERT (SQLAlchemy's unit
            # of work otherwise orders INSERTs before DELETEs within a flush,
            # which would violate the url UNIQUE constraint).
            session.delete(existing_url)
            session.flush()

        token = secrets.token_urlsafe(32)

        url_model = Url(
            url=url,
            code=code,
            expiry=expiry,
            owner_token_hash=_hash_token(token),
        )

        session.add(url_model)

        session.flush()

        url_model.stats = UrlStats()

        session.commit()

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content={
                "url": url_model.url,
                "short_url": url_model.code,
                "expiry": url_model.expiry.isoformat() if url_model.expiry else None,
                "delete_token": token,
            },
        )

    except IntegrityError as e:
        session.rollback()
        print(e)

        # Only a live row means a concurrent request won the race and
        # committed first -> 409 with its code. An expired row (or no row)
        # means our own replacement attempt failed for some other reason,
        # so it's a genuine error rather than a duplicate.
        conflict_response = _live_duplicate_response_after_error(url, session)
        if conflict_response is not None:
            return conflict_response

        if alias is not None:
            try:
                if _code_exists(alias, session):
                    return _alias_taken_response()
            except Exception as e:
                session.rollback()
                print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error shortening the URL"},
        )

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error shortening the URL"},
        )


def get_url_information(url_code: str, session: Session):
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL not found"},
            )

        if url_model.stats is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL stats not found"},
            )

        if is_expired(url_model.expiry):
            return JSONResponse(
                status_code=status.HTTP_410_GONE,
                content={"message": "URL has expired"},
            )

        url_model.stats.clicks += 1

        session.commit()

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "url": url_model.url,
                "code": url_model.code,
                "expiry": url_model.expiry.isoformat() if url_model.expiry else None,
            },
        )

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error fetching URL"},
        )


def delete_url_function(url_code: str, delete_token: str | None, session: Session):
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL not found"},
            )

        if not _is_owner(delete_token, url_model):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"message": "You are not allowed to delete this URL"},
            )

        session.delete(url_model)
        session.commit()

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error deleting URL"},
        )


def get_url_stats_function(url_code: str, session: Session):
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL not found"},
            )

        if url_model.stats is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL stats not found"},
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "url": url_model.url,
                "clicks": url_model.stats.clicks,
                "expiry": url_model.expiry.isoformat() if url_model.expiry else None,
            },
        )

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error getting URL stats"},
        )


def update_url_function(
    url_code: str, delete_token: str | None, data: UrlUpdate, session: Session
):
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL not found"},
            )

        if not _is_owner(delete_token, url_model):
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"message": "You are not allowed to modify this URL"},
            )

        fields_set = data.model_fields_set

        # Validate everything and resolve any conflict *before* mutating
        # url_model, so a non-2xx return below never leaves a pending change
        # (or a pending delete) in the session.
        if "expiry" in fields_set and data.expiry is not None and is_expired(data.expiry):
            return JSONResponse(
                status_code=status.HTTP_400_BAD_REQUEST,
                content={"message": "Expiry must be in the future"},
            )

        conflicting_url = None
        url_changed = "url" in fields_set and data.url != url_model.url

        if url_changed:
            # `url_changed` guarantees `data.url` differs from url_model.url,
            # so any row this finds can never be url_model itself.
            conflicting_url, conflict_response = _resolve_url_conflict(data.url, session)
            if conflict_response is not None:
                return conflict_response

        if "expiry" in fields_set:
            url_model.expiry = data.expiry

        if url_changed:
            if conflicting_url is not None:
                # Same reasoning as shorten_url: the url column is UNIQUE, so
                # the expired row must be deleted and flushed before this
                # row's url is updated to the same value.
                session.delete(conflicting_url)
                session.flush()

            url_model.url = data.url

        session.commit()

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "url": url_model.url,
                "code": url_model.code,
                "expiry": url_model.expiry.isoformat() if url_model.expiry else None,
            },
        )

    except IntegrityError as e:
        session.rollback()
        print(e)

        conflict_response = (
            _live_duplicate_response_after_error(data.url, session)
            if data.url is not None
            else None
        )
        if conflict_response is not None:
            return conflict_response

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error updating URL"},
        )

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error updating URL"},
        )
