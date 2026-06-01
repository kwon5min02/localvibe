"""행정구역 정식 명칭 정규화 (강원도→강원특별자치도, 전라북도→전북특별자치도 등)."""

from __future__ import annotations

# DB·표시·필터에 쓸 정식 명칭
PROVINCE_CANONICAL: dict[str, str] = {
    "강원": "강원특별자치도",
    "강원도": "강원특별자치도",
    "강원특별자치": "강원특별자치도",
    "강원특별자치도": "강원특별자치도",
    "전북": "전북특별자치도",
    "전라북": "전북특별자치도",
    "전라북도": "전북특별자치도",
    "전북특별자치": "전북특별자치도",
    "전북특별자치도": "전북특별자치도",
    "제주": "제주특별자치도",
    "제주도": "제주특별자치도",
    "제주특별자치도": "제주특별자치도",
}

# 필터·SQL LIKE용 — 정식명 + 구 명칭·약칭
PROVINCE_MATCH_ALIASES: dict[str, tuple[str, ...]] = {
    "강원특별자치도": ("강원특별자치도", "강원도", "강원특별자치"),
    "강원": ("강원특별자치도", "강원도", "강원특별자치"),
    "전북특별자치도": ("전북특별자치도", "전라북도", "전북특별자치", "전라북"),
    "전북": ("전북특별자치도", "전라북도", "전북특별자치", "전라북"),
}

GANGWON_CITY_LABELS: frozenset[str] = frozenset(
    {"강릉", "춘천", "원주", "속초", "평창", "양양", "동해", "삼척", "태백", "홍천"}
)

JEONBUK_CITY_LABELS: frozenset[str] = frozenset(
    {"전주", "군산", "익산", "남원", "김제", "정읍", "완주", "무주", "진안", "장수"}
)

# 사이드바·필터 라벨 → 특별자치도 정식명
_LOCALITY_TO_SPECIAL_PROVINCE: dict[str, str] = {
    "강원": "강원특별자치도",
    "강원특별자치도": "강원특별자치도",
    "전북": "전북특별자치도",
    "전북특별자치도": "전북특별자치도",
}


def canonical_province(value: str | None) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    compact = raw.replace(" ", "")
    if compact in PROVINCE_CANONICAL:
        return PROVINCE_CANONICAL[compact]
    for key, canon in PROVINCE_CANONICAL.items():
        if key in compact or compact in key:
            return canon
    return raw


def province_tokens_for_filter(label: str) -> tuple[str, ...]:
    key = str(label or "").strip()
    if key in PROVINCE_MATCH_ALIASES:
        return PROVINCE_MATCH_ALIASES[key]
    canon = canonical_province(key)
    if canon and canon in PROVINCE_MATCH_ALIASES:
        return PROVINCE_MATCH_ALIASES[canon]
    if canon:
        return (canon,)
    return (key,) if key else ()


def special_province_canon_for_locality(label: str) -> str | None:
    """시·도 사이드바 라벨이 속한 특별자치도 (없으면 None)."""
    key = str(label or "").strip()
    if key in _LOCALITY_TO_SPECIAL_PROVINCE:
        return _LOCALITY_TO_SPECIAL_PROVINCE[key]
    if key in GANGWON_CITY_LABELS:
        return "강원특별자치도"
    if key in JEONBUK_CITY_LABELS:
        return "전북특별자치도"
    return None


def matches_special_province_city(
    *,
    label: str,
    region: str | None,
    province: str | None,
    address: str | None,
    address_tokens: tuple[str, ...],
) -> bool:
    """특별자치도 소재 시·군 — province/주소에 정식·구 명칭 + 시·군 일치."""
    canon = special_province_canon_for_locality(label)
    if not canon or label in _LOCALITY_TO_SPECIAL_PROVINCE:
        return False

    def _compact(s: str | None) -> str:
        return str(s or "").replace(" ", "").strip()

    addr = _compact(address)
    prov = _compact(province)
    reg = str(region or "").strip()
    base = label.replace("시", "").replace("군", "").strip()

    prov_ok = any(_compact(t) in prov or _compact(t) in addr for t in province_tokens_for_filter(canon))
    if not prov_ok:
        return False

    city_ok = reg in (label, base, f"{base}시") or any(
        _compact(t) in addr for t in address_tokens
    )
    return city_ok


def canonical_province_from_address_token(token: str) -> str:
    """주소에서 추출한 도·시 문자열 → DB province 정식명."""
    return canonical_province(token) or str(token or "").strip()
