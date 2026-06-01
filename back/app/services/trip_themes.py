"""
트립 플래너·갤러리 검색 공통 여행 테마·필수 방문 키워드.

예: 맛집, 카페, 바다, 빵/베이커리, 야구장, 축구(챔피언스필드), 야경 등
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field

# ── 테마 정의 (query 감지용 키워드) ──
THEME_QUERY_KEYWORDS: dict[str, tuple[str, ...]] = {
    "food": (
        "맛집",
        "음식",
        "먹거리",
        "식도락",
        "먹방",
        "먹을거리",
        "식당",
        "레스토랑",
        "맛집투어",
        "맛집여행",
        "한식",
        "해산물",
    ),
    "cafe": ("카페", "커피", "디저트", "브런치", "카페투어", "커페거리"),
    "bakery": ("빵", "베이커리", "제과", "빵집", "성심당", "튀김소보로", "카스테라"),
    "beach": ("바다", "해변", "해수욕", "해안", "포구", "오션", "물놀이", "해풍"),
    "baseball": ("야구", "야구장", "프로야구", "kbo", "문학야구장", "잠실야구장"),
    "soccer": ("축구", "축구장", "월드컵경기장", "챔피언스필드", "경기장관람"),
    "culture": ("박물관", "미술관", "전시", "문화", "역사", "유적", "서원"),
    "nature": ("자연", "산", "숲", "계곡", "폭포", "트레킹", "등산"),
    "shopping": ("쇼핑", "시장", "아울렛", "백화점", "플리마켓"),
    "night": ("야경", "야간", "밤", "바", "펍", "클럽"),
}

# 감지 우선순위 (앞일수록 먼저 잡힘 — 구체 테마 우선)
THEME_DETECT_ORDER: tuple[str, ...] = (
    "soccer",
    "baseball",
    "bakery",
    "beach",
    "cafe",
    "food",
    "night",
    "shopping",
    "culture",
    "nature",
)

THEME_SEARCH_BOOST: dict[str, str] = {
    "food": "음식점 맛집 식당",
    "cafe": "카페 커피 디저트",
    "bakery": "베이커리 빵집 제과",
    "beach": "해변 바다 해수욕장",
    "baseball": "야구장 프로야구",
    "soccer": "축구장 월드컵경기장 챔피언스필드",
    "culture": "박물관 문화시설",
    "nature": "자연 공원",
    "shopping": "쇼핑 시장",
    "night": "야경 전망",
}

THEME_MOOD_MAP: dict[str, str] = {
    "food": "food",
    "cafe": "food",
    "bakery": "food",
    "beach": "nature",
    "nature": "nature",
    "culture": "culture",
    "night": "night",
    "shopping": "trendy",
}

# 필수 방문: 사용자 표현 → DB 매칭용 별칭
MUST_VISIT_ALIASES: dict[str, tuple[str, ...]] = {
    "챔피언스필드": ("챔피언스필드", "월드컵경기장", "광주월드컵", "월드컵 경기장", "축구장"),
    "야구장": ("야구장", "야구", "프로야구", "구장"),
    "성심당": ("성심당", "대전성심당"),
    "빵": ("성심당", "베이커리", "빵집", "제과"),
    "해변": ("해변", "해수욕", "바다", "포구"),
    "바다": ("해변", "해수욕", "바다", "해안"),
    "한옥마을": ("한옥마을", "한옥 마을"),
    "경기장": ("경기장", "월드컵", "구장"),
}

# 의도 추출 시 제외할 짧은 지명·일반어
_MUST_VISIT_SKIP = frozenset(
    {
        "전주",
        "광주",
        "대전",
        "부산",
        "서울",
        "제주",
        "여수",
        "경주",
        "강릉",
        "여행",
        "일정",
        "추천",
        "코스",
        "가고",
        "가볼",
        "싶어",
        "싶은",
        "포함",
        "넣어",
        "위주",
        "중심",
        "근처",
        "주변",
        "그리고",
        "이랑",
        "하고",
    }
)

_MUST_VISIT_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(
        r"([\w가-힣]{2,12}(?:야구장|축구장|경기장|구장|필드|베이커리|빵집|해변|해변가|성심당))",
        re.I,
    ),
    re.compile(
        r"([\w가-힣]{2,10})\s*(?:가고\s*싶|가볼래|가볼|꼭\s*가|넣어\s*줘|포함|가야|갈\s*거|방문)",
        re.I,
    ),
    re.compile(r"(챔피언스\s*필드|성심당|월드컵\s*경기장)", re.I),
)

_FOOD_CONTENT_TYPE_IDS = frozenset({"39"})
_SIGHTSEEING_CONTENT_TYPE_IDS = frozenset({"12", "14"})


@dataclass
class TripThemeProfile:
    themes: List[str] = field(default_factory=list)
    must_visit: List[str] = field(default_factory=list)

    @property
    def active(self) -> bool:
        return bool(self.themes or self.must_visit)

    def to_intent_patch(self) -> dict:
        return {"themes": list(self.themes), "mustVisit": list(self.must_visit)}


def _compact(text: str) -> str:
    return str(text or "").lower().replace(" ", "")


def _place_blob(row: dict) -> str:
    name = str(row.get("name") or "")
    summary = str(row.get("summary") or row.get("description") or "")
    category = str(row.get("category") or "")
    address = str(row.get("address") or "")
    rec = row.get("recommendedBusinesses") or []
    rec_text = " ".join(str(x) for x in rec) if isinstance(rec, list) else ""
    return f"{name} {summary} {category} {address} {rec_text}".lower()


def _insight_content_type_id(row: dict) -> str:
    try:
        insight = json.loads(row.get("insight_json") or "{}")
    except Exception:
        insight = {}
    return str(insight.get("contentTypeId") or row.get("contentTypeId") or "").strip()


def detect_trip_theme_profile(user_message: str) -> TripThemeProfile:
    text = str(user_message or "").strip()
    compact = _compact(text)
    if not compact:
        return TripThemeProfile()

    themes: list[str] = []
    # 야구 vs 축구: 챔피언스필드는 축구(광주), 야구 키워드 있으면 baseball 우선
    has_baseball = any(k in compact for k in THEME_QUERY_KEYWORDS["baseball"])
    has_soccer = any(k in compact for k in THEME_QUERY_KEYWORDS["soccer"])
    if "챔피언스필드" in compact or "챔피언스필" in compact:
        has_soccer = True
        if not has_baseball:
            themes.append("soccer")

    for key in THEME_DETECT_ORDER:
        if key == "soccer" and key in themes:
            continue
        if key == "baseball" and has_baseball and "baseball" not in themes:
            themes.append("baseball")
            continue
        if key == "soccer" and has_soccer and "soccer" not in themes:
            themes.append("soccer")
            continue
        kws = THEME_QUERY_KEYWORDS.get(key, ())
        if any(kw in compact for kw in kws) and key not in themes:
            themes.append(key)

    must_visit = _extract_must_visit(text, compact, themes)
    return TripThemeProfile(themes=themes, must_visit=must_visit)


def _extract_must_visit(text: str, compact: str, themes: list[str]) -> list[str]:
    found: list[str] = []

    for key, aliases in MUST_VISIT_ALIASES.items():
        if any(a.replace(" ", "") in compact or a in text for a in aliases):
            found.append(key)

    for pat in _MUST_VISIT_PATTERNS:
        for m in pat.finditer(text):
            phrase = m.group(1).strip()
            phrase_compact = phrase.replace(" ", "")
            if len(phrase_compact) < 2 or phrase_compact in _MUST_VISIT_SKIP:
                continue
            if phrase_compact in found:
                continue
            found.append(phrase)

    if "야구" in compact and "야구장" not in found:
        found.append("야구장")
    if "축구" in compact and "챔피언스필드" not in found and "soccer" in themes:
        found.append("챔피언스필드")
    if "빵" in compact and "bakery" in themes and "빵" not in found:
        found.append("빵")

    out: list[str] = []
    seen: set[str] = set()
    for item in found:
        k = item.replace(" ", "")
        if k in seen or k in _MUST_VISIT_SKIP:
            continue
        seen.add(k)
        out.append(item)
    return out[:8]


def message_requests_food_theme(user_message: str) -> bool:
    p = detect_trip_theme_profile(user_message)
    return "food" in p.themes or "bakery" in p.themes or "cafe" in p.themes


def message_requests_cafe_theme(user_message: str) -> bool:
    text = str(user_message or "")
    if re.search(r"카페|커피|브런치|디저트|카페투어", text):
        return True
    return "cafe" in detect_trip_theme_profile(text).themes


def theme_boosted_search_query(user_message: str, profile: TripThemeProfile | None = None) -> str:
    base = str(user_message or "").strip()
    if not base:
        return base
    profile = profile or detect_trip_theme_profile(base)
    extra: list[str] = []
    for t in profile.themes:
        boost = THEME_SEARCH_BOOST.get(t, "")
        if boost:
            extra.extend(boost.split())
    for m in profile.must_visit:
        extra.extend(MUST_VISIT_ALIASES.get(m, (m,)))
    if not extra:
        return base
    combined = f"{base} {' '.join(dict.fromkeys(extra))}"
    return combined.strip()


def must_visit_match_terms(phrase: str) -> tuple[str, ...]:
    key = phrase.replace(" ", "")
    if key in MUST_VISIT_ALIASES:
        return MUST_VISIT_ALIASES[key]
    return (phrase, key)


def place_matches_must_visit(row: dict, phrase: str) -> bool:
    blob = _place_blob(row)
    for term in must_visit_match_terms(phrase):
        t = term.replace(" ", "").lower()
        if len(t) >= 2 and t in blob.replace(" ", ""):
            return True
        if len(term) >= 2 and term.lower() in blob:
            return True
    return False


def is_food_place(row: dict) -> bool:
    if not row:
        return False
    if _insight_content_type_id(row) in _FOOD_CONTENT_TYPE_IDS:
        return True
    blob = _place_blob(row)
    if any(k in blob for k in ("음식점", "식당", "맛집", "레스토랑", "한식", "양식", "일식", "해산물")):
        return True
    category = str(row.get("category") or "")
    return any(k in category for k in ("음식", "식당", "맛집"))


def is_cafe_place(row: dict) -> bool:
    blob = _place_blob(row)
    if any(k in blob for k in ("카페", "커피", "디저트", "브런치")):
        return True
    name = str(row.get("name") or "")
    return "카페" in name or "coffee" in name.lower()


def is_bakery_place(row: dict) -> bool:
    blob = _place_blob(row)
    return any(k in blob for k in ("베이커리", "빵집", "제과", "성심당", "빵", "튀김소보로"))


def is_beach_place(row: dict) -> bool:
    blob = _place_blob(row)
    return any(
        k in blob
        for k in ("해변", "해수욕", "바다", "해안", "포구", "해변공원", "해수욕장", "오션")
    )


def is_baseball_place(row: dict) -> bool:
    blob = _place_blob(row)
    if "야구" in blob or "야구장" in blob:
        return True
    name = str(row.get("name") or "")
    return "야구" in name or name.endswith("구장") and "축구" not in blob


def is_soccer_place(row: dict) -> bool:
    blob = _place_blob(row)
    if any(k in blob for k in ("축구", "축구장", "월드컵", "챔피언스필드", "경기장")):
        if "야구" not in blob:
            return True
    name = str(row.get("name") or "")
    return any(k in name for k in ("월드컵", "챔피언스", "축구"))


def is_major_sightseeing_place(row: dict) -> bool:
    if is_food_place(row) or is_cafe_place(row) or is_bakery_place(row):
        return False
    if _insight_content_type_id(row) in _SIGHTSEEING_CONTENT_TYPE_IDS:
        return True
    name = str(row.get("name") or "")
    return any(
        k in name
        for k in (
            "한옥마을",
            "문화재",
            "서원",
            "유적",
            "박물관",
            "미술관",
            "기념관",
            "사찰",
            "절",
        )
    )


def place_matches_theme(row: dict, theme: str) -> bool:
    matchers = {
        "food": is_food_place,
        "cafe": is_cafe_place,
        "bakery": is_bakery_place,
        "beach": is_beach_place,
        "baseball": is_baseball_place,
        "soccer": is_soccer_place,
        "culture": lambda r: "박물관" in _place_blob(r) or "미술" in _place_blob(r) or "문화" in _place_blob(r),
        "nature": lambda r: any(k in _place_blob(r) for k in ("자연", "공원", "산", "계곡", "폭포")),
        "shopping": lambda r: any(k in _place_blob(r) for k in ("쇼핑", "시장", "아울렛")),
        "night": lambda r: any(k in _place_blob(r) for k in ("야경", "전망", "야간")),
    }
    fn = matchers.get(theme)
    return bool(fn and fn(row))


def theme_deprioritize_row(row: dict, profile: TripThemeProfile) -> bool:
    """테마 여행인데 전형적인 관광지만 걸릴 때 감점 대상."""
    if not profile.themes:
        return False
    primary = set(profile.themes)
    if primary & {"food", "cafe", "bakery"}:
        return is_major_sightseeing_place(row) and not (
            is_food_place(row) or is_cafe_place(row) or is_bakery_place(row)
        )
    if "beach" in primary:
        blob = _place_blob(row)
        return is_major_sightseeing_place(row) and not is_beach_place(row) and "해변" not in blob
    return False


def apply_row_theme_score_boost(row: dict, profile: TripThemeProfile, base_score: float) -> float:
    boost = 0.0
    for phrase in profile.must_visit:
        if place_matches_must_visit(row, phrase):
            boost += 55.0
            break
    for theme in profile.themes:
        if place_matches_theme(row, theme):
            boost += 38.0
    if theme_deprioritize_row(row, profile):
        boost -= 30.0
    return base_score + boost


def prioritize_ids_for_trip_themes(
    ids: list[int],
    row_by_id: dict[int, dict],
    limit: int,
    profile: TripThemeProfile,
) -> list[int]:
    if not profile.active:
        return ids[: max(1, int(limit))]

    cap = max(1, int(limit))
    out: list[int] = []
    seen: set[int] = set()

    def add(i: int) -> None:
        if i in seen or i not in row_by_id:
            return
        seen.add(i)
        out.append(i)

    for phrase in profile.must_visit:
        for i in ids:
            if place_matches_must_visit(row_by_id[i], phrase):
                add(i)

    for i in ids:
        if any(place_matches_must_visit(row_by_id[i], p) for p in profile.must_visit):
            add(i)

    n_themes = max(1, len(profile.themes))
    share = 0.5 if profile.must_visit else 0.62
    per_theme = max(1, int(cap * share / n_themes))

    for theme in profile.themes:
        n = 0
        for i in ids:
            if n >= per_theme or len(out) >= cap:
                break
            if place_matches_theme(row_by_id[i], theme):
                add(i)
                n += 1

    for i in ids:
        if len(out) >= cap:
            break
        add(i)

    return out[:cap]


def dspy_theme_instruction_lines(profile: TripThemeProfile) -> str:
    if not profile.active:
        return ""
    lines: list[str] = []
    if profile.must_visit:
        joined = ", ".join(profile.must_visit)
        lines.append(
            f"[필수] 사용자가 꼭 가고 싶다고 한 곳({joined})과 이름·요약이 맞는 id를 반드시 포함하세요."
        )
    theme_labels = {
        "food": "맛집·음식점·식당",
        "cafe": "카페·디저트·브런치",
        "bakery": "베이커리·빵집(성심당 등)",
        "beach": "해변·바다·해수욕장",
        "baseball": "야구장·야구 관련 시설",
        "soccer": "축구장·월드컵경기장·챔피언스필드",
        "culture": "박물관·문화시설",
        "nature": "자연·공원",
        "shopping": "쇼핑·시장",
        "night": "야경·전망",
    }
    if profile.themes:
        labels = [theme_labels.get(t, t) for t in profile.themes]
        lines.append(
            f"[필수] 여행 테마는 {', '.join(labels)} 위주입니다. "
            "테마와 무관한 한옥마을·사찰·서원만 나열하지 마세요. "
            "테마에 맞는 장소를 먼저 고르고 관광지는 보조로만 넣으세요."
        )
    return "\n".join(lines)


def intent_mood_from_profile(profile: TripThemeProfile) -> Optional[str]:
    for t in profile.themes:
        mood = THEME_MOOD_MAP.get(t)
        if mood:
            return mood
    return None
