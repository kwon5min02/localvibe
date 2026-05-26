from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import AuthUser, get_current_user
from app.repositories import places_store, scraps_store, trips_store
from app.repositories.db import session_scope
from app.repositories.trips_store import UserTrip
from app.schemas import (
    Region,
    ScrapListResponse,
    ScrapSyncRequest,
    ScrapToggleResponse,
    TripCreateRequest,
    TripListResponse,
    TripResponse,
    TripSyncRequest,
)

router = APIRouter(prefix="/api/me", tags=["me"])


def _trip_response(session, trip: UserTrip) -> TripResponse:
    place_ids = trips_store.list_trip_place_ids(session, trip.trip_id)
    rows = places_store.list_places_by_ids_ordered(session, place_ids) if place_ids else []
    created = trip.created_at.isoformat() if trip.created_at else None
    return TripResponse(
        id=int(trip.trip_id),
        name=str(trip.name),
        createdAt=created,
        places=[Region(**row) for row in rows],
    )


def _list_trip_responses(session, user_id: int) -> list[TripResponse]:
    trips = trips_store.list_trips_for_user(session, user_id)
    return [_trip_response(session, t) for t in trips]


def _regions_for_place_ids(place_ids: list[int]) -> list[Region]:
    if not place_ids:
        return []
    with session_scope() as session:
        rows = places_store.list_places_by_ids_ordered(session, place_ids)
    return [Region(**row) for row in rows]


@router.get("/scraps", response_model=ScrapListResponse)
def list_my_scraps(user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        place_ids = scraps_store.list_scrap_place_ids(session, user.user_id)
    return ScrapListResponse(
        place_ids=place_ids,
        regions=_regions_for_place_ids(place_ids),
    )


@router.post("/scraps/sync", response_model=ScrapListResponse)
def sync_my_scraps(body: ScrapSyncRequest, user: AuthUser = Depends(get_current_user)):
    """로그인 직후 localStorage 스크랩을 서버에 병합."""
    ids: list[int] = []
    for x in body.place_ids:
        try:
            ids.append(int(x))
        except (TypeError, ValueError):
            continue
    with session_scope() as session:
        valid_ids: list[int] = []
        for pid in ids:
            if places_store.get_place_by_id(session, pid):
                valid_ids.append(pid)
        scraps_store.merge_scrap_place_ids(session, user.user_id, valid_ids)
        place_ids = scraps_store.list_scrap_place_ids(session, user.user_id)
    return ScrapListResponse(
        place_ids=place_ids,
        regions=_regions_for_place_ids(place_ids),
    )


@router.post("/scraps/{place_id}", response_model=ScrapToggleResponse)
def add_my_scrap(place_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        if not places_store.get_place_by_id(session, place_id):
            raise HTTPException(status_code=404, detail="장소를 찾을 수 없습니다.")
        scraps_store.add_scrap(session, user.user_id, place_id)
    return ScrapToggleResponse(place_id=place_id, scrapped=True)


@router.delete("/scraps/{place_id}", response_model=ScrapToggleResponse)
def remove_my_scrap(place_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        scraps_store.remove_scrap(session, user.user_id, place_id)
    return ScrapToggleResponse(place_id=place_id, scrapped=False)


@router.get("/trips", response_model=TripListResponse)
def list_my_trips(user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        trips = _list_trip_responses(session, user.user_id)
    return TripListResponse(trips=trips)


@router.post("/trips/sync", response_model=TripListResponse)
def sync_my_trips(body: TripSyncRequest, user: AuthUser = Depends(get_current_user)):
    """로그인 직후 localStorage 여행 일정을 서버에 병합."""
    payload = [t.model_dump() for t in body.trips]
    with session_scope() as session:
        existing = trips_store.list_trips_for_user(session, user.user_id)
        if not existing and payload:
            trips_store.sync_trips_from_local(session, user.user_id, payload)
        trips = _list_trip_responses(session, user.user_id)
    return TripListResponse(trips=trips)


@router.post("/trips", response_model=TripResponse)
def create_my_trip(body: TripCreateRequest, user: AuthUser = Depends(get_current_user)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="여행 이름을 입력해 주세요.")
    with session_scope() as session:
        trip = trips_store.create_trip(session, user.user_id, name)
        return _trip_response(session, trip)


@router.delete("/trips/{trip_id}")
def delete_my_trip(trip_id: int, user: AuthUser = Depends(get_current_user)):
    with session_scope() as session:
        if not trips_store.delete_trip(session, user.user_id, trip_id):
            raise HTTPException(status_code=404, detail="여행을 찾을 수 없습니다.")
    return {"ok": True}


@router.post("/trips/{trip_id}/places/{place_id}", response_model=TripResponse)
def add_place_to_my_trip(
    trip_id: int, place_id: int, user: AuthUser = Depends(get_current_user)
):
    with session_scope() as session:
        if not places_store.get_place_by_id(session, place_id):
            raise HTTPException(status_code=404, detail="장소를 찾을 수 없습니다.")
        trip = trips_store.get_trip_for_user(session, user.user_id, trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="여행을 찾을 수 없습니다.")
        trips_store.add_place_to_trip(session, user.user_id, trip_id, place_id)
        trip = trips_store.get_trip_for_user(session, user.user_id, trip_id)
        return _trip_response(session, trip)


@router.delete("/trips/{trip_id}/places/{place_id}", response_model=TripResponse)
def remove_place_from_my_trip(
    trip_id: int, place_id: int, user: AuthUser = Depends(get_current_user)
):
    with session_scope() as session:
        trip = trips_store.get_trip_for_user(session, user.user_id, trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="여행을 찾을 수 없습니다.")
        trips_store.remove_place_from_trip(session, user.user_id, trip_id, place_id)
        trip = trips_store.get_trip_for_user(session, user.user_id, trip_id)
        return _trip_response(session, trip)
