"""
스크랩 & 여행 일정 API 라우터
위치: app/api/routes/scraps_trips.py

엔드포인트:
  POST   /api/scraps/{place_id}        스크랩 추가
  DELETE /api/scraps/{place_id}        스크랩 해제
  GET    /api/scraps                   내 스크랩 목록
  POST   /api/trips                    여행 생성
  GET    /api/trips                    내 여행 목록
  DELETE /api/trips/{trip_id}          여행 삭제
  POST   /api/trips/{trip_id}/places   여행에 장소 추가
  DELETE /api/trips/{trip_id}/places/{place_id}  여행에서 장소 제거
  GET    /api/trips/{trip_id}/places   여행 장소 목록
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, UniqueConstraint, select
from sqlalchemy.orm import Mapped, mapped_column

from app.repositories.db import Base, session_scope
from app.services.auth_service import get_current_user_id  # JWT에서 user_id 추출

router = APIRouter(prefix="/api", tags=["scraps", "trips"])


# ── ORM 모델 ──────────────────────────────────────────────────────────────────

class UserScrap(Base):
    __tablename__ = "user_scraps"
    __table_args__ = (UniqueConstraint("user_id", "place_id", name="uq_user_scraps"),)

    scrap_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    place_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("places.place_id", ondelete="CASCADE"), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UserTrip(Base):
    __tablename__ = "user_trips"

    trip_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.user_id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class UserTripPlace(Base):
    __tablename__ = "user_trip_places"

    entry_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    trip_id: Mapped[int] = mapped_column(Integer, ForeignKey("user_trips.trip_id", ondelete="CASCADE"), nullable=False)
    place_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("places.place_id", ondelete="CASCADE"), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    added_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ── Pydantic 스키마 ───────────────────────────────────────────────────────────

class TripCreateRequest(BaseModel):
    name: str


class TripPlaceAddRequest(BaseModel):
    place_id: int
    sort_order: int = 0


class TripSyncRequest(BaseModel):
    """여행플래너 → 마이페이지 일정 동기화용. 전체 place_id 순서 배열."""
    name: str
    place_ids: list[int]


# ── 스크랩 API ────────────────────────────────────────────────────────────────

@router.post("/scraps/{place_id}", status_code=201)
def add_scrap(place_id: int, user_id: int = Depends(get_current_user_id)):
    """장소 스크랩 추가."""
    with session_scope() as session:
        existing = session.execute(
            select(UserScrap).where(UserScrap.user_id == user_id, UserScrap.place_id == place_id)
        ).scalar_one_or_none()
        if existing:
            return {"scrap_id": existing.scrap_id, "place_id": place_id, "status": "already_scrapped"}
        scrap = UserScrap(user_id=user_id, place_id=place_id, created_at=datetime.utcnow())
        session.add(scrap)
        session.flush()
        return {"scrap_id": scrap.scrap_id, "place_id": place_id, "status": "scrapped"}


@router.delete("/scraps/{place_id}", status_code=200)
def remove_scrap(place_id: int, user_id: int = Depends(get_current_user_id)):
    """스크랩 해제."""
    with session_scope() as session:
        existing = session.execute(
            select(UserScrap).where(UserScrap.user_id == user_id, UserScrap.place_id == place_id)
        ).scalar_one_or_none()
        if not existing:
            return {"status": "not_found"}
        session.delete(existing)
        return {"status": "removed", "place_id": place_id}


@router.get("/scraps")
def get_scraps(user_id: int = Depends(get_current_user_id)):
    """내 스크랩 place_id 목록."""
    with session_scope() as session:
        rows = session.execute(
            select(UserScrap.place_id).where(UserScrap.user_id == user_id)
        ).scalars().all()
        return {"place_ids": list(rows)}


# ── 여행 API ──────────────────────────────────────────────────────────────────

@router.post("/trips", status_code=201)
def create_trip(body: TripCreateRequest, user_id: int = Depends(get_current_user_id)):
    """새 여행 생성."""
    with session_scope() as session:
        trip = UserTrip(user_id=user_id, name=body.name.strip(), created_at=datetime.utcnow())
        session.add(trip)
        session.flush()
        return {"trip_id": trip.trip_id, "name": trip.name, "created_at": trip.created_at.isoformat()}


@router.get("/trips")
def get_trips(user_id: int = Depends(get_current_user_id)):
    """내 여행 목록."""
    with session_scope() as session:
        trips = session.execute(
            select(UserTrip).where(UserTrip.user_id == user_id).order_by(UserTrip.created_at.desc())
        ).scalars().all()
        result = []
        for trip in trips:
            places = session.execute(
                select(UserTripPlace.place_id)
                .where(UserTripPlace.trip_id == trip.trip_id)
                .order_by(UserTripPlace.sort_order)
            ).scalars().all()
            result.append({
                "trip_id": trip.trip_id,
                "name": trip.name,
                "created_at": trip.created_at.isoformat() if trip.created_at else None,
                "place_ids": list(places),
            })
        return {"trips": result}


@router.delete("/trips/{trip_id}", status_code=200)
def delete_trip(trip_id: int, user_id: int = Depends(get_current_user_id)):
    """여행 삭제."""
    with session_scope() as session:
        trip = session.execute(
            select(UserTrip).where(UserTrip.trip_id == trip_id, UserTrip.user_id == user_id)
        ).scalar_one_or_none()
        if not trip:
            raise HTTPException(status_code=404, detail="여행을 찾을 수 없습니다.")
        session.delete(trip)
        return {"status": "deleted", "trip_id": trip_id}


@router.post("/trips/{trip_id}/places", status_code=201)
def add_place_to_trip(trip_id: int, body: TripPlaceAddRequest, user_id: int = Depends(get_current_user_id)):
    """여행에 장소 추가."""
    with session_scope() as session:
        trip = session.execute(
            select(UserTrip).where(UserTrip.trip_id == trip_id, UserTrip.user_id == user_id)
        ).scalar_one_or_none()
        if not trip:
            raise HTTPException(status_code=404, detail="여행을 찾을 수 없습니다.")

        existing = session.execute(
            select(UserTripPlace).where(UserTripPlace.trip_id == trip_id, UserTripPlace.place_id == body.place_id)
        ).scalar_one_or_none()
        if existing:
            return {"status": "already_added", "place_id": body.place_id}

        entry = UserTripPlace(
            trip_id=trip_id,
            place_id=body.place_id,
            sort_order=body.sort_order,
            added_at=datetime.utcnow(),
        )
        session.add(entry)
        session.flush()
        return {"status": "added", "entry_id": entry.entry_id, "place_id": body.place_id}


@router.delete("/trips/{trip_id}/places/{place_id}", status_code=200)
def remove_place_from_trip(trip_id: int, place_id: int, user_id: int = Depends(get_current_user_id)):
    """여행에서 장소 제거."""
    with session_scope() as session:
        trip = session.execute(
            select(UserTrip).where(UserTrip.trip_id == trip_id, UserTrip.user_id == user_id)
        ).scalar_one_or_none()
        if not trip:
            raise HTTPException(status_code=404, detail="여행을 찾을 수 없습니다.")

        entry = session.execute(
            select(UserTripPlace).where(UserTripPlace.trip_id == trip_id, UserTripPlace.place_id == place_id)
        ).scalar_one_or_none()
        if not entry:
            return {"status": "not_found"}
        session.delete(entry)
        return {"status": "removed", "place_id": place_id}


@router.post("/trips/sync", status_code=201)
def sync_trip_from_planner(body: TripSyncRequest, user_id: int = Depends(get_current_user_id)):
    """
    여행플래너 → 마이페이지 일정 동기화.
    새 여행을 만들고 place_ids 순서대로 장소를 한 번에 저장.
    """
    with session_scope() as session:
        trip = UserTrip(user_id=user_id, name=body.name.strip(), created_at=datetime.utcnow())
        session.add(trip)
        session.flush()

        for order, place_id in enumerate(body.place_ids):
            entry = UserTripPlace(
                trip_id=trip.trip_id,
                place_id=place_id,
                sort_order=order,
                added_at=datetime.utcnow(),
            )
            session.add(entry)

        session.flush()
        return {
            "trip_id": trip.trip_id,
            "name": trip.name,
            "place_count": len(body.place_ids),
            "status": "synced",
        }
