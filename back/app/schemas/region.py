from pydantic import BaseModel
from typing import Optional


class Region(BaseModel):
    id: int
    name: str
    imageUrl: str
    summary: str
    dataSource: Optional[str] = None


class RegionInsight(Region):
    recommendedBusinesses: list[str]
    busyHours: list[str]
    targetCustomers: list[str]


class RegionListResponse(BaseModel):
    regions: list[Region]


class RegionInsightResponse(BaseModel):
    region: RegionInsight
