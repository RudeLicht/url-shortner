from datetime import datetime

from pydantic import BaseModel


class UrlRequest(BaseModel):
    url: str
    expiry: datetime | None = None


class UrlUpdateRequest(BaseModel):
    expiry: datetime | None = None


class UrlCreateResponse(BaseModel):
    url: str
    code: str
    expiry: datetime | None = None

#                                 ^
# temp: same as UrlCreateResponse | for now until we add more features :steamhappy:
class UrlResponse(BaseModel):
    url: str
    code: str
    expiry: datetime | None = None


class UrlStatsResponse(BaseModel):
    url: str
    clicks: int
    expiry: datetime | None = None


class ErrorResponse(BaseModel):
    message: str
