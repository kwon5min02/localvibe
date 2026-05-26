from pydantic import BaseModel, Field

from app.schemas.region import Region


class ScrapSyncRequest(BaseModel):
    place_ids: list[int] = Field(default_factory=list)


class ScrapListResponse(BaseModel):
    place_ids: list[int]
    regions: list[Region]


class ScrapToggleResponse(BaseModel):
    place_id: int
    scrapped: bool
