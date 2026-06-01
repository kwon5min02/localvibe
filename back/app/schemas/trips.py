from pydantic import BaseModel, Field

from app.schemas.region import Region


class TripCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)


class TripResponse(BaseModel):
    id: int
    name: str
    createdAt: str | None = None
    places: list[Region] = Field(default_factory=list)


class TripListResponse(BaseModel):
    trips: list[TripResponse]


class TripSyncPlaceItem(BaseModel):
    id: int


class TripSyncItem(BaseModel):
    name: str
    createdAt: str | None = None
    places: list[TripSyncPlaceItem] = Field(default_factory=list)


class TripSyncRequest(BaseModel):
    trips: list[TripSyncItem] = Field(default_factory=list)


class TripReplacePlacesRequest(BaseModel):
    place_ids: list[int] = Field(default_factory=list)
