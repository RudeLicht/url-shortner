from datetime import datetime

from pydantic import BaseModel


class UrlRequest(BaseModel):
    url: str
    expiry: datetime | None = None

