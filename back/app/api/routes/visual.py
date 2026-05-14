from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel

from app.api.routes.place_actions import (
    compare_places,
    show_image_gallery,
)

router = APIRouter(prefix="/api/visual", tags=["visual"])


class VisualRequest(BaseModel):
    message: str
    currentLocationNames: Optional[list[str]] = None


class VisualResponse(BaseModel):
    answer: str
    componentType: Optional[str] = None
    uiData: Optional[dict] = None


def _detect_intent(message: str) -> str:
    text = message.lower()
    if any(k in text for k in ["비교", " vs ", "차이", "대비"]):
        return "comparePlaces"
    if any(k in text for k in ["사진", "이미지", "보고 싶", "보고싶"]):
        return "showImageGallery"
    return "unknown"


def _extract_place_names(message: str) -> list[str]:
    import re

    patterns = [
        r"([가-힣a-zA-Z]+(?:\s[가-힣a-zA-Z]+)?)\s*(?:와|랑|하고|vs|VS)\s*([가-힣a-zA-Z]+(?:\s[가-힣a-zA-Z]+)?)",
        r"([가-힣a-zA-Z]+(?:\s[가-힣a-zA-Z]+)?)\s*비교",
    ]
    for pattern in patterns:
        m = re.search(pattern, message)
        if m:
            return [g for g in m.groups() if g]
    return []


def _extract_theme(message: str) -> str:
    import re

    m = re.search(
        r"([가-힣a-zA-Z]+(?:\s[가-힣a-zA-Z]+)?)\s*(?:사진|이미지|감성)", message
    )
    if m:
        return m.group(1).strip()
    return message.split()[0] if message.split() else "여행"


@router.post("", response_model=VisualResponse)
async def visual_action(payload: VisualRequest):
    intent = _detect_intent(payload.message)
    current_names = payload.currentLocationNames or []

    if intent == "comparePlaces":
        names = _extract_place_names(payload.message)
        if len(names) >= 2:
            data = await compare_places(names[0], names[1])
        elif len(names) == 1 and current_names:
            data = await compare_places(names[0], current_names[0])
        elif len(names) == 1:
            return VisualResponse(
                answer=(
                    "두 곳을 비교하려면 'A vs B'처럼 이름을 둘 다 적어 주시거나, "
                    "로드맵에 장소를 추가한 뒤 다시 시도해 주세요."
                ),
                componentType=None,
                uiData=None,
            )
        else:
            data = {"items": [], "message": "비교할 장소 이름을 찾지 못했어요."}

        items = data.get("items") or []
        if not items:
            msg = data.get("message") or "비교할 장소를 찾지 못했어요."
            return VisualResponse(answer=msg, componentType=None, uiData=None)

        if len(names) >= 2:
            ans = f"{names[0]}와 {names[1]}를 비교해드릴게요."
        elif current_names:
            ans = f"{names[0]}와 {current_names[0]}를 비교해드릴게요."
        else:
            ans = "요청하신 두 장소를 비교해드릴게요."

        return VisualResponse(
            answer=ans,
            componentType="comparePlaces",
            uiData=data,
        )

    if intent == "showImageGallery":
        theme = _extract_theme(payload.message)
        data = await show_image_gallery(theme)
        return VisualResponse(
            answer=f"'{theme}' 관련 장소 이미지를 모아봤어요.",
            componentType="showImageGallery",
            uiData=data,
        )

    return VisualResponse(
        answer="시각화할 내용을 찾지 못했어요.", componentType=None, uiData=None
    )
