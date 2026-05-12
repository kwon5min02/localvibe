"""TRENDS 테이블 ORM 및 CRUD."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, select
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.db import Base


class Trend(Base):
    __tablename__ = "trends"

    trend_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    place_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("places.place_id", ondelete="CASCADE"), nullable=False, index=True)
    keyword: Mapped[str | None] = mapped_column(String(256), nullable=True)
    scrap_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    crawling_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_updated: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def list_trends_for_place(session, place_id: int) -> list[Trend]:
    stmt = select(Trend).where(Trend.place_id == place_id)
    return list(session.execute(stmt).scalars().all())


def upsert_trend_row(
    session,
    *,
    place_id: int,
    keyword: str,
    scrap_delta: int = 0,
    crawl_delta: int = 0,
) -> Trend:
    stmt = select(Trend).where(Trend.place_id == place_id, Trend.keyword == keyword)
    existing = session.execute(stmt).scalar_one_or_none()
    now = datetime.utcnow()
    if existing:
        existing.scrap_count = int(existing.scrap_count or 0) + scrap_delta
        existing.crawling_count = int(existing.crawling_count or 0) + crawl_delta
        existing.last_updated = now
        session.flush()
        return existing
    t = Trend(
        place_id=place_id,
        keyword=keyword,
        scrap_count=max(0, scrap_delta),
        crawling_count=max(0, crawl_delta),
        last_updated=now,
    )
    session.add(t)
    session.flush()
    return t
