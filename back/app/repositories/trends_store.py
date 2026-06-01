"""TRENDS 테이블 ORM 및 CRUD."""

from __future__ import annotations

import math
from datetime import datetime, timezone

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


def _safe_utc(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _row_weighted_count(row: Trend) -> float:
    scrap = float(max(0, int(row.scrap_count or 0)))
    crawl = float(max(0, int(row.crawling_count or 0)))
    return 1.0 * scrap + 0.6 * crawl


def _row_recency_decay(
    row: Trend,
    *,
    now: datetime,
    half_life_days: float = 7.0,
    min_decay: float = 0.2,
) -> float:
    updated = _safe_utc(row.last_updated)
    if not updated:
        return min_decay
    age_days = max(0.0, (now - updated).total_seconds() / 86400.0)
    if half_life_days <= 0:
        return 1.0
    decay = math.exp(-math.log(2.0) * (age_days / half_life_days))
    return max(min_decay, min(1.0, decay))


def calc_place_trend_score(
    rows: list[Trend],
    *,
    now: datetime | None = None,
    half_life_days: float = 7.0,
    min_decay: float = 0.2,
) -> float:
    """
    장소별 트렌드 점수 (0~1).
    - scrap/crawl 누적치를 가중합
    - 마지막 업데이트 시점에 따른 시간 감쇠 적용
    """
    if not rows:
        return 0.0
    now_utc = _safe_utc(now) or datetime.now(timezone.utc)
    weighted_total = 0.0
    for row in rows:
        weighted_total += _row_weighted_count(row) * _row_recency_decay(
            row, now=now_utc, half_life_days=half_life_days, min_decay=min_decay
        )

    # 0~1 정규화 (완만한 로그 스케일)
    # weighted_total=0 -> 0.0, weighted_total≈50 이상이면 0.9+ 수렴
    normalized = 1.0 - math.exp(-weighted_total / 22.0)
    return max(0.0, min(1.0, normalized))


def get_trend_scores_for_places(
    session,
    place_ids: list[int],
    *,
    half_life_days: float = 7.0,
    min_decay: float = 0.2,
) -> dict[int, float]:
    if not place_ids:
        return {}
    ids = [int(pid) for pid in place_ids]
    stmt = select(Trend).where(Trend.place_id.in_(ids))
    rows = list(session.execute(stmt).scalars().all())
    grouped: dict[int, list[Trend]] = {}
    for row in rows:
        pid = int(row.place_id)
        grouped.setdefault(pid, []).append(row)

    out: dict[int, float] = {}
    for pid in ids:
        out[pid] = calc_place_trend_score(
            grouped.get(pid, []),
            half_life_days=half_life_days,
            min_decay=min_decay,
        )
    return out
