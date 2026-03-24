from fastapi import APIRouter

from app.schemas import ChatRequest, ChatResponse
from app.services import get_chat_result

router = APIRouter(prefix="/api/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
def chat(payload: ChatRequest):
    return get_chat_result(payload.message)
