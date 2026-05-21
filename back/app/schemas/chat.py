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
    tripDuration: TripDuration
    currentLocationIds: Optional[list[int]] = None
    excludeLocationId: Optional[int] = None
    # True: 기존 로드맵 무시, 전체 코스 재추천 (백엔드 후보·GPT 전면 교체)
    replan: Optional[bool] = False


class TripChatResponse(BaseModel):
    answer: str
    recommendedRegionIds: list[int]
    detectedAction: Optional[str] = None
    excludedLocationId: Optional[int] = None
