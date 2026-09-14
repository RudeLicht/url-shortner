from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from core.database.db import Base


class Url(Base):
    __tablename__ = "urls"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)

    url: Mapped[str] = mapped_column(
        String(2048),
        unique=True,
        nullable=False,
    )

    code: Mapped[str] = mapped_column(
        String(20),
        unique=True,
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    expiry: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    stats: Mapped["UrlStats"] = relationship(
        back_populates="url",
        uselist=False,
        cascade="all, delete-orphan",
    )


class UrlStats(Base):
    __tablename__ = "urls_stats"

    id: Mapped[int] = mapped_column(
        primary_key=True,
        autoincrement=True,
    )

    url_id: Mapped[int] = mapped_column(
        ForeignKey("urls.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    clicks: Mapped[int] = mapped_column(
        default=0,
        nullable=False,
    )

    url: Mapped["Url"] = relationship(
        back_populates="stats",
    )
