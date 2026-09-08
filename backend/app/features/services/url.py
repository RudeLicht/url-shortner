import base62

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from fastapi import status
from fastapi.responses import JSONResponse, Response

from app.features.models.url import Url, UrlStats


def shorten_url(url: str, session: Session):
    try:
        existing_url = session.query(Url).filter(Url.url == url).first()

        if existing_url is not None:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={"message": "URL already shortened"},
            )

        url_model = Url(url=url, code="")

        session.add(url_model)

        session.flush()

        url_model.code = base62.encode(url_model.id)
        url_model.stats = UrlStats()

        session.commit()

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content={
                "url": url_model.url,
                "short_url": url_model.code,
            },
        )

    except IntegrityError as e:
        session.rollback()

        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"message": "URL already shortened"},
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

        url_model.stats.clicks += 1

        session.commit()

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={
                "url": url_model.url,
                "code": url_model.code,
            },
        )
        # return RedirectResponse(
        #     url=url_model.url,
        #     status_code=status.HTTP_307_TEMPORARY_REDIRECT,
        # )

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error fetching URL"},
        )


def delete_url_function(url_code: str, session: Session):
    try:
        url_model = session.execute(
            select(Url).where(Url.code == url_code)
        ).scalar_one_or_none()

        if url_model is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "URL not found"},
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
            },
        )

    except Exception as e:
        session.rollback()
        print(e)

        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error getting URL stats"},
        )
