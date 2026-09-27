import re
import unicodedata
from datetime import datetime
from urllib.parse import urlparse

from pydantic import BaseModel, field_validator

URL_MAX_LENGTH = 2048

# The frontend's `app/` reserves `api/`, `icon.svg`, `[code]`; `public/` serves
# these static asset paths. An alias colliding with any of them would shadow a
# real frontend route. Names containing "." can never pass ALIAS_PATTERN
# anyway; they're kept here as defence in depth.
# This list mirrors the frontend's top-level routes (under `frontend/app/`)
# and static files served from `frontend/public/` -- it must be updated
# whenever those change.
RESERVED_ALIASES = frozenset(
    {
        "api",
        "_next",
        "_not-found",
        "favicon.ico",
        "icon.svg",
        "robots.txt",
        "sitemap.xml",
        "manifest.webmanifest",
        "file.svg",
        "globe.svg",
        "next.svg",
        "vercel.svg",
        "window.svg",
    }
)

ALIAS_PATTERN = re.compile(r"^[A-Za-z0-9_-]{3,20}$")


def _validate_absolute_http_url(value: str) -> str:
    if len(value) > URL_MAX_LENGTH:
        raise ValueError(f"URL must be at most {URL_MAX_LENGTH} characters long")

    if any(char.isspace() for char in value):
        raise ValueError("URL must not contain whitespace")

    if any(unicodedata.category(char) == "Cc" for char in value):
        raise ValueError("URL must not contain control characters")

    # Intentionally not pydantic's HttpUrl: it normalises the string (e.g.
    # adds a trailing slash), which would break exact-match duplicate
    # detection against stored URLs.
    parsed = urlparse(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname:
        raise ValueError("URL must be an absolute http:// or https:// URL")

    return value


class UrlRequest(BaseModel):
    url: str
    expiry: datetime | None = None
    alias: str | None = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str) -> str:
        return _validate_absolute_http_url(value)

    @field_validator("alias")
    @classmethod
    def validate_alias(cls, value: str | None) -> str | None:
        if value is None:
            return value

        if not ALIAS_PATTERN.fullmatch(value):
            raise ValueError(
                "Alias must be 3-20 characters long and contain only letters, "
                "digits, underscores or hyphens"
            )

        # Aliases are case-sensitive for lookup/storage; only this reserved
        # check is case-insensitive.
        if value.lower() in RESERVED_ALIASES:
            raise ValueError("Alias is reserved")

        return value


class UrlUpdate(BaseModel):
    url: str | None = None
    expiry: datetime | None = None

    @field_validator("url")
    @classmethod
    def validate_url(cls, value: str | None) -> str | None:
        # An explicit "url": null is invalid -- unlike expiry, there is no
        # "clear the URL" operation. Only an *omitted* field means "leave it
        # unchanged", and pydantic doesn't run a field validator against a
        # default it filled in itself, so this only fires when null was
        # actually supplied.
        if value is None:
            raise ValueError("url must not be null")

        return _validate_absolute_http_url(value)
