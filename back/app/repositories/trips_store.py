"""USER_TRIPS / USER_TRIP_PLACES — 로그인 사용자별 여행 일정."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.repositories.db import Base


class UserTrip(Base):
    __tablename__ = "user_trips"

    trip_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    places: Mapped[list["UserTripPlace"]] = relationship(
        "UserTripPlace", back_populates="trip", cascade="all, delete-orphan"
    )


class UserTripPlace(Base):
    __tablename__ = "user_trip_places"
    __table_args__ = (UniqueConstraint("trip_id", "place_id", name="uq_user_trip_places_trip_place"),)

    entry_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("user_trips.trip_id", ondelete="CASCADE"), nullable=False, index=True
    )
    place_id: Mapped[int] = mapped_column(
        BigInteger, ForeignKey("places.place_id", ondelete="CASCADE"), nullable=False, index=True
    )
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    trip: Mapped[UserTrip] = relationship("UserTrip", back_populates="places")


def get_trip_for_user(session, user_id: int, trip_id: int) -> UserTrip | None:
    stmt = select(UserTrip).where(UserTrip.trip_id == trip_id, UserTrip.user_id == user_id)
    return session.execute(stmt).scalar_one_or_none()


def list_trip_place_ids(session, trip_id: int) -> list[int]:
    stmt = (
        select(UserTripPlace.place_id)
        .where(UserTripPlace.trip_id == trip_id)
        .order_by(UserTripPlace.sort_order.asc(), UserTripPlace.entry_id.asc())
    )
    return [int(r) for r in session.execute(stmt).scalars().all()]


def list_trips_for_user(session, user_id: int) -> list[UserTrip]:
    stmt = (
        select(UserTrip)
        .where(UserTrip.user_id == user_id)
        .order_by(UserTrip.created_at.desc(), UserTrip.trip_id.desc())
    )
    return list(session.execute(stmt).scalars().all())


def create_trip(session, user_id: int, name: str) -> UserTrip:
    trip = UserTrip(
        user_id=user_id,
        name=name.strip()[:255],
        created_at=datetime.utcnow(),
    )
    session.add(trip)
    session.flush()
    return trip


def delete_trip(session, user_id: int, trip_id: int) -> bool:
    trip = get_trip_for_user(session, user_id, trip_id)
    if not trip:
        return False
    session.delete(trip)
    session.flush()
    return True


def add_place_to_trip(session, user_id: int, trip_id: int, place_id: int) -> bool:
    trip = get_trip_for_user(session, user_id, trip_id)
    if not trip:
        return False
    existing = list_trip_place_ids(session, trip_id)
    if place_id in existing:
        return False
    sort_order = len(existing)
    try:
        with session.begin_nested():
            session.add(
                UserTripPlace(
                    trip_id=trip_id,
                    place_id=place_id,
                    sort_order=sort_order,
                    added_at=datetime.utcnow(),
                )
            )
            session.flush()
        return True
    except IntegrityError:
        return False


def remove_place_from_trip(session, user_id: int, trip_id: int, place_id: int) -> bool:
    trip = get_trip_for_user(session, user_id, trip_id)
    if not trip:
        return False
    stmt = select(UserTripPlace).where(
        UserTripPlace.trip_id == trip_id,
        UserTripPlace.place_id == place_id,
    )
    row = session.execute(stmt).scalar_one_or_none()
    if not row:
        return False
    session.delete(row)
    session.flush()
    return True


def sync_trips_from_local(session, user_id: int, local_trips: list[dict[str, Any]]) -> int:
    """localStorage 여행 목록을 서버에 병합. 새로 만든 trip 개수."""
    from app.repositories import places_store

    created = 0
    for raw in local_trips:
        if not isinstance(raw, dict):
            continue
        name = str(raw.get("name") or "").strip()
        if not name:
            continue
        trip = create_trip(session, user_id, name)
        created += 1
        places = raw.get("places") if isinstance(raw.get("places"), list) else []
        for place in places:
            if not isinstance(place, dict):
                continue
            try:
                pid = int(place.get("id"))
            except (TypeError, ValueError):
                continue
            if places_store.get_place_by_id(session, pid):
                add_place_to_trip(session, user_id, trip.trip_id, pid)
    return created
