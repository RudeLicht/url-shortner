from app.db import Base
from sqlalchemy import Column, Integer, String, text
from sqlalchemy.sql.sqltypes import TIMESTAMP


class Url(Base):
    __tablename__ = "urls"
    id = Column(Integer, primary_key=True, autoincrement=True)
    url = Column(String, unique=True)
    code = Column(String)
    created_at = Column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("now()")
    )


class UrlStats(Base):
    __tablename__ = "urls_stats"

    id = Column(Integer, primary_key=True, autoincrement=True)
    url_id = Column(Integer, )