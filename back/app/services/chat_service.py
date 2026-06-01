import json
import logging
import math
import os
import random
import re
from typing import Optional

from dotenv import load_dotenv
from openai import OpenAI

from app.repositories import load_regions
from app.repositories import trends_store
from app.repositories.db import mysql_url_configured, session_scope
from app.services import embedding_service
from app.services import recommend_core
from app.services.place_preferences import (
    apply_row_theme_score_boost,
    detect_exclusion_tags,
    detect_trip_theme_profile,
    dspy_theme_instruction_lines,
    exclusion_prompt_lines,
    filter_ids_by_exclusions,
    filter_rows_by_exclusions,
    intent_mood_from_profile,
    is_cafe_place,
    is_food_place,
    is_major_sightseeing_place,
    is_temple_place,
    message_requests_cafe_theme,
    message_requests_food_theme,
    detect_refine_target_day,
    message_wants_itinerary_refine,
    row_passes_exclusions,
)
from app.services.trip_themes import TripThemeProfile
from app.services.media_utils import sanitize_display_image_url

load_dotenv()
logger = logging.getLogger(__name__)

FEED_TOP_K = 9
DAY_TRIP_KEYWORDS = {"당일", "당일치기", "원데이", "하루"}
BROAD_REGION_HINTS = {
    "서울",
    "인천",
    "대전",
    "대구",
    "광주",
    "부산",
    "울산",
    "세종",
    "경기",
    "강원",
    "충북",
    "충남",
    "경북",
    "경남",
    "전북",
    "전남",
    "제주",
    "전국",
    "국내",
}
OUT_OF_SCOPE_REGION_KEYWORDS = set()
GENERIC_QUERY_TOKENS = {
    "여행",
    "추천",
    "코스",
    "가고",
    "싶어",
    "싶은데",
    "가볼만한",
    "어디",
    "알려줘",
    "해주세요",
    "해줘",
    "해주세요",
    "맞아",
    "근처",
}
LOCALITY_SUFFIXES = ("동", "읍", "면", "리", "구", "시", "군")
TRIP_ITEMS_PER_DAY = 6

# 자주 쓰는 도 이름 약칭 → DB province 필드 값
_PROVINCE_TOKEN_TO_CANONICAL: dict[str, str] = {
    "전남": "전라남도",
    "전북": "전북특별자치도",
    "경남": "경상남도",
    "경북": "경상북도",
    "충남": "충청남도",
    "충북": "충청북도",
    "강원": "강원특별자치도",
}

# 시·군·익명 지명 → DB `province` 필드 (VisitKorea PLACES에 시군구 대신 도 단위만 있는 행이 많음)
_CITY_TOKEN_TO_PROVINCE: dict[str, str] = {
    "서울": "서울특별시",
    "인천": "인천광역시",
    "부산": "부산광역시",
    "대구": "대구광역시",
    "대전": "대전광역시",
    "광주": "광주광역시",
    "울산": "울산광역시",
    "세종": "세종특별자치시",
    "제주": "제주특별자치도",
    "서귀포": "제주특별자치도",
    "수원": "경기도",
    "성남": "경기도",
    "용인": "경기도",
    "고양": "경기도",
    "고양시": "경기도",
    "파주": "경기도",
    "가평": "경기도",
    "양평": "경기도",
    "경주": "경상북도",
    "포항": "경상북도",
    "안동": "경상북도",
    "구미": "경상북도",
    "경산": "경상북도",
    "문경": "경상북도",
    "상주": "경상북도",
    "울진": "경상북도",
    "영덕": "경상북도",
    "창원": "경상남도",
    "거제": "경상남도",
    "통영": "경상남도",
    "남해": "경상남도",
    "하동": "경상남도",
    "거창": "경상남도",
    "여수": "전라남도",
    "순천": "전라남도",
    "목포": "전라남도",
    "담양": "전라남도",
    "보성": "전라남도",
    "전주": "전북특별자치도",
    "군산": "전북특별자치도",
    "익산": "전북특별자치도",
    "남원": "전북특별자치도",
    "속초": "강원특별자치도",
    "강릉": "강원특별자치도",
    "춘천": "강원특별자치도",
    "평창": "강원특별자치도",
    "양양": "강원특별자치도",
    "동해": "강원특별자치도",
    "태안": "충청남도",
    "보령": "충청남도",
    "공주": "충청남도",
    "청주": "충청북도",
    "충주": "충청북도",
    "단양": "충청북도",
}

# --- 여행 의도 (관계·분위기·이동·기간): GPT + 키워드 폴백 ---

_RELATION_KEYWORDS: dict[str, list[str]] = {
    "couple": ["연인", "커플", "데이트", "여자친구", "남자친구", "애인", "둘이"],
    "family": [
        "가족",
        "부모님",
        "아이",
        "어린이",
        "애기",
        "할머니",
        "할아버지",
        "엄마",
        "아빠",
        "아들",
        "딸",
    ],
    "friends": ["친구", "동창", "동기", "모임", "셋이", "넷이", "무리", "일행"],
    "formal": ["교수", "직장", "회식", "상사", "거래처", "비즈니스", "업무", "출장", "선생님"],
    "solo": ["혼자", "솔로", "1인", "혼행", "나홀로"],
}

_MOOD_KEYWORDS: dict[str, list[str]] = {
    "calm": ["감성", "조용", "힐링", "여유", "한적", "호젓", "잔잔"],
    "trendy": ["핫플", "인스타", "트렌디", "힙한", "유명한", "뜨는", "요즘", "신나", "신난", "재밌", "재미", "들떠"],
    "local": ["로컬", "숨은", "찐맛집", "현지인", "동네", "진짜"],
    "nature": ["자연", "산", "바다", "공원", "숲", "강", "계곡", "해변"],
    "night": ["야경", "밤", "술", "바", "클럽", "야간", "저녁"],
    "food": ["맛집", "음식", "먹거리", "식도락", "카페", "브런치", "디저트", "먹방"],
    "culture": ["문화", "전시", "박물관", "갤러리", "역사", "체험"],
}

_TRANSPORT_KEYWORDS: dict[str, list[str]] = {
    "public": ["대중교통", "버스", "지하철", "기차", "도보", "걸어서"],
    "car": ["자차", "차", "드라이브", "자가용", "렌트"],
}

_RELATION_SYSTEM_PROMPTS: dict[str, str] = {
    "couple": (
        "당신은 커플 여행 전문 큐레이터입니다. "
        "분위기 있는 카페, 야경 명소, 감성적인 골목, 로맨틱한 장소를 우선 추천하세요. "
        "너무 붐비거나 소란스러운 곳은 피하고, "
        "식사→카페→산책 동선이 자연스럽게 이어지도록 구성하세요."
    ),
    "family": (
        "당신은 가족 여행 전문 큐레이터입니다. "
        "아이와 어르신 모두 편안한 곳을 우선하세요. 이동 거리가 짧고 주차가 편한 곳을 선호하며, "
        "자극적이거나 늦은 밤 장소는 제외하세요. 체험형·교육형 관광지와 가족 식당을 포함하세요."
    ),
    "formal": (
        "당신은 비즈니스 모임 전문 큐레이터입니다. "
        "조용하고 격식 있는 식당과 카페를 우선하세요. "
        "연인·데이트 분위기 장소는 절대 추천하지 마세요. "
        "주차가 편리하고 접근성이 좋은 곳을 선호합니다."
    ),
    "friends": (
        "당신은 친구 모임 전문 큐레이터입니다. "
        "활기차고 재미있는 핫플레이스를 우선하세요. "
        "맛집, 카페, 체험을 다양하게 섞고 가격 대비 만족도가 높은 곳을 선호합니다."
    ),
    "solo": (
        "당신은 혼자 여행 전문 큐레이터입니다. "
        "혼자 방문해도 어색하지 않은 카페, 전시, 산책로를 추천하세요. "
        "조용하고 여유로운 곳을 우선하며, "
        "혼밥·혼카페가 편한 분위기를 가진 장소를 선호합니다."
    ),
}

_DEFAULT_SYSTEM_PROMPT = (
    "당신은 LocalVibe 추천 도우미입니다. "
    "질문에 짧게 답하고, 반드시 recommendedRegionIds를 9개 반환하세요. "
    "단순 지명·키워드 일치보다 장소 설명의 분위기·감성·동행 맥락이 사용자 요청과 맞는지 우선 판단하세요."
)

# 최종 큐레이션(갤러리·트립 공통): 발표/데모에서 ‘분위기’가 드러나도록 모델에 명시
_ATMOSPHERE_CURATION_RULES = (
    "데이터 목록의 각 장소 ‘요약’을 반드시 읽고, 이름만 보고 고르지 마세요. "
    "요약·유형에서 느껴지는 분위기(조용함/활기/로맨틱/로컬/야경/문화 등)와 "
    "사용자 조건(누구와 가는지·원하는 무드·이동 수단)이 어울리는 장소의 id를 우선 선택하세요. "
    "조건과 정반대인 분위기(예: formal인데 데이트 감성만 강조된 곳)는 피하세요. "
    "answer에는 한두 문장으로 ‘어떤 분위기에 맞춰 골랐는지’만 짧게 녹여 넣으세요."
)

_MOOD_BOOST_KEYWORDS: dict[str, list[str]] = {
    "calm": ["조용", "한적", "힐링", "감성", "여유", "잔잔", "정서", "산책", "전망"],
    "trendy": ["핫플", "인기", "트렌디", "유명", "힙", "신나", "클럽", "펍", "맛집", "카페", "해변", "광안리", "해운대"],
    "local": ["로컬", "숨은", "현지", "찐", "골목"],
    "nature": ["자연", "산", "바다", "공원", "숲", "강", "해변"],
    "night": ["야경", "야간", "밤", "바", "클럽"],
    "food": ["맛집", "식당", "카페", "브런치", "디저트", "음식"],
    "culture": ["전시", "박물관", "갤러리", "역사", "체험"],
}

_RELATION_TARGET_KEYWORDS: dict[str, list[str]] = {
    "couple": ["커플", "연인", "데이트", "야경"],
    "family": ["가족", "아이", "어린이", "체험", "키즈"],
    "friends": ["모임", "친구", "단체"],
    "formal": ["직장", "비즈니스"],
    "solo": ["혼자", "1인", "혼행"],
}


def _parse_intent_keyword_fallback(
    user_message: str,
    relation: Optional[str] = None,
    mood: Optional[str] = None,
    transport: Optional[str] = None,
    duration: Optional[int] = None,
) -> dict:
    text = user_message.lower()

    parsed_relation = relation
    if not parsed_relation:
        for rel, keywords in _RELATION_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                parsed_relation = rel
                break

    parsed_mood = mood
    theme_profile = detect_trip_theme_profile(user_message)
    if not parsed_mood:
        parsed_mood = intent_mood_from_profile(theme_profile)
    if not parsed_mood and message_requests_food_theme(user_message):
        parsed_mood = "food"
    if not parsed_mood:
        for m_key, keywords in _MOOD_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                parsed_mood = m_key
                break

    parsed_transport = transport
    if not parsed_transport:
        for tr_key, keywords in _TRANSPORT_KEYWORDS.items():
            if any(kw in text for kw in keywords):
                parsed_transport = tr_key
                break

    parsed_duration = duration
    if not parsed_duration:
        if any(kw in text for kw in DAY_TRIP_KEYWORDS):
            parsed_duration = 1
        elif "1박" in text or "2일" in text:
            parsed_duration = 2
        elif "2박" in text or "3일" in text:
            parsed_duration = 3

    exclusions = detect_exclusion_tags(user_message)
    patch = theme_profile.to_intent_patch()
    return {
        "relation": parsed_relation,
        "mood": parsed_mood,
        "transport": parsed_transport,
        "duration": parsed_duration,
        "exclusions": exclusions,
        "themes": patch["themes"],
        "mustVisit": patch["mustVisit"],
        "raw_query": user_message,
    }


