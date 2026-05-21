from fastapi import APIRouter

from app.schemas import ChatRequest, ChatResponse, TripChatRequest, TripChatResponse
from app.services import get_chat_result, get_trip_chat_result

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest):
    return get_chat_result(
        payload.message,
        relation=payload.relation,
        mood=payload.mood,
        transport=payload.transport,
        duration=payload.duration,
    )


@router.post("/trip", response_model=TripChatResponse)
def trip_chat(payload: TripChatRequest):
    duration = {"nights": payload.tripDuration.nights, "days": payload.tripDuration.days} if payload.tripDuration else {"nights": 0, "days": 1}
    return get_trip_chat_result(
        payload.message,
        duration,
        payload.currentLocationIds or [],
        payload.excludeLocationId,
        replan=bool(payload.replan),
    )
