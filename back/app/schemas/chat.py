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


class TripChatTurn(BaseModel):
    role: str
    text: str


class TripChatRequest(BaseModel):
    message: str
    tripDuration: Optional[TripDuration] = None
    currentLocationIds: Optional[list[int]] = None
    excludeLocationId: Optional[int] = None
    replan: Optional[bool] = False
    recentMessages: Optional[list[TripChatTurn]] = None


class TripScheduleEntry(BaseModel):
    day: int
    slot: str
    time: str
    placeId: int
    placeName: str = ""
    category: str = ""


class TripChatResponse(BaseModel):
    answer: str
    recommendedRegionIds: list[int]
    schedule: Optional[list[TripScheduleEntry]] = None
    detectedAction: Optional[str] = None
    excludedLocationId: Optional[int] = None
    detectedDuration: Optional[dict] = None
