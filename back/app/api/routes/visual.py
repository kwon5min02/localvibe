import json
import logging
import os
import re
from typing import Any, Optional

from fastapi import APIRouter
from openai import OpenAI
from pydantic import BaseModel

from app.api.routes.place_actions import (
    compare_places,
    show_image_gallery,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/visual", tags=["visual"])


class ChatTurn(BaseModel):
    role: str
    text: str = ""


class LocationPin(BaseModel):
    id: Optional[int] = None
    name: str = ""
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    summary: Optional[str] = None


class VisualRequest(BaseModel):
    message: str
    currentLocationNames: Optional[list[str]] = None
    locations: Optional[list[LocationPin]] = None
    recentChat: Optional[list[ChatTurn]] = None


class VisualResponse(BaseModel):
    answer: str
    componentType: Optional[str] = None
    uiData: Optional[dict] = None


def _detect_intent(message: str) -> str:
    text = message.lower()
    if any(k in text for k in ["비교", " vs ", " vs", "차이", "대비"]):
        return "comparePlaces"
    if any(k in message for k in ["사진", "이미지", "보고 싶", "보고싶", "갤러리"]):
        return "showImageGallery"
    if any(k in message for k in ["지도", "마커", "맵"]):
        if any(
            k in message
            for k in [
                "보여",
                "표시",
                "띄워",
                "알려",
                "찍",
                "볼",
                "줄래",
                "까",
                "펼쳐",
            ]
        ):
            return "showMap"
    if "위치" in message and any(k in message for k in ["지도", "맵", "보여", "알려", "찍"]):
        return "showMap"
    return "unknown"


def _extract_place_names(message: str) -> list[str]:
    patterns = [
        r"([가-힣a-zA-Z0-9]+(?:\s[가-힣a-zA-Z0-9]+)?)\s*(?:와|랑|하고|vs|VS)\s*([가-힣a-zA-Z0-9]+(?:\s[가-힣a-zA-Z0-9]+)?)",
        r"([가-힣a-zA-Z0-9]+(?:\s[가-힣a-zA-Z0-9]+)?)\s*비교",
    ]
    for pattern in patterns:
        m = re.search(pattern, message)
        if m:
            return [g.strip() for g in m.groups() if g and str(g).strip()]
    return []


def _extract_theme(message: str) -> str:
    m = re.search(
        r"([가-힣a-zA-Z]+(?:\s[가-힣a-zA-Z]+)?)\s*(?:사진|이미지|감성)",
        message,
    )
    if m:
        return m.group(1).strip()
    return message.split()[0] if message.split() else "여행"


def _numbered_lines_from_text(text: str) -> list[str]:
    if not text:
        return []
    raw = re.findall(r"^\s*\d+\.\s*([^\n]+)", text, re.MULTILINE)
    out: list[str] = []
    for line in raw:
        s = line.strip()
        if " - " in s:
            s = s.split(" - ")[0].strip()
        if "(" in s:
            s = s.split("(")[0].strip()
        if s:
            out.append(s)
    return out


def _last_numbered_places(recent: list[dict[str, Any]]) -> list[str]:
    for turn in reversed(recent):
        if turn.get("role") != "assistant":
            continue
        lines = _numbered_lines_from_text(str(turn.get("text") or ""))
        if lines:
            return lines
    return []


def _collect_allowed_names(pins: list[dict[str, Any]], recent: list[dict[str, Any]]) -> list[str]:
    from_pins = [str(p.get("name") or "").strip() for p in pins if p.get("name")]
    numbered: list[str] = []
    for turn in recent:
        numbered.extend(_numbered_lines_from_text(str(turn.get("text") or "")))
    merged = [x for x in from_pins + numbered if x]
    seen: set[str] = set()
    out: list[str] = []
    for x in merged:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out


def _match_allowed_name(candidate: str, allowed: list[str]) -> Optional[str]:
    c = candidate.strip()
    if not c:
        return None
    if c in allowed:
        return c
    cl = c.lower()
    for a in allowed:
        al = a.lower()
        if cl == al or cl in al or al in cl:
            return a
    return None


def _pins_as_dicts(pins: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in pins:
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        out.append(
            {
                "id": p.get("id"),
                "name": name,
                "latitude": p.get("latitude"),
                "longitude": p.get("longitude"),
                "summary": (p.get("summary") or "")[:180],
            }
        )
    return out


def _openai_resolve_visual(
    message: str,
    pins: list[dict[str, Any]],
    recent: list[dict[str, Any]],
    heuristic_intent: str,
) -> Optional[dict[str, Any]]:
    api_key = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    allowed = _collect_allowed_names(pins, recent)
    if not allowed and heuristic_intent == "unknown":
        return None

    roadmap_compact = _pins_as_dicts(pins)[:30]
    recent_trim = recent[-14:]
    try:
        client = OpenAI(api_key=api_key)
        system = (
            "당신은 여행 플래너 챗봇의 시각화 라우터입니다. "
            "사용자 문장과 최근 대화·로드맵을 보고, 한 가지 요청만 수행합니다.\n"
            "반드시 JSON 한 개만 출력하세요. 키:\n"
            '- intent: "comparePlaces" | "showMap" | "showImageGallery" | "none"\n'
            '- compare_names: 문자열 배열, 비교 시 정확히 2개 (로드맵·최근 번호 목록에 나온 표기를 그대로)\n'
            '- map_names: 지도에 올릴 장소 이름들(로드맵 표기와 동일). 전체 일정이면 빈 배열.\n'
            '- map_all: true면 로드맵 전체를 지도에 표시\n'
            '- gallery_theme: 갤러리일 때 검색어 한 단어 또는 짧은 구\n'
            "- answer_hint: 사용자에게 보여 줄 한 줄 안내(한국어)\n"
            "규칙: compare_names·map_names 값은 아래 allowed_names에 있는 문자열과 맞거나, "
            "최근 대화 번호 목록에 보인 그대로여야 합니다. 추측으로 없는 이름을 만들지 마세요. "
            "'방금 보여준 카페 두 개'처럼 말하면 최근 assistant 번호 목록에서 카페가 들어간 항목만 골라 2개를 고르세요. "
            "'저 공원'은 공원·수목원·숲 등이 들어간 이름을 골라 map_names에 1개 넣고 map_all은 false. "
            f"휴리스틱으로 추정한 의도가 {heuristic_intent}일 때 이와 모순되지 않게 조정하세요."
        )
        user_payload = {
            "user_message": message,
            "allowed_names": allowed[:80],
            "roadmap": roadmap_compact,
            "recent_chat": recent_trim,
            "heuristic_intent": heuristic_intent,
        }
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps(user_payload, ensure_ascii=False)},
            ],
        )
        content = resp.choices[0].message.content or "{}"
        data = json.loads(content)
        if not isinstance(data, dict):
            return None
        return data
    except Exception:
        logger.exception("[visual] OpenAI resolve failed")
        return None


