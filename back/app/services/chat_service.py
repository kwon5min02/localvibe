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
from app.services import embedding_service

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
TRIP_ITEMS_PER_DAY = 5

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
    "trendy": ["핫플", "인스타", "트렌디", "힙한", "유명한", "뜨는", "요즘"],
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
    "trendy": ["핫플", "인기", "트렌디", "유명", "힙"],
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

    return {
        "relation": parsed_relation,
        "mood": parsed_mood,
        "transport": parsed_transport,
        "duration": parsed_duration,
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

        final = {
            "relation": relation or gpt_relation,
            "mood": mood or gpt_mood,
            "transport": transport or gpt_transport,
            "duration": duration if duration is not None else gpt_duration,
            "raw_query": user_message,
        }
        logger.info(
            "[CHAT] intent parsed relation=%s mood=%s transport=%s duration=%s",
            final["relation"],
            final["mood"],
            final["transport"],
            final["duration"],
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
            "단순 관광지 나열보다 먹거리·브런치 키워드가 살아 있는 요약을 선호하세요."
        )
    elif mood == "culture":
        extras.append(
            "전시·박물관·역사·예술·체험 등 머리와 감각을 채우는 장소를 우선하세요. "
            "교육적·서사적 분위기가 요약에서 읽히는 곳을 고르세요."
        )

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
    return any(region in aliases for region in regions)


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
    if image_url.startswith("http"):
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


def _build_recommendation_ids(
    user_message: str,
    rows: list[dict],
    size: int = FEED_TOP_K,
    intent: Optional[dict] = None,
) -> list[int]:
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

    scored: list[tuple[int, float, str, dict]] = []
    intent_for_boost = intent if isinstance(intent, dict) else {}
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


def get_chat_result(
    user_message: str,
    *,
    relation: Optional[str] = None,
    mood: Optional[str] = None,
    transport: Optional[str] = None,
    duration: Optional[int] = None,
) -> dict:
    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    scope_notice = _out_of_scope_notice(user_message)
    valid_region_ids = {int(row["id"]) for row in rows}
    row_by_id = {int(r["id"]): r for r in rows}

    intent = _parse_intent(user_message, relation, mood, transport, duration)

    baseline_ids: list[int] = []
    if embedding_service.pinecone_ready():
        reg_f, prov_f = _detect_embedding_filters(user_message, rows)
        try:
            pinecone_ids = embedding_service.search(
                user_message,
                region_filter=reg_f,
                top_k=CHAT_PINECONE_TOP_K,
                province_filter=prov_f,
            )
        except Exception:
            logger.exception("[CHAT] pinecone search failed for gallery chat")
            pinecone_ids = []
        pinecone_rows = [row_by_id[int(i)] for i in pinecone_ids if int(i) in row_by_id]
        if pinecone_rows:
            baseline_ids = _build_recommendation_ids(
                user_message, pinecone_rows, FEED_TOP_K, intent=intent
            )
        if len(baseline_ids) < CHAT_PINECONE_MIN_RESULTS:
            extra = _build_recommendation_ids(user_message, rows, FEED_TOP_K, intent=intent)
            for eid in extra:
                if eid not in baseline_ids:
                    baseline_ids.append(eid)
                if len(baseline_ids) >= FEED_TOP_K:
                    break
    else:
        baseline_ids = _build_recommendation_ids(
            user_message, rows, FEED_TOP_K, intent=intent
        )

    recommended_ids = _normalize_recommended_ids(
        baseline_ids, valid_region_ids, baseline_ids
    )
    if not recommended_ids:
        no_match_answer = "요청하신 지역/조건과 정확히 일치하는 데이터를 찾지 못했습니다. 지역명이나 키워드를 조금 바꿔서 다시 입력해 주세요."
        answer = f"{scope_notice}\n{no_match_answer}" if scope_notice else no_match_answer
        return {"answer": answer, "recommendedRegionIds": []}
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
    """Pinecone 메타데이터용 (region_eq, province_eq)."""
    provinces = sorted(
        {str(r.get("province") or "").strip() for r in rows if str(r.get("province") or "").strip()},
        key=len,
        reverse=True,
    )
    for p in provinces:
        if len(p) >= 2 and p in user_message:
            return None, p
    regions = sorted(
        {str(r.get("region") or "").strip() for r in rows if str(r.get("region") or "").strip()},
        key=len,
        reverse=True,
    )
    for r in regions:
        if len(r) >= 2 and r in user_message:
            return r, None
    return None, None


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


def get_trip_chat_result(
    user_message: str,
    trip_duration: dict,
    current_location_ids: Optional[list[int]] = None,
    exclude_location_id: Optional[int] = None,
) -> dict:
    """Trip planner용 채팅 - OpenAI 답변만 반환 (자동 메시지 없음)"""
    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    valid_region_ids = {int(row["id"]) for row in rows}

    # 현재 로드맵에 있는 ID들을 set으로 변환
    current_ids_set = set(current_location_ids or [])
    # 교체 대상 ID도 제외
    if exclude_location_id:
        current_ids_set.add(exclude_location_id)

    # tripDuration 기반 최대 개수 계산
    days = trip_duration.get("days", 1)
    max_locations = max(1, days * TRIP_ITEMS_PER_DAY)

    candidate_limit = max_locations
    # 교체 요청일 때는 제외 필터로 후보가 급감할 수 있어 탐색 폭을 넓혀둔다.
    if exclude_location_id is not None:
        candidate_limit = max(max_locations + 20, max_locations * 3)

    row_by_id = {int(r["id"]): r for r in rows}
    intent = _parse_intent(user_message)
    reg_f, prov_f = _detect_embedding_filters(user_message, rows)
    baseline_ids: list[int] = []
    if embedding_service.pinecone_ready():
        top_k = max(1, days * 10)
        baseline_ids = embedding_service.search(
            user_message,
            region_filter=reg_f,
            top_k=top_k,
            province_filter=prov_f,
        )
        baseline_ids = [i for i in baseline_ids if i in row_by_id and i not in current_ids_set]
        if len(baseline_ids) < max(3, max_locations // 2):
            extra = _build_recommendation_ids(
                user_message, rows, candidate_limit, intent=intent
            )
            for eid in extra:
                if eid not in baseline_ids and eid not in current_ids_set and eid in row_by_id:
                    baseline_ids.append(eid)
                if len(baseline_ids) >= candidate_limit:
                    break
    if not baseline_ids:
        baseline_ids = _build_recommendation_ids(
            user_message, rows, candidate_limit, intent=intent
        )
        baseline_ids = [i for i in baseline_ids if i not in current_ids_set]

    recommended_ids = _normalize_trip_recommended_ids(
        baseline_ids,
        valid_region_ids,
        baseline_ids,
        max_locations,
    )
    recommended_ids = _reorder_trip_ids_meal_alternating(recommended_ids, rows)

    if not api_key:
        # API 키 없을 때는 기본 답변만 반환 (메시지 없이)
        return {
            "answer": "추천 장소를 조회했습니다.",
            "recommendedRegionIds": recommended_ids,
        }

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
        "응답은 반드시 json 객체 한 개로만 반환하세요."
    )
    intent_context = _build_intent_context_lines(intent)
    user_atmosphere_hint = (
        "[중요] 후보의 ‘설명’을 읽고 분위기·감성·동행 맥락이 사용자 조건과 맞는 id를 고르세요. "
        "이름만 보고 고르지 마세요.\n\n"
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
                        f"사용자가 요청한 여행 조건에 맞춰, 아래 후보 장소들만 사용해 추천하세요.\n"
                        f"{trip_ctx}\n\n"
                        f"{user_atmosphere_hint}"
                        + (f"사용자 조건:\n{intent_context}\n\n" if intent_context.strip() else "")
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

        ids = _normalize_trip_recommended_ids(
            ids,
            valid_region_ids,
            baseline_ids,
            max_locations,
        )
        ids = _reorder_trip_ids_meal_alternating(ids, rows)
        answer = llm_answer.strip() or _trip_answer_from_ids(ids, rows)

        # OpenAI 답변만 그대로 반환 (자동 메시지 X)
        return {"answer": answer, "recommendedRegionIds": ids}
    except Exception:
        logger.exception(
            "[CHAT] get_trip_chat_result failed message=%s nights=%s days=%s",
            user_message[:120],
            trip_duration.get("nights"),
            trip_duration.get("days"),
        )
        return {
            "answer": "추천을 처리하는 중 오류가 발생했습니다.",
            "recommendedRegionIds": recommended_ids,
        }
