from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str


class ChatResponse(BaseModel):
    answer: str
    recommendedRegionIds: list[int]


class TripDuration(BaseModel):
    nights: int
    days: int


class TripChatRequest(BaseModel):
    message: str
    tripDuration: TripDuration


class TripChatResponse(BaseModel):
    answer: str
    recommendedRegionIds: list[int]