def _heuristic_resolve(
    message: str,
    pins: list[dict[str, Any]],
    recent: list[dict[str, Any]],
    base_intent: str,
) -> dict[str, Any]:
    allowed = _collect_allowed_names(pins, recent)
    numbered = _last_numbered_places(recent)

    def filter_keyword(items: list[str], kw: Optional[str]) -> list[str]:
        if not kw:
            return items
        return [x for x in items if kw in x]

    kw: Optional[str] = None
    for token in ("카페", "맛집", "공원", "카페거리", "숲", "휴양림", "호텔", "박물관"):
        if token in message:
            kw = token
            break

    ranked = filter_keyword(numbered, kw)

    result: dict[str, Any] = {
        "intent": base_intent if base_intent != "unknown" else "none",
        "compare_names": [],
        "map_names": [],
        "map_all": False,
        "gallery_theme": "",
        "answer_hint": "",
    }

    if base_intent == "comparePlaces":
        names = _extract_place_names(message)
        if len(names) >= 2:
            result["compare_names"] = names[:2]
        elif len(names) == 1 and pins:
            # 보조: 로드맵 첫 번째와 조합 (기존 동작)
            result["compare_names"] = [names[0], str(pins[0].get("name") or "")]
        else:
            pool = ranked if ranked else numbered
            if len(pool) >= 2:
                result["compare_names"] = pool[-2:]
            elif len(allowed) >= 2 and not pool:
                result["compare_names"] = allowed[:2]

    if base_intent == "showMap":
        if re.search(r"전체|일정\s*전체|다\s*보여|싹\s*다|로드맵\s*전체", message):
            result["map_all"] = True
        else:
            ref = re.search(
                r"(?:저|그|이|그거|방금|아까)\s*([가-힣a-zA-Z]+(?:\s+[가-힣a-zA-Z]+)?)",
                message,
            )
            if ref:
                hint = ref.group(1).strip()
                for p in pins:
                    pn = str(p.get("name") or "")
                    summ = str(p.get("summary") or "")
                    if hint and (hint in pn or hint in summ or pn in hint):
                        result["map_names"] = [pn]
                        break
            if not result["map_names"] and ranked:
                result["map_names"] = [ranked[-1]]
            if not result["map_names"] and pins:
                result["map_names"] = [str(pins[-1].get("name") or "")]

    if base_intent == "showImageGallery":
        result["gallery_theme"] = _extract_theme(message)

    return result


