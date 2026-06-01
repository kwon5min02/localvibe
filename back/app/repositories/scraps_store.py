"""USER_SCRAPS — 로그인 사용자별 장소(place) 스크랩."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, UniqueConstraint, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.db import Base


class UserScrap(Base):
    __tablename__ = "user_scraps"
    __table_args__ = (UniqueConstraint("user_id", "place_id", name="uq_user_scraps_user_place"),)

    scrap_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    place_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("places.place_id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


def list_scrap_place_ids(session, user_id: int) -> list[int]:
    stmt = (
        select(UserScrap.place_id)
        .where(UserScrap.user_id == user_id)
        .order_by(UserScrap.created_at.desc(), UserScrap.scrap_id.desc())
    )
    return [int(r) for r in session.execute(stmt).scalars().all()]


def scrap_exists(session, user_id: int, place_id: int) -> bool:
    stmt = select(UserScrap.scrap_id).where(
        UserScrap.user_id == user_id,
        UserScrap.place_id == place_id,
    )
    return session.execute(stmt).scalar_one_or_none() is not None


def add_scrap(session, user_id: int, place_id: int) -> bool:
    """추가됐으면 True, 이미 있으면 False (동시 요청·sync 중복도 안전)."""
    if scrap_exists(session, user_id, place_id):
        return False
    try:
        with session.begin_nested():
            session.add(
                UserScrap(
                    user_id=user_id,
                    place_id=place_id,
                    created_at=datetime.utcnow(),
                )
            )
            session.flush()
        return True
    except IntegrityError:
        return False


def remove_scrap(session, user_id: int, place_id: int) -> bool:
    stmt = select(UserScrap).where(
        UserScrap.user_id == user_id,
        UserScrap.place_id == place_id,
    )
    row = session.execute(stmt).scalar_one_or_none()
    if not row:
        return False
    session.delete(row)
    session.flush()
    return True


def merge_scrap_place_ids(session, user_id: int, place_ids: list[int]) -> int:
    """유효한 place_id만 추가. 새로 추가된 개수 반환."""
    added = 0
    seen: set[int] = set(list_scrap_place_ids(session, user_id))
    for raw in place_ids:
        try:
            pid = int(raw)
        except (TypeError, ValueError):
            continue
        if pid in seen:
            continue
        if add_scrap(session, user_id, pid):
            seen.add(pid)
            added += 1
    return added
