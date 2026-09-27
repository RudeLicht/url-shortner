from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session
from app.features.services.url import (
    shorten_url,
    get_url_information,
    delete_url_function,
    get_url_stats_function,
    update_url_function,
)
from app.core.database.db import get_db
from app.features.schemas.url import UrlRequest, UrlUpdate

router = APIRouter()


# "" matches /api/v1/url exactly. Without it, that path gets a 307 to the
# trailing-slash form, which the frontend proxy's fetch fails to follow for POSTs.
@router.post("", include_in_schema=False)
@router.post("/")
async def post_url(data: UrlRequest, session: Session = Depends(get_db)):
    return shorten_url(data.url, data.expiry, session, data.alias)


@router.get("/{code}")
async def get_url(code: str, session: Session = Depends(get_db)):
    return get_url_information(code, session)


@router.get("/stats/{code}")
async def get_url_stats(code: str, session: Session = Depends(get_db)):
    return get_url_stats_function(code, session)


@router.delete("/{code}")
async def delete_url(
    code: str,
    delete_token: str | None = Header(None, alias="X-Delete-Token"),
    session: Session = Depends(get_db),
):
    return delete_url_function(code, delete_token, session)


@router.patch("/{code}")
async def patch_url(
    code: str,
    data: UrlUpdate,
    delete_token: str | None = Header(None, alias="X-Delete-Token"),
    session: Session = Depends(get_db),
):
    return update_url_function(code, delete_token, data, session)