def _normalize_resolve(
    raw: dict[str, Any],
    allowed: list[str],
) -> dict[str, Any]:
    intent = str(raw.get("intent") or "none")
    out = {
        "intent": intent,
        "compare_names": [],
        "map_names": [],
        "map_all": bool(raw.get("map_all")),
        "gallery_theme": str(raw.get("gallery_theme") or "").strip(),
        "answer_hint": str(raw.get("answer_hint") or "").strip(),
    }
    for key in ("compare_names", "map_names"):
        vals = raw.get(key)
        if not isinstance(vals, list):
            continue
        resolved: list[str] = []
        for v in vals:
            if not isinstance(v, str):
                continue
            m = _match_allowed_name(v, allowed)
            if m:
                resolved.append(m)
        out[key] = resolved
    if raw.get("map_all"):
        out["map_all"] = True
    if len(out["compare_names"]) < 2 and isinstance(raw.get("compare_names"), list):
        # 허용 목록에 없었던 이름은 DB 조회 단계에서 다시 매칭
        cand = [str(x).strip() for x in raw["compare_names"] if str(x).strip()]
        if len(cand) >= 2:
            out["compare_names"] = cand[:2]
    return out


def _row_dict_for_map(p: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": p.get("id"),
        "name": p.get("name"),
        "latitude": p.get("latitude"),
        "longitude": p.get("longitude"),
        "address": p.get("address", ""),
        "summary": p.get("summary", ""),
    }


