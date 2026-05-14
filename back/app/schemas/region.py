from pydantic import BaseModel
from typing import Optional


class Region(BaseModel):
    id: int
    name: str
    imageUrl: str
    summary: str
    summaryShort: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    region: Optional[str] = None
    province: Optional[str] = None
    sourceId: Optional[str] = None
    dataSource: Optional[str] = None
    contentTypeId: Optional[str] = None


class RegionInsight(Region):
    recommendedBusinesses: list[str]
    busyHours: list[str]
    targetCustomers: list[str]


class RegionListResponse(BaseModel):
    regions: list[Region]


class RegionInsightResponse(BaseModel):
    region: RegionInsight


class RegionKtoImagesResponse(BaseModel):
    urls: list[str]
