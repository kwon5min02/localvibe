from fastapi import APIRouter

from app.schemas import ChatRequest, ChatResponse, TripChatRequest, TripChatResponse
from app.services import get_chat_result, get_trip_chat_result

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest):
    return get_chat_result(payload.message)


@router.post("/trip", response_model=TripChatResponse)
def trip_chat(payload: TripChatRequest):
    return get_trip_chat_result(
        payload.message,
        {"nights": payload.tripDuration.nights, "days": payload.tripDuration.days}
    )
