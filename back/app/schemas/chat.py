from typing import Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    relation: Optional[str] = None
    mood: Optional[str] = None
    transport: Optional[str] = None
    duration: Optional[int] = None


class ChatResponse(BaseModel):
    answer: str
    recommendedRegionIds: list[int]


class TripDuration(BaseModel):
    nights: int
    days: int


class TripChatRequest(BaseModel):
    message: str
    tripDuration: Optional[TripDuration] = None
    currentLocationIds: Optional[list[int]] = None
    excludeLocationId: Optional[int] = None
    replan: Optional[bool] = False


class TripChatResponse(BaseModel):
    answer: str
    recommendedRegionIds: list[int]
    detectedAction: Optional[str] = None
    excludedLocationId: Optional[int] = None
    detectedDuration: Optional[dict] = None
