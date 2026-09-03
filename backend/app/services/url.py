import base62
from sqlalchemy.orm import Session
from fastapi.responses import JSONResponse, Response
from fastapi import status
from app.models.url import Url


async def shorten_url(url: str, session: Session):
    try:
        existing_url = session.query(Url).filter(Url.url == url).first()

        if existing_url:
            return JSONResponse(
                status_code=status.HTTP_409_CONFLICT,
                content={"message": "URL already shortened"},
            )

        url_model = Url(url=url)
        session.add(url_model)

        # Get the auto-generated ID without committing yet
        session.flush()

        id_converted = base62.encode(url_model.id)
        url_model.code = id_converted

        session.commit()

        return JSONResponse(
            status_code=status.HTTP_201_CREATED,
            content={
                "url": url,
                "short_url": id_converted,
            },
        )

    except Exception as e:
        session.rollback()
        print(e)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error shortening the URL"},
        )


async def get_url_information(url_code: str, session: Session):
    try:
        url_information = session.query(Url).filter(Url.code == url_code).first()

        if url_information is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "Url not found"},
            )

        return JSONResponse(
            status_code=status.HTTP_200_OK,
            content={"url": url_information.url, "code": url_information.code},
        )
    except Exception as e:
        print(e)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error fetching url"},
        )


async def delete_url_function(url_code: str, session: Session):
    try:
        fetch_url = session.query(Url).filter(Url.code == url_code).first()

        if fetch_url is None:
            return JSONResponse(
                status_code=status.HTTP_404_NOT_FOUND,
                content={"message": "Url not found"},
            )

        session.delete(fetch_url)
        session.commit()
        return Response(status_code=status.HTTP_204_NO_CONTENT)
    except Exception as e:
        print(e)
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"message": "Error deleting url"},
        )
