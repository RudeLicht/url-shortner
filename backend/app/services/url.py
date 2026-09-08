import base62
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fastapi import status
from fastapi.responses import JSONResponse, Response

from app.models.url import Url, UrlStats
from app.schemas.url import (
    ErrorResponse,
    UrlCreateResponse,
    UrlResponse,
    UrlStatsResponse,
    UrlUpdateRequest,
)


def _normalize_expiry(expiry: datetime | None) -> datetime | None:
    if expiry is None:
        return None

    if expiry.tzinfo is None:
        return expiry.replace(tzinfo=timezone.utc)

    return expiry.astimezone(timezone.utc)


def shorten_url(
    url: str,
    expiry: datetime | None,
    session: Session,
) -> UrlCreateResponse | JSONResponse:
    try:
        expiry = _normalize_expiry(expiry)

        existing_url = session.query(Url).filter(Url.url == url).first()

        if existing_url is not None:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content=ErrorResponse(message="URL already shortened").model_dump(),
            )

        if expiry is not None and expiry <= datetime.now(timezone.utc):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=ErrorResponse(
                    message="Expiry must be in the future"
                ).model_dump(),
            )

        url_model = Url(url=url, code="", expiry=expiry)

        session.add(url_model)

        session.flush()

        url_model.code = base62.encode(url_model.id)
        url_model.stats = UrlStats()

        session.commit()

        return UrlCreateResponse(
            url=url_model.url,
            code=url_model.code,
            expiry=url_model.expiry,
        )

    except IntegrityError:
        session.rollback()

        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=ErrorResponse(message="URL already shortened").model_dump(),
        )

    except Exception as error:
        session.rollback()
        print(error)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(message="Error shortening the URL").model_dump(),
        )


def get_url_information(
    url_code: str,
    session: Session,
) -> UrlResponse | JSONResponse:
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL not found").model_dump(),
            )

        if url_model.stats is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL stats not found").model_dump(),
            )

        if url_model.expiry is not None:
            expiry = _normalize_expiry(url_model.expiry)
            if expiry <= datetime.now(timezone.utc):
                return JSONResponse(
                    status_code=status.HTTP_410_GONE,
                    content=ErrorResponse(message="URL has expired").model_dump(),
                )

        url_model.stats.clicks += 1

        session.commit()

        return UrlResponse(
            url=url_model.url,
            code=url_model.code,
            expiry=url_model.expiry,
        )

    except Exception as error:
        session.rollback()
        print(error)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(message="Error fetching URL").model_dump(),
        )


def delete_url_function(url_code: str, session: Session) -> Response | JSONResponse:
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL not found").model_dump(),
            )

        session.delete(url_model)
        session.commit()

        return Response(status_code=status.HTTP_204_NO_CONTENT)

    except Exception as error:
        session.rollback()
        print(error)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(message="Error deleting URL").model_dump(),
        )


def get_url_stats_function(
    url_code: str,
    session: Session,
) -> UrlStatsResponse | JSONResponse:
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL not found").model_dump(),
            )

        if url_model.stats is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL stats not found").model_dump(),
            )

        return UrlStatsResponse(
            url=url_model.url,
            clicks=url_model.stats.clicks,
            expiry=url_model.expiry,
        )

    except Exception as error:
        session.rollback()
        print(error)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(message="Error getting URL stats").model_dump(),
        )


def update_url_expiry(
    url_code: str,
    data: UrlUpdateRequest,
    session: Session,
) -> UrlStatsResponse | JSONResponse:
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL not found").model_dump(),
            )

        expiry = _normalize_expiry(data.expiry)
        if expiry is not None and expiry <= datetime.now(timezone.utc):
            return JSONResponse(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                content=ErrorResponse(
                    message="Expiry must be in the future"
                ).model_dump(),
            )

        url_model.expiry = expiry
        session.commit()

        if url_model.stats is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content=ErrorResponse(message="URL stats not found").model_dump(),
            )

        return UrlStatsResponse(
            url=url_model.url,
            clicks=url_model.stats.clicks,
            expiry=url_model.expiry,
        )

    except Exception as error:
        session.rollback()
        print(error)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content=ErrorResponse(message="Error updating URL expiry").model_dump(),
        )
