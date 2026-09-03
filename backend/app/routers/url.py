from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.services.url import shorten_url, get_url_information, delete_url_function
from app.db import get_db
from app.schemas.url import UrlRequest

router = APIRouter()


@router.post("/")
async def post_url(data: UrlRequest, session: Session = Depends(get_db)):
    return await shorten_url(data.url, session)


@router.get("/{code}")
async def get_url(code: str, session: Session = Depends(get_db)):
    return await get_url_information(code, session)


@router.get("/stats/{code}")
async def get_url_stats(code: str, session: Session = Depends(get_db)):
    return None


@router.patch("/stats/{code}")
async def patch_url_stats(code: str, session: Session = Depends(get_db)):
    return None


@router.delete("/{code}")
async def delete_url(code: str, session: Session = Depends(get_db)):
    return await delete_url_function(code, session)
