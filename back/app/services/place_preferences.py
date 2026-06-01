"""
사용자 메시지의 제외·선호 조건 파싱 및 장소 행 필터.
여행 테마·필수 방문 키워드는 trip_themes 모듈을 사용합니다.
"""

from __future__ import annotations

import json
import re

from app.services.trip_themes import (
    TripThemeProfile,
    apply_row_theme_score_boost,
    detect_trip_theme_profile,
    dspy_theme_instruction_lines,
    intent_mood_from_profile,
    is_cafe_place,
    is_food_place,
    is_major_sightseeing_place,
    message_requests_cafe_theme,
    message_requests_food_theme,
    place_matches_must_visit,
    place_matches_theme,
    prioritize_ids_for_trip_themes,
    theme_boosted_search_query,
)

# re-export for 기존 import 경로
__all__ = [
    "TripThemeProfile",
    "apply_row_theme_score_boost",
    "detect_exclusion_tags",
    "detect_refine_target_day",
    "message_wants_itinerary_refine",
    "detect_trip_theme_profile",
    "dspy_theme_instruction_lines",
    "exclusion_prompt_lines",
    "filter_ids_by_exclusions",
    "filter_rows_by_exclusions",
    "intent_mood_from_profile",
    "is_cafe_place",
    "is_food_place",
    "is_major_sightseeing_place",
    "is_temple_place",
    "message_requests_cafe_theme",
    "message_requests_food_theme",
    "place_matches_must_visit",
    "place_matches_theme",
    "prioritize_ids_for_trip_themes",
    "row_passes_exclusions",
    "theme_boosted_search_query",
]

_TEMPLE_CONTENT_TYPE_IDS = frozenset({"28"})

_TEMPLE_NAME_RE = re.compile(
    r"(사찰|선원|법당|대웅전|불국사|용화사|석굴|탑사|암\)|암\(|..사\(|..절\(|..절$|..암$)",
)

_EXCLUSION_TRIGGERS: dict[str, list[str]] = {
    "temple": [
        r"절\s*(은|을| )?\s*(안|못|싫|빼|뺴|제외|말고|가지|없)",
        r"절\s*(너무|많)",
        r"(안|못)\s*가.*절",
        r"절\s*빼",
        r"절\s*뺴",
        r"사찰\s*(은|을)?\s*(안|못|싫|빼|뺴|제외|말고)",
        r"사찰\s*말고",
        r"절말고",
    ],
}


def detect_exclusion_tags(user_message: str) -> set[str]:
    text = str(user_message or "")
    if not text.strip():
        return set()
    tags: set[str] = set()
    for tag, patterns in _EXCLUSION_TRIGGERS.items():
        for pat in patterns:
            if re.search(pat, text, re.IGNORECASE):
                tags.add(tag)
                break
    if "절" in text and any(
        w in text
        for w in ("싫", "빼", "뺴", "제외", "안 가", "안갈", "가기 싫", "말고", "너무", "많")
    ):
        tags.add("temple")
    return tags


def detect_refine_target_day(user_message: str) -> int | None:
    """「2일차만 카페 위주」 등 특정 일차만 조정."""
    text = str(user_message or "")
    m = re.search(r"(\d+)\s*일차", text)
    if not m:
        return None
    if re.search(r"만\b|위주|바꿔|조정|넣어|채워|카페|맛집|식당|빼|제외|뺴", text):
        return int(m.group(1))
    return None


def message_wants_itinerary_refine(user_message: str) -> bool:
    """
    특정 장소 이름 없이 '절 빼고 카페 넣어줘'처럼 일정 성격을 바꾸는 요청.
    remove/replace(단일 장소)가 아니라 유지·제외·추가 조합.
    """
    text = str(user_message or "").strip()
    if len(text) < 4:
        return False
    if re.search(r"처음부터|전부\s*다시|코스\s*다시|일정\s*다시\s*짜|새로\s*짜", text):
        return False
    excl = detect_exclusion_tags(text)
    wants_remove = bool(excl) or bool(
        re.search(r"(빼|뺴|제외|말고|없애|빼주|뺴주)", text)
    )
    wants_add = bool(re.search(r"넣어|추가|더\s|채워|넣어줄|충전", text))
    wants_food = message_requests_food_theme(text) or bool(
        re.search(r"카페|식당|맛집|음식|레스토랑|브런치|디저트", text)
    )
    wants_cafe = message_requests_cafe_theme(text)
    wants_theme_shift = bool(
        re.search(
            r"위주|중심|메인|비중|느낌|톤|구성|짜주|바꿔|조정|손봐|맞춰|다시",
            text,
        )
    )
    if detect_refine_target_day(text) and (wants_food or wants_remove or wants_add):
        return True
    if wants_cafe and (wants_remove or wants_add or wants_theme_shift):
        return True
    if wants_food and wants_theme_shift:
        return True
    if wants_add and wants_food:
        return True
    return bool(wants_remove and (wants_add or wants_food))


def _insight_content_type_id(row: dict) -> str:
    try:
        insight = json.loads(row.get("insight_json") or "{}")
    except Exception:
        insight = {}
    return str(insight.get("contentTypeId") or row.get("contentTypeId") or "").strip()


def is_temple_place(row: dict) -> bool:
    name = str(row.get("name") or "").strip()
    if not name:
        return False
    if _TEMPLE_NAME_RE.search(name):
        return True
    if name.endswith(("사", "절", "암")) and len(name) >= 2:
        if any(c in name for c in "사찰불보혜"):
            return True

    summary = str(row.get("summary") or row.get("description") or "")
    category = str(row.get("category") or "")
    blob = f"{name} {summary} {category}"
    if any(k in blob for k in ("사찰", "불교", "법당", "대웅전", "종교시설", "템플스테이")):
        return True

    if _insight_content_type_id(row) in _TEMPLE_CONTENT_TYPE_IDS:
        return True
    return False


def row_passes_exclusions(row: dict, exclusion_tags: set[str]) -> bool:
    if not exclusion_tags:
        return True
    if "temple" in exclusion_tags and is_temple_place(row):
        return False
    return True


def filter_rows_by_exclusions(rows: list[dict], exclusion_tags: set[str]) -> list[dict]:
    if not exclusion_tags:
        return rows
    return [r for r in rows if row_passes_exclusions(r, exclusion_tags)]


def filter_ids_by_exclusions(
    ids: list[int],
    row_by_id: dict[int, dict],
    exclusion_tags: set[str],
) -> list[int]:
    if not exclusion_tags:
        return ids
    return [i for i in ids if i in row_by_id and row_passes_exclusions(row_by_id[i], exclusion_tags)]


def exclusion_prompt_lines(exclusion_tags: set[str]) -> str:
    if not exclusion_tags:
        return ""
    lines: list[str] = []
    if "temple" in exclusion_tags:
        lines.append("- 절대 추천 금지: 사찰·절·암·종교시설 (이름·요약·유형에 절/사찰이 있으면 제외)")
    return "\n".join(lines)