def _parse_intent(
    user_message: str,
    relation: Optional[str] = None,
    mood: Optional[str] = None,
    transport: Optional[str] = None,
    duration: Optional[int] = None,
) -> dict:
    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        logger.warning("[CHAT] No API key, fallback to keyword intent parsing")
        return _parse_intent_keyword_fallback(user_message, relation, mood, transport, duration)

    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {
                    "role": "system",
                    "content": (
                        "당신은 한국어 여행 의도 분석 전문가입니다.\n"
                        "사용자의 자연어 문장을 읽고 여행 의도를 파악해서 반드시 JSON 형식으로만 반환하세요.\n"
                        "절대 설명, 주석, 마크다운을 포함하지 마세요.\n\n"
                        "=== 분류 기준 ===\n\n"
                        "[relation] 누구와 함께 가는지\n"
                        "- couple : 연인, 남친, 여친, 남자친구, 여자친구, 커플, 데이트, 소개팅, 둘이\n"
                        "- family  : 가족, 부모님, 엄마, 아빠, 아이, 애기, 어린이, 어르신, 할머니, 할아버지\n"
                        "- friends : 친구, 동기, 동창, MT, 모임, 셋이, 넷이, 일행, 무리\n"
                        "- formal  : 교수님, 상사, 직장, 회식, 거래처, 비즈니스, 선생님, 클라이언트\n"
                        "- solo    : 혼자, 나홀로, 혼행, 1인, 뚜벅이 혼자\n"
                        "- null    : 언급 없음\n\n"
                        "[mood] 어떤 분위기를 원하는지\n"
                        "- calm    : 조용한, 한적한, 감성적인, 힐링, 여유로운, 분좋카(분위기 좋은 카페)\n"
                        "- trendy  : 핫플, 인스타, 유명한, 뜨는, 힙한, 트렌디\n"
                        "- local   : 로컬, 숨은, 현지인, 찐맛집, 동네\n"
                        "- nature  : 자연, 산, 바다, 공원, 숲, 강, 계곡, 해변\n"
                        "- night   : 야경, 밤, 술, 바, 클럽, 야간\n"
                        "- food    : 맛집, 카페, 브런치, 디저트, 식도락, 먹방\n"
                        "- culture : 전시, 박물관, 갤러리, 역사, 체험\n"
                        "- null    : 언급 없음\n\n"
                        "[transport] 이동 수단\n"
                        "- public : 대중교통, 버스, 지하철, 기차, 도보, 걸어서, 뚜벅이\n"
                        "- car    : 자차, 차, 드라이브, 자가용, 렌트\n"
                        "- null   : 언급 없음 또는 혼용(버스도 타고 걷기도 한다 → public)\n\n"
                        "[duration] 여행 기간 (숫자)\n"
                        "- 1 : 당일, 당일치기, 하루, 원데이\n"
                        "- 2 : 1박2일\n"
                        "- 3 : 2박3일\n"
                        "- null : 언급 없음\n\n"
                        "=== 주의사항 ===\n"
                        "- '분좋카'는 mood=calm으로 분류하세요.\n"
                        "- '뚜벅이'는 단독이면 transport=public, '뚜벅이 혼자'면 relation=solo도 추가하세요.\n"
                        "- 버스도 타고 걷기도 한다는 표현은 transport=public으로 분류하세요.\n"
                        "- 확실하지 않으면 null로 반환하세요. 억지로 분류하지 마세요.\n"
                        "- 반드시 JSON 한 개만 반환하세요."
                    ),
                },
                {
                    "role": "user",
                    "content": (
                        f'문장: "{user_message}"\n\n'
                        "반환 형식:\n"
                        '{"relation": "couple|family|friends|formal|solo|null", '
                        '"mood": "calm|trendy|local|nature|night|food|culture|null", '
                        '"transport": "public|car|null", '
                        '"duration": 1|2|3|null}'
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or "{}"
        gpt_result = json.loads(content)

        def _null_str(v: object) -> Optional[str]:
            return None if v in (None, "null", "") else str(v)

        gpt_relation = _null_str(gpt_result.get("relation"))
        gpt_mood = _null_str(gpt_result.get("mood"))
        gpt_transport = _null_str(gpt_result.get("transport"))
        raw_dur = gpt_result.get("duration")
        gpt_duration: Optional[int] = None
        if raw_dur not in (None, "", "null"):
            try:
                gpt_duration = int(float(raw_dur))
            except (TypeError, ValueError):
                gpt_duration = None

        exclusions = detect_exclusion_tags(user_message)
        theme_profile = detect_trip_theme_profile(user_message)
        theme_patch = theme_profile.to_intent_patch()
        final = {
            "relation": relation or gpt_relation,
            "mood": mood or gpt_mood,
            "transport": transport or gpt_transport,
            "duration": duration if duration is not None else gpt_duration,
            "exclusions": exclusions,
            "themes": theme_patch["themes"],
            "mustVisit": theme_patch["mustVisit"],
            "raw_query": user_message,
        }
        if not final.get("mood"):
            inferred = intent_mood_from_profile(theme_profile)
            if inferred:
                final["mood"] = inferred
        logger.info(
            "[CHAT] intent parsed relation=%s mood=%s themes=%s mustVisit=%s",
            final["relation"],
            final["mood"],
            final["themes"],
            final["mustVisit"],
        )
        return final
    except Exception:
        logger.warning("[CHAT] GPT intent parsing failed, fallback to keyword")
        return _parse_intent_keyword_fallback(user_message, relation, mood, transport, duration)


def _build_system_prompt(intent: dict) -> str:
    relation = intent.get("relation")
    mood = intent.get("mood")
    transport = intent.get("transport")
    duration = intent.get("duration")

    base = _RELATION_SYSTEM_PROMPTS.get(relation, _DEFAULT_SYSTEM_PROMPT)
    extras: list[str] = []

    if mood == "calm":
        extras.append(
            "잔잔하고 정서적인 톤, 소음이 적고 머무름이 편한 곳을 우선하세요. "
            "붐비는 유원지·클럽형 소음보다 산책·카페·전망 등 여유 있는 장소를 택하세요."
        )
    elif mood == "trendy":
        extras.append(
            "SNS·입소문 상 화제가 되었거나 젊은 층에게 인기 있는 핫플을 우선하세요. "
            "‘사진·공유’ 욕구를 자극하는 비주얼·간판 이미지가 떠오르는 요약을 선호하세요."
        )
    elif mood == "local":
        extras.append(
            "관광 상품화보다 동네 골목·찐 로컬 감성이 느껴지는 장소를 우선하세요. "
            "현지인 동선·숨은 맛집 톤의 요약을 높게 평가하세요."
        )
    elif mood == "nature":
        extras.append(
            "끝없이 펼쳐진 듯한 자연(산·바다·강·숲·공원)에서 몸과 마음이 트이는 장소를 우선하세요."
        )
    elif mood == "night":
        extras.append(
            "야경·야간 조명·저녁 산책·야시장·바(분위기) 등 ‘밤’의 매력이 요약에 드러나는 곳을 우선하세요."
        )
    elif mood == "food":
        extras.append(
            "식도락·카페·맛집·디저트 중심으로 입맛과 기분이 살아나는 장소를 우선하세요. "
            "한옥마을·사찰·서원·박물관만 나열하지 말고 식사·카페가 가능한 곳을 먼저 담으세요. "
            "관광지는 동선 보조로 1~2곳만 포함해도 됩니다."
        )
    elif mood == "culture":
        extras.append(
            "전시·박물관·역사·예술·체험 등 머리와 감각을 채우는 장소를 우선하세요. "
            "교육적·서사적 분위기가 요약에서 읽히는 곳을 고르세요."
        )

    theme_lines = dspy_theme_instruction_lines(
        TripThemeProfile(
            themes=list(intent.get("themes") or []),
            must_visit=list(intent.get("mustVisit") or []),
        )
    )
    if theme_lines:
        extras.append(theme_lines)

    if transport == "public":
        extras.append("대중교통 접근이 편리한 장소를 우선하세요.")
    elif transport == "car":
        extras.append("주차가 편리하거나 드라이브 코스로 좋은 장소를 우선하세요.")

    if duration == 1:
        extras.append("당일치기로 다녀올 수 있는 장소 위주로 추천하세요.")
    elif duration is not None and duration >= 2:
        extras.append(f"{duration}일 일정에 맞게 다양한 유형의 장소를 고루 추천하세요.")

    if extras:
        base = base + " " + " ".join(extras)
    return f"{base} {_ATMOSPHERE_CURATION_RULES}"


def _apply_intent_score_boost(row: dict, intent: dict, base_score: float) -> float:
    boost = 0.0
    mood = intent.get("mood")
    relation = intent.get("relation")

    exclusion_tags = intent.get("exclusions") or set()
    if exclusion_tags and "temple" in exclusion_tags and is_temple_place(row):
        return base_score - 80.0

    themes = intent.get("themes") or []
    must_visit = intent.get("mustVisit") or []
    if themes or must_visit:
        from app.services.trip_themes import TripThemeProfile

        profile = TripThemeProfile(themes=list(themes), must_visit=list(must_visit))
        return apply_row_theme_score_boost(row, profile, base_score + boost)

    if mood == "food":
        if is_food_place(row):
            boost += 42.0
        elif is_major_sightseeing_place(row):
            boost -= 28.0
        elif is_temple_place(row):
            boost -= 35.0

    if mood and mood in _MOOD_BOOST_KEYWORDS:
        doc_text = " ".join(
            [
                str(row.get("name", "")),
                str(row.get("summary", "")),
                " ".join(row.get("recommendedBusinesses", []) if isinstance(row.get("recommendedBusinesses"), list) else []),
                " ".join(row.get("targetCustomers", []) if isinstance(row.get("targetCustomers"), list) else []),
            ]
        ).lower()
        hit_count = sum(1 for kw in _MOOD_BOOST_KEYWORDS[mood] if kw in doc_text)
        boost += hit_count * 5.0
        if mood == "trendy" and is_temple_place(row):
            boost -= 25.0

    if relation and relation in _RELATION_TARGET_KEYWORDS:
        target_text = " ".join(
            row.get("targetCustomers", []) if isinstance(row.get("targetCustomers"), list) else []
        ).lower()
        hit_count = sum(1 for kw in _RELATION_TARGET_KEYWORDS[relation] if kw in target_text)
        boost += hit_count * 4.0

    transport = intent.get("transport")
    address = str(row.get("address", "")).lower()
    summary = str(row.get("summary", "")).lower()
    blob = address + summary
    if transport == "public":
        if any(kw in blob for kw in ["역", "터미널", "버스", "중심"]):
            boost += 3.0
    elif transport == "car":
        if any(kw in blob for kw in ["주차", "드라이브", "교외", "외곽"]):
            boost += 3.0

    return base_score + boost


def _build_intent_context_lines(intent: dict) -> str:
    lines: list[str] = []
    if intent.get("relation"):
        relation_labels = {
            "couple": "커플/연인",
            "family": "가족",
            "friends": "친구 모임",
            "formal": "비즈니스/격식",
            "solo": "혼자 여행",
        }
        lines.append(f"- 여행 인원 관계: {relation_labels.get(intent['relation'], intent['relation'])}")
    if intent.get("mood"):
        mood_labels = {
            "calm": "조용/감성",
            "trendy": "트렌디/핫플",
            "local": "로컬/숨은 명소",
            "nature": "자연/야외",
            "night": "야경/밤",
            "food": "맛집/카페",
            "culture": "문화/체험",
        }
        lines.append(f"- 원하는 분위기: {mood_labels.get(intent['mood'], intent['mood'])}")
    if intent.get("transport"):
        lines.append(
            f"- 이동 수단: {'대중교통' if intent['transport'] == 'public' else '자차/드라이브'}"
        )
    if intent.get("duration") is not None:
        lines.append(f"- 여행 기간: {intent['duration']}일")
    themes = intent.get("themes") or []
    if themes:
        theme_labels = {
            "food": "맛집·음식",
            "cafe": "카페",
            "bakery": "빵·베이커리",
            "beach": "바다·해변",
            "baseball": "야구",
            "soccer": "축구·경기장",
            "culture": "문화",
            "nature": "자연",
            "shopping": "쇼핑",
            "night": "야경",
        }
        labels = [theme_labels.get(t, t) for t in themes]
        lines.append(f"- 여행 테마(우선): {', '.join(labels)}")
    must = intent.get("mustVisit") or []
    if must:
        lines.append(f"- 꼭 포함 희망: {', '.join(must)}")
    excl = intent.get("exclusions") or set()
    excl_text = exclusion_prompt_lines(excl if isinstance(excl, set) else set(excl))
    if excl_text:
        lines.append(f"- 제외 조건:\n{excl_text}")
    return "\n".join(lines)


CHAT_PINECONE_TOP_K = int(os.getenv("CHAT_PINECONE_TOP_K", "30"))
CHAT_PINECONE_MIN_RESULTS = int(os.getenv("CHAT_PINECONE_MIN_RESULTS", "5"))


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[가-힣A-Za-z0-9]+", text.lower())
    return {token for token in tokens if len(token) >= 2}


def _normalize_name_key(text: str) -> str:
    return re.sub(r"\s+", "", str(text or "").lower())


def _build_region_context() -> str:
    rows = load_regions()
    lines = []
    for row in rows:
        lines.append(
            f"- id={row['id']} / 이름={row['name']} / 요약={row.get('summary', '')} / 출처={row.get('dataSource', '')}"
        )
    return "\n".join(lines)


def _fallback_answer(user_message: str) -> str:
    ranked_ids = _score_regions(user_message)
    rows = load_regions()
    row_map = {int(row["id"]): row for row in rows}
    picked = [
        row_map[region_id]["name"]
        for region_id in ranked_ids[:FEED_TOP_K]
        if region_id in row_map
    ]
    if not picked:
        return "요청하신 조건과 유사한 정보를 찾지 못했습니다."
    return (
        f"요청하신 내용과 관련해 총 {len(picked)}곳을 추천합니다: {', '.join(picked)}"
    )


def _standard_answer_from_ids(region_ids: list[int], rows: list[dict]) -> str:
    row_map = {int(row["id"]): row for row in rows}
    picked = [
        str(row_map[region_id]["name"])
        for region_id in region_ids[:FEED_TOP_K]
        if region_id in row_map
    ]
    if not picked:
        return "요청하신 조건과 유사한 정보를 찾지 못했습니다."
    return f"요청 반영 완료! 3x3 피드를 {len(picked)}곳으로 업데이트했어요: {', '.join(picked)}"


def _trip_answer_from_ids(region_ids: list[int], rows: list[dict]) -> str:
    row_map = {int(row["id"]): row for row in rows}
    picked = [
        str(row_map[region_id]["name"])
        for region_id in region_ids
        if region_id in row_map
    ]
    if not picked:
        return "요청하신 조건과 유사한 정보를 찾지 못했습니다."
    preview = ", ".join(picked[:6])
    suffix = " ..." if len(picked) > 6 else ""
    return f"요청 반영 완료! 총 {len(picked)}개 장소를 추천했어요: {preview}{suffix}"


def _row_region_aliases(row: dict) -> set[str]:
    aliases: set[str] = set()
    for field in ("region", "province"):
        value = str(row.get(field, "")).strip().lower()
        if value:
            aliases.add(value)
            aliases.update(_tokenize(value))

    address = str(row.get("address", "")).strip().lower()
    if address:
        address_tokens = _tokenize(address)
        aliases.update(address_tokens)
        first = address.split(" ")[0].strip()
        if first:
            aliases.add(first)
        for token in address_tokens:
            if token.endswith(LOCALITY_SUFFIXES):
                aliases.add(token)
    return aliases


def _detect_query_regions(
    query_text: str, query_tokens: set[str], rows: list[dict]
) -> set[str]:
    alias_universe: set[str] = set()
    for row in rows:
        alias_universe.update(_row_region_aliases(row))

    matched_regions: set[str] = set()
    for token in query_tokens:
        if token in alias_universe:
            matched_regions.add(token)
    for alias in alias_universe:
        if alias and alias in query_text:
            matched_regions.add(alias)
    # "여수" ↔ "여수시" 같이 짧은 지명: 접두어로 연결
    for token in query_tokens:
        if len(token) < 2 or token in GENERIC_QUERY_TOKENS:
            continue
        for alias in alias_universe:
            if len(alias) < 2:
                continue
            if alias.startswith(token):
                matched_regions.add(token)
                break
    return matched_regions


def _char_ngrams(text: str, n: int = 3) -> set[str]:
    compact = re.sub(r"\s+", "", str(text or "").lower())
    if len(compact) < n:
        return {compact} if compact else set()
    return {compact[i : i + n] for i in range(len(compact) - n + 1)}


def _jaccard_similarity(left: str, right: str) -> float:
    left_set = _char_ngrams(left)
    right_set = _char_ngrams(right)
    if not left_set or not right_set:
        return 0.0
    intersection = len(left_set.intersection(right_set))
    union = len(left_set.union(right_set))
    return intersection / union if union else 0.0


def _build_token_stats(rows: list[dict]) -> dict:
    document_frequency: dict[str, int] = {}
    for row in rows:
        blob = " ".join(
            [
                str(row.get("name", "")),
                str(row.get("summary", "")),
                str(row.get("address", "")),
                str(row.get("region", "")),
                str(row.get("province", "")),
                " ".join(row.get("recommendedBusinesses", []) if isinstance(row.get("recommendedBusinesses"), list) else []),
                " ".join(row.get("targetCustomers", []) if isinstance(row.get("targetCustomers"), list) else []),
                str(row.get("dataSource", "")),
            ]
        ).lower()
        for token in set(_tokenize(blob)):
            document_frequency[token] = document_frequency.get(token, 0) + 1
    return {"n_docs": max(1, len(rows)), "df": document_frequency}


def _idf(token: str, token_stats: dict) -> float:
    n_docs = int(token_stats.get("n_docs", 1))
    df_map = token_stats.get("df", {})
    df = int(df_map.get(token, 0)) if isinstance(df_map, dict) else 0
    return math.log((n_docs + 1) / (df + 1)) + 1.0


def _extract_focus_tokens(query_tokens: set[str], query_regions: set[str]) -> set[str]:
    return {
        token
        for token in query_tokens
        if token not in GENERIC_QUERY_TOKENS
        and token not in query_regions
        and len(token) >= 2
    }


def _build_scoring_tokens(query_tokens: set[str]) -> set[str]:
    filtered = {token for token in query_tokens if token not in GENERIC_QUERY_TOKENS}
    return filtered or query_tokens


def _extract_locality_tokens(query_tokens: set[str]) -> set[str]:
    return {
        token
        for token in query_tokens
        if len(token) >= 2
        and token.endswith(LOCALITY_SUFFIXES)
        and token not in GENERIC_QUERY_TOKENS
    }


def _out_of_scope_notice(user_message: str) -> str:
    lowered = user_message.lower()
    matched = [token for token in OUT_OF_SCOPE_REGION_KEYWORDS if token in lowered]
    if not matched:
        return ""
    unique = ", ".join(sorted(set(matched)))
    return f"현재 서비스는 광주/전남 중심 데이터만 제공합니다. ({unique}은/는 범위 밖)"


def _region_match(row: dict, regions: set[str]) -> bool:
    if not regions:
        return False
    aliases = _row_region_aliases(row)
    str_aliases = {a for a in aliases if isinstance(a, str) and len(a) >= 2}
    for region in regions:
        if region in aliases:
            return True
        if len(region) < 2:
            continue
        for a in str_aliases:
            if a.startswith(region):
                return True
            if len(region) >= 3 and region in a:
                return True
    return False


def _locality_match(row: dict, locality_tokens: set[str]) -> bool:
    if not locality_tokens:
        return False
    blob = " ".join(
        [
            str(row.get("address", "")),
            str(row.get("name", "")),
            str(row.get("summary", "")),
        ]
    ).lower()
    return any(token in blob for token in locality_tokens)


def _reorder_trip_ids_meal_alternating(
    region_ids: list[int], rows: list[dict], items_per_day: int = TRIP_ITEMS_PER_DAY
) -> list[int]:
    # 카테고리 하드코딩 없이 점수순 추천을 유지합니다.
    deduped: list[int] = []
    seen: set[int] = set()
    for region_id in region_ids:
        if region_id in seen:
            continue
        seen.add(region_id)
        deduped.append(region_id)
    return deduped


def _score_row(
    row: dict,
    query_text: str,
    scoring_tokens: set[str],
    query_regions: set[str],
    specific_regions: set[str],
    focus_tokens: set[str],
    locality_tokens: set[str],
    day_trip: bool,
    token_stats: dict,
) -> tuple[int, float, str]:
    name = str(row.get("name", ""))
    summary = str(row.get("summary", ""))
    source = str(row.get("dataSource", ""))
    rec = " ".join(row.get("recommendedBusinesses", []))
    target = " ".join(row.get("targetCustomers", []))
    busy = " ".join(row.get("busyHours", []))
    region = str(row.get("region", ""))
    province = str(row.get("province", ""))
    address = str(row.get("address", ""))
    image_url = str(row.get("imageUrl", ""))
    doc_text = " ".join([name, summary, source, rec, target, busy]).lower()
    doc_tokens = _tokenize(doc_text)
    name_tokens = _tokenize(name)
    source_tokens = _tokenize(source)
    summary_tokens = _tokenize(summary)
    rec_tokens = _tokenize(rec)
    target_tokens = _tokenize(target)

    score = 0.0
    matched_tokens: set[str] = set()
    for token in scoring_tokens:
        token_idf = _idf(token, token_stats)
        if token in name_tokens:
            score += 6.0 * token_idf
            matched_tokens.add(token)
        if token in summary_tokens:
            score += 4.0 * token_idf
            matched_tokens.add(token)
        if token in rec_tokens:
            score += 3.0 * token_idf
            matched_tokens.add(token)
        if token in target_tokens:
            score += 2.0 * token_idf
            matched_tokens.add(token)
        if token in source_tokens:
            score += 1.0 * token_idf
            matched_tokens.add(token)

    coverage = len(matched_tokens) / max(1, len(scoring_tokens))
    score += coverage * 22.0

    semantic_sim = _jaccard_similarity(
        query_text,
        " ".join([name, summary, address, rec, target, source]),
    )
    score += semantic_sim * 18.0
    if sanitize_display_image_url(image_url):
        score += 2

    region_blob = " ".join([region, province, address, name, summary]).lower()
    if specific_regions:
        if _region_match(row, specific_regions):
            score += 12.0
        else:
            score -= 14.0 if day_trip else 10.0
    elif query_regions:
        if _region_match(row, query_regions):
            score += 6.0
        elif day_trip:
            score -= 4.0
        else:
            score -= 2.0

    for token in focus_tokens:
        if token in name.lower():
            score += 9.0
        elif token in address.lower():
            score += 6.0
        elif token in summary.lower():
            score += 5.0
        elif token in region_blob:
            score += 3.0

    if locality_tokens:
        if _locality_match(row, locality_tokens):
            score += 14.0
        else:
            score -= 4.0

    return int(row["id"]), score, name


def _score_regions(user_message: str) -> list[int]:
    rows = load_regions()
    if not rows:
        return []

    query_tokens = _tokenize(user_message)
    if not query_tokens:
        all_ids = [int(row["id"]) for row in rows]
        random.shuffle(all_ids)
        return all_ids

    query_text = user_message.lower()
    day_trip = any(keyword in query_text for keyword in DAY_TRIP_KEYWORDS)
    query_regions = _detect_query_regions(query_text, query_tokens, rows)
    specific_regions = {
        region for region in query_regions if region not in BROAD_REGION_HINTS
    }
    scoring_tokens = _build_scoring_tokens(query_tokens)
    focus_tokens = _extract_focus_tokens(query_tokens, query_regions)
    locality_tokens = _extract_locality_tokens(query_tokens)
    token_stats = _build_token_stats(rows)

    scored = [
        _score_row(
            row,
            query_text,
            scoring_tokens,
            query_regions,
            specific_regions,
            focus_tokens,
            locality_tokens,
            day_trip,
            token_stats,
        )
        for row in rows
    ]

    scored.sort(key=lambda item: (item[1], item[2]), reverse=True)
    row_by_id = {int(row["id"]): row for row in rows}
    ordered_ids: list[int] = []
    seen_name_keys: set[str] = set()
    for region_id, _, _ in scored:
        row = row_by_id.get(region_id)
        if not row:
            continue
        name_key = _normalize_name_key(row.get("name", ""))
        if not name_key or name_key in seen_name_keys:
            continue
        seen_name_keys.add(name_key)
        ordered_ids.append(region_id)

    if all(score <= 0 for _, score, _ in scored):
        random.shuffle(ordered_ids)
    return ordered_ids


def _row_has_real_image(row: dict) -> bool:
    return bool(sanitize_display_image_url(str(row.get("imageUrl", ""))))


def _build_recommendation_ids(
    user_message: str,
    rows: list[dict],
    size: int = FEED_TOP_K,
    intent: Optional[dict] = None,
) -> list[int]:
    if not rows:
        return []

    if os.getenv("CHAT_REQUIRE_REAL_IMAGE", "1").strip() != "0":
        rows = [r for r in rows if _row_has_real_image(r)]
        if not rows:
            return []

    query_tokens = _tokenize(user_message)
    query_text = user_message.lower()
    day_trip = any(keyword in query_text for keyword in DAY_TRIP_KEYWORDS)
    query_regions = _detect_query_regions(query_text, query_tokens, rows)
    specific_regions = {
        region for region in query_regions if region not in BROAD_REGION_HINTS
    }
    scoring_tokens = _build_scoring_tokens(query_tokens)
    focus_tokens = _extract_focus_tokens(query_tokens, query_regions)
    locality_tokens = _extract_locality_tokens(query_tokens)
    token_stats = _build_token_stats(rows)
    trend_scores: dict[int, float] = {}
    if mysql_url_configured():
        try:
            with session_scope() as session:
                place_ids = [int(r["id"]) for r in rows if "id" in r]
                trend_scores = trends_store.get_trend_scores_for_places(session, place_ids)
        except Exception:
            logger.warning("[CHAT] trend score 로딩 실패 -> 감쇠 가중치 미적용")

    scored: list[tuple[int, float, str, dict]] = []
    intent_for_boost = intent if isinstance(intent, dict) else {}
    exclusion_tags = set(intent_for_boost.get("exclusions") or [])
    if exclusion_tags:
        rows = filter_rows_by_exclusions(rows, exclusion_tags)
        if not rows:
            return []
    trend_weight = float(os.getenv("CHAT_TREND_SCORE_WEIGHT", "6.0"))
    for row in rows:
        region_id, score, name = _score_row(
            row,
            query_text,
            scoring_tokens,
            query_regions,
            specific_regions,
            focus_tokens,
            locality_tokens,
            day_trip,
            token_stats,
        )
        final_score = _apply_intent_score_boost(row, intent_for_boost, score)
        final_score += trend_scores.get(region_id, 0.0) * trend_weight
        scored.append((region_id, final_score, name, row))
    scored.sort(key=lambda item: (item[1], item[2]), reverse=True)
    has_specific_region_match = any(
        _region_match(row, specific_regions) for row in rows
    ) if specific_regions else False
    has_locality_match = any(
        _locality_match(row, locality_tokens) for row in rows
    ) if locality_tokens else False

    used_ids: set[int] = set()
    used_names: set[str] = set()
    picked: list[int] = []

    def push(region_id: int, row: dict) -> None:
        if region_id in used_ids:
            return
        name_key = _normalize_name_key(row.get("name", ""))
        if not name_key or name_key in used_names:
            return
        used_ids.add(region_id)
        used_names.add(name_key)
        picked.append(region_id)

    # 1) 높은 관련도만 우선 채택 (질의별 동적 기준)
    top_score = scored[0][1] if scored else 0.0
    dynamic_threshold = max(2.0, top_score * 0.35)
    for region_id, score, _, row in scored:
        if score < dynamic_threshold:
            continue
        push(region_id, row)
        if len(picked) >= size:
            return picked[:size]

    # 2) 특정 지역 질의면 같은 지역만 추가 보충
    if locality_tokens:
        for region_id, _, _, row in scored:
            if not _locality_match(row, locality_tokens):
                continue
            push(region_id, row)
            if len(picked) >= size:
                return picked[:size]

    if specific_regions:
        for region_id, _, _, row in scored:
            if not _region_match(row, specific_regions):
                continue
            push(region_id, row)
            if len(picked) >= size:
                return picked[:size]
    elif query_regions:
        for region_id, _, _, row in scored:
            if not _region_match(row, query_regions):
                continue
            push(region_id, row)
            if len(picked) >= size:
                return picked[:size]

    # 2.5) 질의 지명이 희소할 때는 첫 추천의 권역(시/군/구)으로 보충
    anchor_keys: set[str] = set()
    anchor_city = ""
    if picked:
        row_by_id = {int(row["id"]): row for row in rows}
        anchor_row = row_by_id.get(picked[0], {})
        anchor_keys = {
            str(anchor_row.get("region", "")).strip().lower(),
            str(anchor_row.get("province", "")).strip().lower(),
        }
        anchor_keys = {value for value in anchor_keys if value}
        anchor_city = (
            str(anchor_row.get("address", "")).strip().split(" ")[0].lower()
            if anchor_row
            else ""
        )
        if anchor_keys:
            for region_id, _, _, row in scored:
                blob = " ".join(
                    [
                        str(row.get("region", "")),
                        str(row.get("province", "")),
                        str(row.get("address", "")),
                    ]
                ).lower()
                if not any(key in blob for key in anchor_keys):
                    continue
                push(region_id, row)
                if len(picked) >= size:
                    return picked[:size]

    # 2.6) 로컬 지명 질의는 앵커 도시 기준으로 먼저 채웁니다.
    if locality_tokens and (anchor_keys or anchor_city):
        for region_id, _, _, row in scored:
            blob = " ".join(
                [
                    str(row.get("region", "")),
                    str(row.get("province", "")),
                    str(row.get("address", "")),
                ]
            ).lower()
            if (
                anchor_city
                and anchor_city not in blob
                and not any(key in blob for key in anchor_keys)
            ):
                continue
            push(region_id, row)
            if len(picked) >= size:
                return picked[:size]

    # 3) 질의 지역/로컬리티를 전혀 찾지 못하면 무관한 전역 추천을 피합니다.
    if (specific_regions and not has_specific_region_match) or (
        locality_tokens and not has_locality_match
    ):
        return picked[:size]

    # 4) 남은 슬롯은 낮은 점수 순서대로 최소 보충
    for region_id, _, _, row in scored:
        push(region_id, row)
        if len(picked) >= size:
            break

    return picked[:size]


def _normalize_recommended_ids(
    candidate_ids: list, valid_ids: set[int], fallback_ids: list[int]
) -> list[int]:
    normalized: list[int] = []
    for value in candidate_ids:
        if isinstance(value, int):
            candidate = value
        elif isinstance(value, str) and value.isdigit():
            candidate = int(value)
        else:
            continue
        if candidate in valid_ids and candidate not in normalized:
            normalized.append(candidate)

    for fallback_id in fallback_ids:
        if fallback_id in valid_ids and fallback_id not in normalized:
            normalized.append(fallback_id)
        if len(normalized) >= FEED_TOP_K:
            break
    return normalized[:FEED_TOP_K]


def _normalize_trip_recommended_ids(
    candidate_ids: list, valid_ids: set[int], fallback_ids: list[int], limit: int
) -> list[int]:
    capped_limit = max(1, int(limit))
    normalized: list[int] = []
    for value in candidate_ids:
        if isinstance(value, int):
            candidate = value
        elif isinstance(value, str) and value.isdigit():
            candidate = int(value)
        else:
            continue
        if candidate in valid_ids and candidate not in normalized:
            normalized.append(candidate)

    for fallback_id in fallback_ids:
        if fallback_id in valid_ids and fallback_id not in normalized:
            normalized.append(fallback_id)
        if len(normalized) >= capped_limit:
            break
    return normalized[:capped_limit]


def _trip_items_per_day(user_message: str, intent: Optional[dict] = None) -> int:
    """
    트립 하루 추천 개수 동적 계산.
    - 기본 6 (시간 슬롯 수에 맞춤)
    - 느긋한 일정: 4
    - 빡빡한 일정: 8
    """
    text = str(user_message or "").lower()
    mood = str((intent or {}).get("mood") or "").lower()
    relaxed_keywords = ("여유", "느긋", "천천히", "힐링", "빡세지 않게")
    packed_keywords = ("빡세", "타이트", "많이", "최대한 많이", "알차게", "촘촘")
    if any(k in text for k in relaxed_keywords) or mood == "calm":
        return 4
    if any(k in text for k in packed_keywords):
        return 8
    return int(os.getenv("TRIP_ITEMS_PER_DAY_DEFAULT", str(TRIP_ITEMS_PER_DAY)))


def _apply_trip_schedule(
    place_ids: list[int],
    rows: list[dict],
    days: int,
    reg_f: Optional[str],
    prov_f: Optional[str],
    row_by_id: dict[int, dict],
) -> tuple[list[int], str, list[dict]]:
    try:
        from app.services.trip_planner_utils import build_trip_schedule

        return build_trip_schedule(
            place_ids,
            rows,
            days,
            reg_f=reg_f,
            prov_f=prov_f,
            row_by_id=row_by_id,
        )
    except Exception:
        logger.warning("[TRIP] trip_planner_utils 실패 -> 기존 정렬 로직 폴백")
        return _reorder_trip_ids_meal_alternating(place_ids, rows), "", []


def _format_trip_recent_chat(recent_messages: Optional[list[dict]], limit: int = 8) -> str:
    if not recent_messages:
        return ""
    lines: list[str] = []
    for m in recent_messages[-limit:]:
        role = m.get("role")
        text = str(m.get("text") or "").strip()[:600]
        if not text:
            continue
        label = "사용자" if role == "user" else "어시스턴트"
        lines.append(f"{label}: {text}")
    if not lines:
        return ""
    return "[최근 대화]\n" + "\n".join(lines) + "\n\n"


def _full_schedule_for_replace(
    current_location_ids: list[int],
    excluded_id: int,
    new_id: int,
    rows: list[dict],
    days: int,
    reg_f: Optional[str],
    prov_f: Optional[str],
    row_by_id: dict[int, dict],
) -> list[dict]:
    merged: list[int] = []
    for cid in current_location_ids or []:
        if int(cid) == int(excluded_id):
            merged.append(int(new_id))
        else:
            merged.append(int(cid))
    _, _, sched = _apply_trip_schedule(
        merged, rows, days, reg_f, prov_f, row_by_id
    )
    return recommend_core.schedule_entries_for_api(sched) or []


def _count_cafe_ids(place_ids: list[int], row_by_id: dict[int, dict]) -> int:
    return sum(
        1
        for pid in place_ids or []
        if is_cafe_place(row_by_id.get(int(pid)) or {})
    )


def _refine_swap_count(
    kept_len: int,
    user_message: str,
    cafe_count: int,
) -> int:
    text = str(user_message or "")
    if kept_len <= 0:
        return 0
    if re.search(r"카페\s*위주|위주.*카페|카페\s*중심|카페\s*메인", text):
        target = max(3, round(kept_len * 0.35))
        return max(0, target - cafe_count)
    if re.search(r"몇\s*개\s*빼|빼고.*(넣|추가)|추가.*카페|카페.*추가", text):
        return max(2, min(5, kept_len // 3))
    if message_requests_cafe_theme(text) and re.search(
        r"위주|바꿔|조정|짜|넣|추가", text
    ):
        return max(2, min(4, kept_len // 3))
    return 0


def _pick_ids_to_swap_out(
    kept: list[int],
    row_by_id: dict[int, dict],
    count: int,
    *,
    prefer_cafe: bool,
) -> list[int]:
    if count <= 0 or not kept:
        return []
    scored: list[tuple[int, int]] = []
    for pid in kept:
        row = row_by_id.get(int(pid)) or {}
        score = 0
        if prefer_cafe and is_cafe_place(row):
            score += 1000
        elif prefer_cafe and is_food_place(row):
            score += 200
        if is_temple_place(row):
            score -= 80
        if is_major_sightseeing_place(row) and not is_food_place(row):
            score -= 40
        name = str(row.get("name") or "")
        if any(k in name for k in ("산업단지", "시장", "유람", "요트")):
            score -= 25
        scored.append((score, int(pid)))
    scored.sort(key=lambda x: x[0])
    return [pid for _, pid in scored[:count]]


def _refine_fill_slots(
    user_message: str,
    rows: list[dict],
    row_by_id: dict[int, dict],
    intent: dict,
    reg_f: Optional[str],
    prov_f: Optional[str],
    valid_region_ids: set[int],
    exclusion_tags: set[str],
    exclude_set: set[int],
    slots: int,
    *,
    prefer_cafe: bool,
) -> list[int]:
    if slots <= 0:
        return []
    candidate_limit = max(slots + 24, slots * 4)
    search_msg = user_message
    if prefer_cafe and "카페" not in search_msg:
        search_msg = f"{search_msg} 여수 감성 카페 디저트 브런치"

    baseline_ids = recommend_core.build_trip_baseline_ids(
        search_msg,
        rows,
        row_by_id,
        intent,
        reg_f,
        prov_f,
        candidate_limit,
        exclude_set,
        _trip_row_matches_geo_filter,
        _build_recommendation_ids,
    )
    baseline_ids = [i for i in baseline_ids if i not in exclude_set]
    baseline_ids = filter_ids_by_exclusions(baseline_ids, row_by_id, exclusion_tags)
    if prefer_cafe:
        cafe_first = [i for i in baseline_ids if is_cafe_place(row_by_id.get(i) or {})]
        other = [i for i in baseline_ids if i not in cafe_first]
        baseline_ids = cafe_first + other
    baseline_ids = recommend_core.apply_trip_theme_priority(
        baseline_ids,
        row_by_id,
        search_msg,
        intent,
        candidate_limit,
    )
    if not baseline_ids:
        baseline_ids = _build_recommendation_ids(
            search_msg, rows, candidate_limit, intent=intent
        )
        baseline_ids = [
            i
            for i in baseline_ids
            if i not in exclude_set
            and row_passes_exclusions(row_by_id[i], exclusion_tags)
        ]
    dspy_ids, _ = recommend_core.select_ids_with_dspy(
        search_msg,
        baseline_ids,
        row_by_id,
        slots,
    )
    pick = dspy_ids if dspy_ids else baseline_ids
    new_ids = _normalize_trip_recommended_ids(
        pick[:slots],
        valid_region_ids,
        baseline_ids,
        slots,
    )
    new_ids = filter_ids_by_exclusions(new_ids, row_by_id, exclusion_tags)
    return _filter_ids_by_geo(new_ids, row_by_id, reg_f, prov_f)


def _refine_current_itinerary(
    user_message: str,
    current_location_ids: list[int],
    rows: list[dict],
    row_by_id: dict[int, dict],
    *,
    max_locations: int,
    reg_f: Optional[str],
    prov_f: Optional[str],
    valid_region_ids: set[int],
    current_schedule: Optional[list[dict]] = None,
    trip_days: int = 1,
    items_per_day: int = 6,
) -> tuple[list[int], str]:
    """
    로드맵 일정을 유지·조정: 제외·테마(카페 등) 반영, 꽉 찬 일정은 일부 교체.
    """
    intent = _parse_intent(user_message, duration=None)
    trip_profile = detect_trip_theme_profile(user_message)
    patch = trip_profile.to_intent_patch()
    if patch["themes"]:
        intent["themes"] = list(
            dict.fromkeys((intent.get("themes") or []) + patch["themes"])
        )
    if patch["mustVisit"]:
        intent["mustVisit"] = patch["mustVisit"]
    prefer_cafe = message_requests_cafe_theme(user_message)
    if prefer_cafe:
        intent["themes"] = list(dict.fromkeys((intent.get("themes") or []) + ["cafe"]))
    if message_requests_food_theme(user_message) or prefer_cafe or re.search(
        r"카페|식당|맛집|음식", user_message
    ):
        intent["mood"] = intent.get("mood") or "food"
    exclusion_tags = set(intent.get("exclusions") or detect_exclusion_tags(user_message))
    intent["exclusions"] = exclusion_tags

    target_day = detect_refine_target_day(user_message)
    if target_day and (current_schedule or current_location_ids):
        return _refine_single_day_itinerary(
            user_message,
            current_location_ids,
            rows,
            row_by_id,
            target_day=target_day,
            max_locations=max_locations,
            reg_f=reg_f,
            prov_f=prov_f,
            valid_region_ids=valid_region_ids,
            intent=intent,
            exclusion_tags=exclusion_tags,
            current_schedule=current_schedule,
            trip_days=trip_days,
            items_per_day=items_per_day,
        )

    kept: list[int] = []
    removed_labels: list[str] = []
    for pid in current_location_ids or []:
        row = row_by_id.get(int(pid))
        if not row:
            continue
        if exclusion_tags and not row_passes_exclusions(row, exclusion_tags):
            removed_labels.append(str(row.get("name") or "장소"))
            continue
        kept.append(int(pid))

    swap_n = _refine_swap_count(len(kept), user_message, _count_cafe_ids(kept, row_by_id))
    if swap_n > 0:
        swap_out = _pick_ids_to_swap_out(
            kept, row_by_id, swap_n, prefer_cafe=prefer_cafe
        )
        for pid in swap_out:
            row = row_by_id.get(int(pid))
            if row:
                removed_labels.append(str(row.get("name") or "장소"))
        kept = [p for p in kept if p not in swap_out]

    slots = max(0, max_locations - len(kept))
    exclude_set = set(kept)
    new_ids: list[int] = []

    if slots > 0:
        new_ids = _refine_fill_slots(
            user_message,
            rows,
            row_by_id,
            intent,
            reg_f,
            prov_f,
            valid_region_ids,
            exclusion_tags,
            exclude_set,
            slots,
            prefer_cafe=prefer_cafe,
        )

    merged = (kept + [i for i in new_ids if i not in exclude_set])[:max_locations]

    parts: list[str] = []
    if removed_labels:
        shown = "·".join(removed_labels[:3])
        if len(removed_labels) > 3:
            shown += f" 외 {len(removed_labels) - 3}곳"
        parts.append(f"{shown}은(는) 일정에서 뺐어요.")
    if new_ids:
        added_names = [
            str(row_by_id[i].get("name") or "")
            for i in new_ids[:3]
            if row_by_id.get(i)
        ]
        label = "카페" if prefer_cafe else "추천 장소"
        if added_names:
            parts.append(
                f"{label} 위주로 {', '.join(added_names)}"
                f"{'' if len(new_ids) <= 3 else f' 외 {len(new_ids) - 3}곳'}을 넣었어요."
            )
        else:
            parts.append(f"{label} 위주로 {len(new_ids)}곳을 채웠어요.")
    elif slots > 0:
        parts.append(
            "조건에 맞는 새 장소를 더 찾지 못했어요. 지역명을 포함해 다시 말씀해 주세요."
        )
    elif prefer_cafe and _count_cafe_ids(merged, row_by_id) == 0:
        parts.append(
            "일정에 카페가 아직 없어요. 「여수 카페 위주로 몇 곳 빼고 다시」처럼 다시 요청해 주세요."
        )

    answer = " ".join(parts) if parts else "일정을 조정했어요."
    return merged, answer


def _ids_grouped_by_day(
    current_location_ids: list[int],
    schedule: Optional[list[dict]],
    days: int,
    items_per_day: int,
) -> dict[int, list[int]]:
    if schedule:
        by_day: dict[int, list[int]] = {}
        for entry in schedule:
            try:
                day_num = int(entry.get("day") or 1)
                pid = int(entry.get("placeId") or entry.get("place_id") or 0)
            except (TypeError, ValueError):
                continue
            if pid:
                by_day.setdefault(day_num, []).append(pid)
        if by_day:
            return by_day
    by_day = {}
    day_count = max(1, int(days) or 1)
    per = max(1, int(items_per_day) or 6)
    for idx, pid in enumerate(current_location_ids or []):
        day_num = min(day_count, idx // per + 1)
        by_day.setdefault(day_num, []).append(int(pid))
    return by_day


def _refine_single_day_itinerary(
    user_message: str,
    current_location_ids: list[int],
    rows: list[dict],
    row_by_id: dict[int, dict],
    *,
    target_day: int,
    max_locations: int,
    reg_f: Optional[str],
    prov_f: Optional[str],
    valid_region_ids: set[int],
    intent: dict,
    exclusion_tags: set[str],
    current_schedule: Optional[list[dict]],
    trip_days: int,
    items_per_day: int,
) -> tuple[list[int], str]:
    """특정 일차만 테마·제외 조건으로 다시 채움."""
    by_day = _ids_grouped_by_day(
        current_location_ids,
        current_schedule,
        trip_days,
        items_per_day,
    )
    day_ids = list(by_day.get(int(target_day), []))
    replace_whole_day = bool(re.search(r"위주|만\b|바꿔|조정", user_message))

    kept_day: list[int] = []
    removed_labels: list[str] = []
    if replace_whole_day:
        for pid in day_ids:
            row = row_by_id.get(int(pid))
            if row:
                removed_labels.append(str(row.get("name") or "장소"))
    else:
        for pid in day_ids:
            row = row_by_id.get(int(pid))
            if not row:
                continue
            if exclusion_tags and not row_passes_exclusions(row, exclusion_tags):
                removed_labels.append(str(row.get("name") or "장소"))
            else:
                kept_day.append(int(pid))

    slots = len(day_ids) if day_ids else max(1, items_per_day)
    if replace_whole_day:
        slots = len(day_ids) if day_ids else max(1, items_per_day)
    else:
        slots = max(0, slots - len(kept_day))

    exclude_set = set(current_location_ids or [])
    new_day_ids: list[int] = []
    if slots > 0:
        candidate_limit = max(slots + 24, slots * 4)
        baseline_ids = recommend_core.build_trip_baseline_ids(
            user_message,
            rows,
            row_by_id,
            intent,
            reg_f,
            prov_f,
            candidate_limit,
            exclude_set,
            _trip_row_matches_geo_filter,
            _build_recommendation_ids,
        )
        baseline_ids = [i for i in baseline_ids if i not in exclude_set]
        baseline_ids = filter_ids_by_exclusions(baseline_ids, row_by_id, exclusion_tags)
        baseline_ids = recommend_core.apply_trip_theme_priority(
            baseline_ids,
            row_by_id,
            user_message,
            intent,
            candidate_limit,
        )
        if not baseline_ids:
            baseline_ids = _build_recommendation_ids(
                user_message, rows, candidate_limit, intent=intent
            )
            baseline_ids = [
                i
                for i in baseline_ids
                if i not in exclude_set
                and row_passes_exclusions(row_by_id[i], exclusion_tags)
            ]
        dspy_ids, _ = recommend_core.select_ids_with_dspy(
            user_message,
            baseline_ids,
            row_by_id,
            slots,
        )
        pick = dspy_ids if dspy_ids else baseline_ids
        new_day_ids = _normalize_trip_recommended_ids(
            pick[:slots],
            valid_region_ids,
            baseline_ids,
            slots,
        )
        new_day_ids = filter_ids_by_exclusions(new_day_ids, row_by_id, exclusion_tags)
        new_day_ids = _filter_ids_by_geo(new_day_ids, row_by_id, reg_f, prov_f)

    by_day[int(target_day)] = kept_day + [
        i for i in new_day_ids if i not in kept_day
    ][: len(day_ids) if day_ids else items_per_day]

    merged: list[int] = []
    for d in range(1, max(trip_days, max(by_day.keys(), default=1)) + 1):
        merged.extend(by_day.get(d, []))
    merged = merged[:max_locations]

    parts: list[str] = [f"{target_day}일차 일정을 조정했어요."]
    if removed_labels:
        shown = "·".join(removed_labels[:3])
        if len(removed_labels) > 3:
            shown += f" 외 {len(removed_labels) - 3}곳"
        parts.append(f"{shown}을(를) 반영했어요.")
    if new_day_ids:
        names = [
            str(row_by_id[i].get("name") or "")
            for i in new_day_ids[:3]
            if i in row_by_id
        ]
        names = [n for n in names if n]
        if names:
            parts.append(f"추가·교체: {', '.join(names)}.")
    answer = " ".join(parts)
    return merged, answer


def _pack_trip_response(
    *,
    answer: str,
    recommended_ids: list[int],
    schedule: Optional[list[dict]] = None,
    detected_action: Optional[str] = None,
    excluded_location_id: Optional[int] = None,
    detected_duration: Optional[dict] = None,
) -> dict:
    payload: dict = {
        "answer": answer,
        "recommendedRegionIds": recommended_ids,
        "detectedAction": detected_action,
        "excludedLocationId": excluded_location_id,
        "detectedDuration": detected_duration,
    }
    api_schedule = recommend_core.schedule_entries_for_api(schedule or [])
    if api_schedule:
        payload["schedule"] = api_schedule
    return payload


def get_chat_result(
    user_message: str,
    *,
    relation: Optional[str] = None,
    mood: Optional[str] = None,
    transport: Optional[str] = None,
    duration: Optional[int] = None,
) -> dict:
    api_key: Optional[str] = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    scope_notice = _out_of_scope_notice(user_message)
    valid_region_ids = {int(row["id"]) for row in rows}
    row_by_id = {int(r["id"]): r for r in rows}

    intent = _parse_intent(user_message, relation, mood, transport, duration)

    baseline_ids = recommend_core.build_gallery_baseline_ids(
        user_message,
        rows,
        row_by_id,
        intent,
        FEED_TOP_K,
        _detect_embedding_filters,
        _build_recommendation_ids,
    )

    dspy_ids, dspy_answer = recommend_core.select_ids_with_dspy(
        user_message,
        baseline_ids,
        row_by_id,
        FEED_TOP_K,
    )
    chosen_ids = dspy_ids if dspy_ids else baseline_ids

    recommended_ids = _normalize_recommended_ids(chosen_ids, valid_region_ids, baseline_ids)
    if not recommended_ids:
        no_match_answer = "요청하신 지역/조건과 정확히 일치하는 데이터를 찾지 못했습니다. 지역명이나 키워드를 조금 바꿔서 다시 입력해 주세요."
        answer = f"{scope_notice}\n{no_match_answer}" if scope_notice else no_match_answer
        return {"answer": answer, "recommendedRegionIds": []}
    if dspy_ids:
        answer = dspy_answer or _standard_answer_from_ids(recommended_ids, rows)
        if scope_notice:
            answer = f"{scope_notice}\n{answer}"
        return {"answer": answer, "recommendedRegionIds": recommended_ids}

    if not api_key:
        fallback = _standard_answer_from_ids(recommended_ids, rows)
        answer = f"{scope_notice}\n{fallback}" if scope_notice else fallback
        return {"answer": answer, "recommendedRegionIds": recommended_ids}

    client = OpenAI(api_key=api_key)
    region_context = _build_region_context()
    system_prompt = _build_system_prompt(intent) + " 반드시 JSON 한 개로만 응답하세요."
    intent_context = _build_intent_context_lines(intent)
    user_atmosphere_hint = (
        "[중요] id를 고를 때 이름·지역만 보지 말고, 각 장소 요약의 분위기·감성이 "
        "아래 사용자 조건과 맞는지를 최우선으로 보세요.\n\n"
    )

    try:
        user_extra = ""
        if intent_context.strip():
            user_extra = f"사용자 조건:\n{intent_context}\n\n"
        response = client.chat.completions.create(
            model=model,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        "데이터 목록:\n"
                        f"{region_context}\n\n"
                        f"{user_atmosphere_hint}"
                        f"{user_extra}"
                        "다음 형식으로 답하세요: "
                        '{"answer":"...", "recommendedRegionIds":[id1,id2,id3,id4,id5,id6,id7,id8,id9]}\n'
                        f"질문: {user_message}"
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        answer = parsed.get("answer") or _fallback_answer(user_message)
        ids = parsed.get("recommendedRegionIds")
        if not isinstance(ids, list):
            ids = []
        ids = _normalize_recommended_ids(ids, valid_region_ids, baseline_ids)
        answer = _standard_answer_from_ids(ids, rows)
        if scope_notice:
            answer = f"{scope_notice}\n{answer}"
        return {"answer": answer, "recommendedRegionIds": ids}
    except Exception:
        logger.exception("[CHAT] get_chat_result failed message=%s", user_message[:120])
        fallback = _standard_answer_from_ids(recommended_ids, rows)
        answer = f"{scope_notice}\n{fallback}" if scope_notice else fallback
        return {"answer": answer, "recommendedRegionIds": recommended_ids}


def _detect_embedding_filters(user_message: str, rows: list[dict]) -> tuple[Optional[str], Optional[str]]:
    """Pinecone 메타데이터용 (region_eq, province_eq). 값은 DB에 저장된 canonical 문자열."""
    um = user_message or ""
    um_l = um.lower()
    query_tokens = _tokenize(um_l)

    for t in query_tokens:
        canon = _PROVINCE_TOKEN_TO_CANONICAL.get(t)
        if canon and any(str(r.get("province") or "").strip() == canon for r in rows):
            return None, canon

    # 시·군·구 지명(여수, 전주 등): 도 전체가 아니라 해당 도시·권역으로 좁힘
    for city in sorted(_CITY_TOKEN_TO_PROVINCE.keys(), key=len, reverse=True):
        prov = _CITY_TOKEN_TO_PROVINCE[city]
        if city in query_tokens or city in um_l:
            if any(str(r.get("province") or "").strip() == prov for r in rows):
                return city, prov

    provinces = sorted(
        {str(r.get("province") or "").strip() for r in rows if str(r.get("province") or "").strip()},
        key=len,
        reverse=True,
    )
    for p in provinces:
        if len(p) >= 2 and p in um:
            return None, p
    for t in query_tokens:
        if len(t) < 2:
            continue
        for p in provinces:
            if p.startswith(t) or (len(t) >= 3 and t in p):
                return None, p

    regions = sorted(
        {str(r.get("region") or "").strip() for r in rows if str(r.get("region") or "").strip()},
        key=len,
        reverse=True,
    )
    for r in regions:
        if len(r) >= 2 and r in um:
            return r, None
    for t in query_tokens:
        if len(t) < 2:
            continue
        for r in regions:
            if r.startswith(t) or (len(t) >= 3 and t in r):
                return r, None
    return None, None


def _trip_row_matches_geo_filter(
    row: dict, reg_f: Optional[str], prov_f: Optional[str]
) -> bool:
    """Pinecone/토큰으로 고른 행정구역 필터와 행이 일치하는지."""
    if prov_f:
        if str(row.get("province") or "").strip() != prov_f:
            return False
    if reg_f:
        city = reg_f.strip()
        if not city:
            return True
        rr = str(row.get("region") or "").strip()
        if rr == city or rr.startswith(city):
            return True
        blob = " ".join(
            [
                rr,
                str(row.get("address") or ""),
                str(row.get("name") or ""),
                str(row.get("summary") or "")[:120],
            ]
        )
        if city in blob:
            return True
        # 다른 시·군명이 이름/주소에 더 뚜렷하면 제외 (여수 요청에 순천·목포 등)
        for other in _CITY_TOKEN_TO_PROVINCE:
            if other == city or len(other) < 2:
                continue
            if other in blob and city not in blob:
                return False
        return False
    return True


def _parse_trip_duration_from_message(user_message: str) -> Optional[dict]:
    """메시지에서 N박 M일·N일 패턴 추출 (AI 감지 실패 시 폴백)."""
    text = str(user_message or "")
    m = re.search(r"(\d+)\s*박\s*(\d+)\s*일", text)
    if m:
        nights = int(m.group(1))
        days = int(m.group(2))
        if days >= 1:
            items = _trip_items_per_day(text)
            return {
                "nights": nights,
                "days": days,
                "maxLocations": max(1, days * items),
                "itemsPerDay": items,
            }
    m_days = re.search(r"(\d+)\s*일", text)
    if m_days and not re.search(r"\d+\s*박", text):
        days = int(m_days.group(1))
        if days >= 1:
            items = _trip_items_per_day(text)
            return {
                "nights": max(0, days - 1),
                "days": days,
                "maxLocations": max(1, days * items),
                "itemsPerDay": items,
            }
    if any(kw in text for kw in DAY_TRIP_KEYWORDS):
        items = _trip_items_per_day(text)
        return {"nights": 0, "days": 1, "maxLocations": items, "itemsPerDay": items}
    return None


def _filter_ids_by_geo(
    ids: list[int],
    row_by_id: dict[int, dict],
    reg_f: Optional[str],
    prov_f: Optional[str],
) -> list[int]:
    if not reg_f and not prov_f:
        return ids
    return [
        i
        for i in ids
        if i in row_by_id and _trip_row_matches_geo_filter(row_by_id[i], reg_f, prov_f)
    ]


def _build_trip_spot_context(rows_subset: list[dict]) -> str:
    lines: list[str] = []
    for row in rows_subset:
        try:
            pid = int(row["id"])
        except Exception:
            continue
        name = row.get("name", "")
        lat = row.get("latitude")
        lng = row.get("longitude")
        types = row.get("recommendedBusinesses") or []
        type_str = str(types[0]) if types else ""
        summ = (row.get("summary") or "")[:200]
        lines.append(
            f"- id={pid} / 이름={name} / 좌표=({lat}, {lng}) / 유형={type_str} / 설명={summ}"
        )
    return "\n".join(lines)


def _find_location_id_by_name(name: str, rows: list[dict]) -> Optional[int]:
    """장소 이름(문자열)을 location ID로 매핑. 정확 매칭 → 부분 매칭 순서."""
    if not name:
        return None
    name_stripped = name.strip()
    for row in rows:
        if row.get("name", "") == name_stripped:
            return int(row["id"])
    for row in rows:
        if name_stripped in row.get("name", "") or row.get("name", "") in name_stripped:
            return int(row["id"])
    return None


def _format_schedule_for_routing(
    current_schedule: Optional[list[dict]],
) -> str:
    if not current_schedule:
        return ""
    by_day: dict[int, list[str]] = {}
    for entry in current_schedule:
        try:
            day_num = int(entry.get("day") or 1)
            name = str(entry.get("placeName") or "").strip() or f"#{entry.get('placeId')}"
        except (TypeError, ValueError):
            continue
        by_day.setdefault(day_num, []).append(name)
    if not by_day:
        return ""
    lines = [f"{d}일차: {', '.join(by_day[d])}" for d in sorted(by_day)]
    return "\n[현재 일정 구성]\n" + "\n".join(lines)


def _detect_trip_action(
    user_message: str,
    current_location_ids: list[int],
    rows: list[dict],
    api_key: Optional[str],
    current_trip_duration: Optional[dict] = None,
    recent_messages: Optional[list[dict]] = None,
    current_schedule: Optional[list[dict]] = None,
) -> dict:
    """OpenAI function calling으로 사용자 메시지를 분석해 액션·기간·지역을 감지한다."""
    fallback = {"action": "recommend", "exclude_location_name": None, "detected_duration": None}
    if not api_key:
        return fallback

    current_names = []
    row_by_id = {int(r["id"]): r for r in rows}
    for loc_id in (current_location_ids or []):
        row = row_by_id.get(loc_id)
        if row:
            current_names.append(row.get("name", ""))

    tools = [
        {
            "type": "function",
            "function": {
                "name": "route_action",
                "description": "사용자의 여행 계획 채팅 메시지를 분석해 수행할 액션과 여행 기간을 결정한다.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "action": {
                            "type": "string",
                            "enum": [
                                "recommend",
                                "replan",
                                "refine",
                                "remove",
                                "replace",
                                "add_preference",
                                "unsupported",
                            ],
                            "description": (
                                "recommend: 로드맵이 비었거나 새 장소 추천·추가. "
                                "replan: 일정 전체를 버리고 처음부터 (지역·기간·테마를 크게 바꿀 때, '코스 다시', '처음부터'). "
                                "refine: 로드맵에 장소가 있을 때, 일부만 조정. "
                                "예: 절/사찰 빼기, 카페·맛집 위주, 2일차만 바꿔, ○○ 빼고 비슷한 곳으로 채워, "
                                "너무 빡빡해/여유롭게, 실내 위주 등 — 장소 이름을 하나씩 말하지 않아도 refine. "
                                "remove: **특정 장소 이름**을 짚고 삭제만 (대체 없음). "
                                "replace: **특정 한 곳** 이름을 짚고 다른 한 곳으로 교체 ('불국사 말고 첨성대'). "
                                "add_preference: refine과 겹치면 refine 우선. 단순 질문·설명만이면 add_preference. "
                                "unsupported: 날씨·교통·가격·예약 등 장소 추천과 무관."
                            ),
                        },
                        "target_location_name": {
                            "type": "string",
                            "description": "remove 또는 replace일 때, 대상 장소의 이름. 해당 없으면 null.",
                        },
                        "unsupported_reason": {
                            "type": "string",
                            "description": "action이 unsupported일 때, 사용자에게 전달할 짧은 안내 메시지.",
                        },
                        "exclude_location_name": {
                            "type": "string",
                            "description": "action이 exclude일 때, 제외할 장소의 이름. 해당 없으면 null.",
                        },
                        "detected_nights": {
                            "type": "integer",
                            "description": "메시지에서 감지된 숙박 수. '당일'·'1일'이면 0, '1박2일'이면 1. 기간 언급 없으면 null.",
                        },
                        "detected_days": {
                            "type": "integer",
                            "description": "메시지에서 감지된 총 일수. '1일'·'당일'이면 1, '1박2일'이면 2. 기간 언급 없으면 null.",
                        },
                    },
                    "required": ["action"],
                },
            },
        }
    ]

    duration_ctx = ""
    if current_trip_duration:
        duration_ctx = (
            f"[여행 기간 힌트: {current_trip_duration.get('nights', 0)}박 "
            f"{current_trip_duration.get('days', 1)}일 — 장소가 로드맵에 있다는 뜻은 아님]"
        )

    system_msg = (
        "당신은 여행 계획 어시스턴트입니다. "
        "사용자의 메시지와 최근 대화·현재 일정을 보고 route_action을 호출하세요. "
        "로드맵에 장소가 0개면 recommend 또는 replan만 사용하세요. "
        "장소가 이미 있으면, 부분 수정·테마·제외·특정 일차 조정은 refine입니다. "
        "전체를 갈아엎을 때만 replan입니다. "
        "장소 이름 없이 '절 빼고', '2일차만 카페', '맛집 위주' 등은 refine입니다."
    )
    user_msg = _format_trip_recent_chat(recent_messages) + user_message
    if duration_ctx:
        user_msg += f"\n\n{duration_ctx}"
    if current_names:
        user_msg += f"\n[현재 일정 장소: {', '.join(current_names)}]"
        user_msg += _format_schedule_for_routing(current_schedule)
    else:
        user_msg += "\n[현재 일정 장소: 없음 — 로드맵이 비어 있음. 장소 추천이 필요합니다.]"

    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            tools=tools,
            tool_choice={"type": "function", "function": {"name": "route_action"}},
            messages=[
                {"role": "system", "content": system_msg},
                {"role": "user", "content": user_msg},
            ],
        )
        tool_call = response.choices[0].message.tool_calls[0]
        args = json.loads(tool_call.function.arguments)

        detected_nights = args.get("detected_nights")
        detected_days = args.get("detected_days")
        detected_duration = None
        if detected_nights is not None and detected_days is not None:
            items_per_day = _trip_items_per_day(user_message)
            max_locations = max(1, int(detected_days) * items_per_day)
            detected_duration = {
                "nights": int(detected_nights),
                "days": int(detected_days),
                "maxLocations": max_locations,
                "itemsPerDay": items_per_day,
            }

        result = {
            "action": args.get("action", "recommend"),
            "target_location_name": args.get("target_location_name"),
            "detected_duration": detected_duration,
            "unsupported_reason": args.get("unsupported_reason"),
        }
        logger.info(f"[action_routing] 사용자 메시지='{user_message}' → {result}")
        return result
    except Exception as e:
        logger.warning(f"[action_routing] 액션 판단 실패 ({e}), fallback=recommend")
        return fallback


def _message_wants_new_itinerary(user_message: str) -> bool:
    """로드맵이 비었을 때 첫 코스를 채워야 하는 메시지인지."""
    t = str(user_message or "").strip()
    if len(t) < 4:
        return False
    if re.search(
        r"제주|부산|여수|경주|서울|강릉|전주|대구|인천|여행|가고\s*싶|추천|일정|코스|해변|맛집|카페",
        t,
        re.I,
    ):
        return True
    if _parse_trip_duration_from_message(t):
        return True
    return bool(re.search(r"\d+\s*박|\d+\s*일", t))


def get_trip_chat_result(
    user_message: str,
    trip_duration: dict,
    current_location_ids: Optional[list[int]] = None,
    exclude_location_id: Optional[int] = None,
    *,
    replan: bool = False,
    recent_messages: Optional[list[dict]] = None,
    current_schedule: Optional[list[dict]] = None,
) -> dict:
    """Trip planner용 채팅 - OpenAI 답변만 반환 (자동 메시지 없음)"""
    api_key: Optional[str] = os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    valid_region_ids = {int(row["id"]) for row in rows}

    parsed_duration = _parse_trip_duration_from_message(user_message)
    if parsed_duration and (trip_duration.get("days", 1) <= 1 or parsed_duration.get("days", 0) > 1):
        trip_duration = {
            "nights": parsed_duration["nights"],
            "days": parsed_duration["days"],
        }

    # AI로 액션·기간을 판단한다.
    ai_detected_action: str = "recommend"
    ai_excluded_id: Optional[int] = None
    ai_detected_duration: Optional[dict] = None
    if not replan and exclude_location_id is None:
        action_result = _detect_trip_action(
            user_message,
            current_location_ids or [],
            rows,
            api_key,
            current_trip_duration=trip_duration,
            recent_messages=recent_messages,
            current_schedule=current_schedule,
        )
        ai_action = action_result["action"]
        ai_detected_action = ai_action
        ai_detected_duration = action_result.get("detected_duration")

        # 기간이 감지되면 trip_duration 업데이트
        if ai_detected_duration:
            trip_duration = {
                "nights": ai_detected_duration["nights"],
                "days": ai_detected_duration["days"],
            }
        elif parsed_duration:
            ai_detected_duration = parsed_duration
            trip_duration = {
                "nights": parsed_duration["nights"],
                "days": parsed_duration["days"],
            }

        loc_name = action_result.get("target_location_name")

        if ai_action == "unsupported":
            reason = action_result.get("unsupported_reason") or "장소 추천이나 일정 관련 질문을 해주세요!"
            return {
                "answer": reason,
                "recommendedRegionIds": [],
                "detectedAction": "unsupported",
                "excludedLocationId": None,
                "detectedDuration": None,
            }
        elif ai_action == "remove":
            matched = _find_location_id_by_name(loc_name, rows) if loc_name else None
            vague_remove = bool(
                re.search(r"몇\s*개\s*빼|빼고|줄여|덜\s*넣|빼\s*줄", user_message)
            )
            if matched:
                return {
                    "answer": "",
                    "recommendedRegionIds": [],
                    "detectedAction": "remove",
                    "excludedLocationId": matched,
                    "detectedDuration": ai_detected_duration,
                }
            if vague_remove or message_wants_itinerary_refine(
                user_message
            ) or message_requests_cafe_theme(user_message):
                ai_action = "refine"
                ai_detected_action = "refine"
            else:
                return {
                    "answer": (
                        "뺄 장소 이름을 찾지 못했어요. "
                        "「향일암 빼고」처럼 이름을 말씀하시거나, "
                        "「몇 곳 빼고 카페 위주로」처럼 말씀해 주시면 일정을 다시 맞출게요."
                    ),
                    "recommendedRegionIds": [],
                    "detectedAction": "unsupported",
                    "excludedLocationId": None,
                    "detectedDuration": ai_detected_duration,
                }
        elif ai_action == "refine":
            ai_detected_action = "refine"
        elif ai_action == "replan":
            if (
                (current_location_ids or [])
                and message_wants_itinerary_refine(user_message)
                and not re.search(
                    r"처음부터|전부\s*다시|코스\s*다시|일정\s*다시\s*짜|새로\s*짜",
                    user_message,
                )
            ):
                ai_action = "refine"
                ai_detected_action = "refine"
            else:
                replan = True
        elif ai_action == "replace":
            if loc_name:
                matched = _find_location_id_by_name(loc_name, rows)
                if matched:
                    exclude_location_id = matched
                    ai_excluded_id = matched

    # 로드맵이 비었는데 add_preference만 고르면 장소가 안 채워짐
    if not (current_location_ids or []) and ai_detected_action == "add_preference":
        replan = True
        ai_detected_action = "replan"

    # 첫 일정 만들기: 장소 0개 + 지역/여행 의도면 전체 추천
    if not (current_location_ids or []) and not replan:
        if ai_detected_action == "recommend" or _message_wants_new_itinerary(user_message):
            replan = True
            ai_detected_action = "replan"

    valid_region_ids = {int(r["id"]) for r in rows}
    row_by_id_early = {int(r["id"]): r for r in rows}
    days_early = trip_duration.get("days", 1)
    items_per_day_early = _trip_items_per_day(user_message)
    max_locations_early = max(1, int(days_early) * items_per_day_early)

    should_refine = (
        (current_location_ids or [])
        and not replan
        and (
            ai_detected_action == "refine"
            or message_wants_itinerary_refine(user_message)
            or message_requests_cafe_theme(user_message)
            or (
                ai_detected_action == "add_preference"
                and (
                    detect_exclusion_tags(user_message)
                    or message_requests_food_theme(user_message)
                    or message_requests_cafe_theme(user_message)
                    or detect_refine_target_day(user_message)
                )
            )
        )
    )
    if should_refine:
        reg_rf, prov_rf = _detect_embedding_filters(user_message, rows)
        refined_ids, refine_answer = _refine_current_itinerary(
            user_message,
            current_location_ids,
            rows,
            row_by_id_early,
            max_locations=max_locations_early,
            reg_f=reg_rf,
            prov_f=prov_rf,
            valid_region_ids=valid_region_ids,
            current_schedule=current_schedule,
            trip_days=days_early,
            items_per_day=items_per_day_early,
        )
        changed = set(refined_ids or []) != set(current_location_ids or [])
        if refined_ids and (
            changed
            or not message_requests_cafe_theme(user_message)
            or _count_cafe_ids(refined_ids, row_by_id_early) > 0
        ):
            _, _, trip_schedule_refined = _apply_trip_schedule(
                refined_ids,
                rows,
                days_early,
                reg_rf,
                prov_rf,
                row_by_id_early,
            )
            return _pack_trip_response(
                answer=refine_answer,
                recommended_ids=refined_ids,
                schedule=trip_schedule_refined,
                detected_action="refine",
                excluded_location_id=None,
                detected_duration=ai_detected_duration,
            )
        if message_requests_cafe_theme(user_message) and not changed:
            replan = True
            ai_detected_action = "replan"

    if replan:
        # 전체 재계획: 기존 로드맵·교체 대상 제외는 쓰지 않고 후보부터 다시 짠다.
        current_ids_set = set()
        effective_exclude = None
    else:
        current_ids_set = set(current_location_ids or [])
        effective_exclude = exclude_location_id
        if effective_exclude:
            current_ids_set.add(effective_exclude)

    # tripDuration 기반 최대 개수 계산 (고정 5개 -> 동적 per-day)
    days = trip_duration.get("days", 1)
    items_per_day = _trip_items_per_day(user_message)
    max_locations = max(1, int(days) * items_per_day)

    candidate_limit = max_locations
    # 교체 요청일 때는 제외 필터로 후보가 급감할 수 있어 탐색 폭을 넓혀둔다.
    if not replan and effective_exclude is not None:
        candidate_limit = max(max_locations + 20, max_locations * 3)

    row_by_id = {int(r["id"]): r for r in rows}
    try:
        duration_for_intent = int(days) if days is not None else None
    except (TypeError, ValueError):
        duration_for_intent = None
    intent = _parse_intent(user_message, duration=duration_for_intent)
    trip_profile = detect_trip_theme_profile(user_message)
    patch = trip_profile.to_intent_patch()
    if patch["themes"]:
        intent["themes"] = patch["themes"]
    if patch["mustVisit"]:
        intent["mustVisit"] = patch["mustVisit"]
    if not intent.get("mood"):
        inferred = intent_mood_from_profile(trip_profile)
        if inferred:
            intent["mood"] = inferred
    if message_requests_food_theme(user_message) and not intent.get("mood"):
        intent["mood"] = "food"
    exclusion_tags = set(intent.get("exclusions") or detect_exclusion_tags(user_message))
    intent["exclusions"] = exclusion_tags
    reg_f, prov_f = _detect_embedding_filters(user_message, rows)
    baseline_ids = recommend_core.build_trip_baseline_ids(
        user_message,
        rows,
        row_by_id,
        intent,
        reg_f,
        prov_f,
        candidate_limit,
        current_ids_set,
        _trip_row_matches_geo_filter,
        _build_recommendation_ids,
    )
    baseline_ids = recommend_core.apply_trip_theme_priority(
        baseline_ids,
        row_by_id,
        user_message,
        intent,
        candidate_limit,
    )

    if not baseline_ids and not reg_f and not prov_f:
        baseline_ids = _build_recommendation_ids(
            user_message, rows, candidate_limit, intent=intent
        )
        baseline_ids = [i for i in baseline_ids if i not in current_ids_set]

    if (reg_f or prov_f) and not baseline_ids:
        label = reg_f or prov_f or "해당 지역"
        return {
            "answer": (
                f"말씀하신 권역('{label}')에 맞는 장소를 데이터에서 찾지 못했어요. "
                "지역명을 조금 바꾸거나, 아직 데이터에 없는 지역일 수 있습니다."
            ),
            "recommendedRegionIds": [],
            "detectedAction": ai_detected_action,
            "excludedLocationId": ai_excluded_id,
            "detectedDuration": ai_detected_duration,
        }

    recommended_ids = _normalize_trip_recommended_ids(
        baseline_ids,
        valid_region_ids,
        baseline_ids,
        max_locations,
    )
    dspy_trip_ids, dspy_trip_answer = recommend_core.select_ids_with_dspy(
        user_message,
        baseline_ids,
        row_by_id,
        max_locations,
    )
    if dspy_trip_ids:
        recommended_ids = _normalize_trip_recommended_ids(
            dspy_trip_ids,
            valid_region_ids,
            baseline_ids,
            max_locations,
        )
    recommended_ids = filter_ids_by_exclusions(recommended_ids, row_by_id, exclusion_tags)
    recommended_ids = _filter_ids_by_geo(recommended_ids, row_by_id, reg_f, prov_f)
    recommended_ids = recommend_core.apply_trip_theme_priority(
        recommended_ids,
        row_by_id,
        user_message,
        intent,
        max_locations,
    )
    if not recommended_ids and baseline_ids:
        recommended_ids = filter_ids_by_exclusions(
            _filter_ids_by_geo(
                _normalize_trip_recommended_ids(
                    baseline_ids[:max_locations],
                    valid_region_ids,
                    baseline_ids,
                    max_locations,
                ),
                row_by_id,
                reg_f,
                prov_f,
            ),
            row_by_id,
            exclusion_tags,
        )
    recommended_ids, schedule_context, trip_schedule = _apply_trip_schedule(
        recommended_ids,
        rows,
        days,
        reg_f,
        prov_f,
        row_by_id,
    )

    if not api_key:
        schedule_out = trip_schedule
        if (
            ai_detected_action == "replace"
            and ai_excluded_id
            and recommended_ids
            and current_location_ids
        ):
            schedule_out = _full_schedule_for_replace(
                current_location_ids,
                ai_excluded_id,
                recommended_ids[0],
                rows,
                days,
                reg_f,
                prov_f,
                row_by_id,
            )
        return _pack_trip_response(
            answer=dspy_trip_answer or "추천 장소를 조회했습니다.",
            recommended_ids=recommended_ids,
            schedule=schedule_out,
            detected_action=ai_detected_action,
            excluded_location_id=ai_excluded_id,
            detected_duration=ai_detected_duration,
        )

    if dspy_trip_ids:
        replace_schedule = trip_schedule
        if (
            ai_detected_action == "replace"
            and ai_excluded_id
            and recommended_ids
            and current_location_ids
        ):
            replace_schedule = _full_schedule_for_replace(
                current_location_ids,
                ai_excluded_id,
                recommended_ids[0],
                rows,
                days,
                reg_f,
                prov_f,
                row_by_id,
            )
        return _pack_trip_response(
            answer=dspy_trip_answer or _trip_answer_from_ids(recommended_ids, rows),
            recommended_ids=recommended_ids,
            schedule=replace_schedule,
            detected_action=ai_detected_action,
            excluded_location_id=ai_excluded_id,
            detected_duration=ai_detected_duration,
        )

    client = OpenAI(api_key=api_key)
    nights = trip_duration.get("nights", 0)
    cand_rows = [row_by_id[i] for i in baseline_ids if i in row_by_id][: max(candidate_limit, days * 10)]
    if not cand_rows:
        cand_rows = rows[: min(30, len(rows))]
    trip_ctx = _build_trip_spot_context(cand_rows)
    system_prompt = (
        _build_system_prompt(intent)
        + f" 사용자는 {nights}박 {days}일 여행을 계획 중입니다. "
        f"최대 {max_locations}개 장소를 추천할 수 있습니다. "
        "후보 장소의 좌표를 고려해 동선이 효율적인 일정을 제안하고, 각 장소 추천 이유를 설명하세요. "
    )
    if prov_f:
        system_prompt += f"반드시 행정구역이 '{prov_f}'인 장소만 선택하세요. 다른 시·도는 제외합니다. "
    if reg_f:
        system_prompt += f"시·군·구는 '{reg_f}'와 일치하는 장소만 선택하세요. 지명이 어긋나면 후보에 있어도 넣지 마세요. "
    if replan:
        system_prompt += (
            " 사용자가 기존 일정을 버리고 전체 코스를 새로 짜 달라고 요청했습니다. "
            "이전 로드맵은 무시하고 recommendedRegionIds에 후보 id만으로 최대 개수까지 새로 채우세요. "
            "빈 배열로 두지 마세요(후보가 부족하면 있는 만큼). "
        )
    excl_note = exclusion_prompt_lines(exclusion_tags)
    if excl_note:
        system_prompt += f" 사용자 제외 조건을 반드시 지키세요:\n{excl_note}\n"
    system_prompt += "응답은 반드시 json 객체 한 개로만 반환하세요."
    intent_context = _build_intent_context_lines(intent)
    user_atmosphere_hint = (
        "[중요] 후보의 ‘설명’을 읽고 분위기·감성·동행 맥락이 사용자 조건과 맞는 id를 고르세요. "
        "이름만 보고 고르지 마세요.\n\n"
    )
    n_on_map = 0 if replan else len(current_location_ids or [])
    empty_roadmap_note = ""
    if n_on_map == 0:
        empty_roadmap_note = (
            "\n[상태] 로드맵 장소 수 = 0. 여행 기간만 정해진 것일 수 있으며, "
            "그 경우에도 '일정이 이미 있다'고 말하지 말고 recommendedRegionIds에 "
            "후보 id를 최대한 채워 첫 코스를 제안하세요.\n"
        )
    roadmap_cap_note = ""
    if not replan and n_on_map >= max_locations:
        roadmap_cap_note = (
            "\n[상태] 지금 로드맵에 이미 최대 개수에 가깝거나 찼습니다. "
            "사용자가 동행(친구·연인 등)·분위기·짧은 한마디만 하는 경우에는 answer로만 먼저 반응하고, "
            "recommendedRegionIds는 빈 배열 [] 로 두거나 새 id를 넣지 마세요. "
            "장소 추가·교체·기간 연장을 명시했을 때만 id를 채우세요.\n"
        )
    replan_user_note = ""
    if replan:
        replan_user_note = (
            "\n[요청 유형] 일정 전체 재구성(replan). 기존 로드맵·이전 장소는 참고하지 말고 "
            f"새 recommendedRegionIds를 최대 {max_locations}개까지 채우세요.\n"
        )

    try:
        response = client.chat.completions.create(
            model=model,
            temperature=0.3,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": (
                        _format_trip_recent_chat(recent_messages)
                        + f"사용자가 요청한 여행 조건에 맞춰, 아래 후보 장소들만 사용해 추천하세요.\n"
                        f"{trip_ctx}\n\n"
                        + (f"[사전 배분된 시간대 일정]\n{schedule_context}\n\n" if schedule_context else "")
                        + f"{user_atmosphere_hint}"
                        + (f"사용자 조건:\n{intent_context}\n\n" if intent_context.strip() else "")
                        + replan_user_note
                        + empty_roadmap_note
                        + roadmap_cap_note
                        + f"recommendedRegionIds에는 위 id만 사용하고 최대 {max_locations}개까지 포함하세요. "
                        f'형식: {{"answer":"...", "recommendedRegionIds":[...]}}\n'
                        f"질문: {user_message}"
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        llm_answer = parsed.get("answer") or ""
        ids = parsed.get("recommendedRegionIds")
        if not isinstance(ids, list):
            ids = []
        # 현재 로드맵에 이미 있는 것들 제외
        ids = [id for id in ids if id not in current_ids_set]
        ids = _filter_ids_by_geo(ids, row_by_id, reg_f, prov_f)
        ids = filter_ids_by_exclusions(ids, row_by_id, exclusion_tags)

        ids = _normalize_trip_recommended_ids(
            ids,
            valid_region_ids,
            baseline_ids,
            max_locations,
        )
        ids, _, trip_schedule_llm = _apply_trip_schedule(
            ids,
            rows,
            days,
            reg_f,
            prov_f,
            row_by_id,
        )
        trip_schedule_out = trip_schedule_llm
        if (
            ai_detected_action == "replace"
            and ai_excluded_id
            and ids
            and current_location_ids
        ):
            trip_schedule_out = _full_schedule_for_replace(
                current_location_ids,
                ai_excluded_id,
                ids[0],
                rows,
                days,
                reg_f,
                prov_f,
                row_by_id,
            )
        answer = llm_answer.strip() or _trip_answer_from_ids(ids, rows)

        return _pack_trip_response(
            answer=answer,
            recommended_ids=ids,
            schedule=trip_schedule_out,
            detected_action=ai_detected_action,
            excluded_location_id=ai_excluded_id,
            detected_duration=ai_detected_duration,
        )
    except Exception:
        logger.exception(
            "[CHAT] get_trip_chat_result failed message=%s nights=%s days=%s",
            user_message[:120],
            trip_duration.get("nights"),
            trip_duration.get("days"),
        )
        return _pack_trip_response(
            answer="추천을 처리하는 중 오류가 발생했습니다.",
            recommended_ids=recommended_ids,
            schedule=trip_schedule,
            detected_action=ai_detected_action,
            excluded_location_id=ai_excluded_id,
            detected_duration=ai_detected_duration,
        )