@router.post("", response_model=VisualResponse)
async def visual_action(payload: VisualRequest):
    message = payload.message.strip()
    pins = [pin.model_dump() for pin in (payload.locations or [])]
    if not pins and payload.currentLocationNames:
        pins = [{"name": n} for n in payload.currentLocationNames if n]
    recent = [turn.model_dump() for turn in (payload.recentChat or [])]

    heuristic_intent = _detect_intent(message)
    raw_llm = _openai_resolve_visual(message, pins, recent, heuristic_intent)
    allowed = _collect_allowed_names(pins, recent)

    if raw_llm:
        resolved = _normalize_resolve(raw_llm, allowed)
    else:
        resolved = _heuristic_resolve(message, pins, recent, heuristic_intent)

    intent = str(resolved.get("intent") or "none")
    if intent == "none" and heuristic_intent != "unknown":
        intent = heuristic_intent
        resolved["intent"] = intent

    # --- compare ---
    if intent == "comparePlaces":
        pair = [str(x).strip() for x in resolved.get("compare_names") or [] if str(x).strip()]
        if len(pair) < 2:
            pair = _extract_place_names(message)
        if len(pair) == 1 and pins:
            pair = [pair[0], str(pins[0].get("name") or "")]
        if len(pair) < 2:
            return VisualResponse(
                answer=(
                    resolved.get("answer_hint")
                    or "어떤 두 곳을 비교할지 문장으로만은 알기 어려워요. "
                    "로드맵에 있는 이름을 짚어 주시거나 「○○ vs △△」처럼 적어 주세요."
                ),
                componentType=None,
                uiData=None,
            )
        data = await compare_places(pair[0], pair[1])
        items = data.get("items") or []
        if not items:
            msg = data.get("message") or "비교할 장소를 찾지 못했어요."
            return VisualResponse(answer=msg, componentType=None, uiData=None)
        ans = resolved.get("answer_hint") or f"{pair[0]}(와)과 {pair[1]}을(를) 비교해드릴게요."
        return VisualResponse(
            answer=ans,
            componentType="comparePlaces",
            uiData=data,
        )

    # --- map ---
    if intent == "showMap":
        if not pins:
            return VisualResponse(
                answer="지도에 표시할 로드맵 장소가 없어요. 먼저 장소를 추가해 주세요.",
                componentType=None,
                uiData=None,
            )
        if resolved.get("map_all"):
            locs = [_row_dict_for_map(p) for p in pins]
            ans = resolved.get("answer_hint") or "일정에 담긴 장소들을 지도에 표시했어요."
            return VisualResponse(
                answer=ans,
                componentType="showMap",
                uiData={"locations": locs},
            )
        names = [str(x).strip() for x in resolved.get("map_names") or [] if str(x).strip()]
        locs: list[dict[str, Any]] = []
        for nm in names:
            hit = next(
                (p for p in pins if str(p.get("name") or "") == nm),
                None,
            )
            if hit:
                locs.append(_row_dict_for_map(hit))
        if not locs and names:
            for p in pins:
                pn = str(p.get("name") or "")
                if any(n in pn or pn in n for n in names):
                    locs.append(_row_dict_for_map(p))
        if not locs:
            locs = [_row_dict_for_map(p) for p in pins]
            ans = resolved.get("answer_hint") or "말씀하신 장소를 특정하기 어려워 일정 전체를 지도에 표시했어요."
        else:
            ans = resolved.get("answer_hint") or "요청하신 장소 위치를 지도에 표시했어요."
        return VisualResponse(
            answer=ans,
            componentType="showMap",
            uiData={"locations": locs},
        )

    # --- gallery ---
    if intent == "showImageGallery":
        theme = resolved.get("gallery_theme") or _extract_theme(message)
        data = await show_image_gallery(theme)
        return VisualResponse(
            answer=resolved.get("answer_hint") or f"'{theme}' 관련 장소 이미지를 모아봤어요.",
            componentType="showImageGallery",
            uiData=data,
        )

    # 폴백: 옛 규칙(이름만 잡히는 경우)
    names = _extract_place_names(message)
    if len(names) >= 2:
        data = await compare_places(names[0], names[1])
        items = data.get("items") or []
        if items:
            return VisualResponse(
                answer=f"{names[0]}와 {names[1]}를 비교해드릴게요.",
                componentType="comparePlaces",
                uiData=data,
            )

    return VisualResponse(
        answer=resolved.get("answer_hint")
        or "시각화할 내용을 찾지 못했어요. 예: 「방금 추천한 카페 둘이 비교해줘」「저 공원 지도로 보여줘」",
        componentType=None,
        uiData=None,
    )
