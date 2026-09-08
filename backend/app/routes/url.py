from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.services.url import (
    delete_url_function,
    get_url_information,
    get_url_stats_function,
    shorten_url,
    update_url_expiry,
)
from app.db import get_db
from app.schemas.url import (
    UrlCreateResponse,
    UrlRequest,
    UrlResponse,
    UrlStatsResponse,
    UrlUpdateRequest,
)

router = APIRouter()


@router.post("/", response_model=UrlCreateResponse, status_code=201)
async def post_url(data: UrlRequest, session: Session = Depends(get_db)):
    return shorten_url(data.url, data.expiry, session)


@router.patch("/{code}", response_model=UrlStatsResponse)
async def patch_url_stats(
    code: str,
    data: UrlUpdateRequest,
    session: Session = Depends(get_db),
):
    return update_url_expiry(code, data, session)


@router.get("/{code}", response_model=UrlResponse)
async def get_url(code: str, session: Session = Depends(get_db)):
    return get_url_information(code, session)


@router.get("/stats/{code}", response_model=UrlStatsResponse)
async def get_url_stats(code: str, session: Session = Depends(get_db)):
    return get_url_stats_function(code, session)


@router.delete("/{code}")
async def delete_url(code: str, session: Session = Depends(get_db)):
    return delete_url_function(code, session)
