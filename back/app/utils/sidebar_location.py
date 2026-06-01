"""사이드바 지역 클릭 — 장소명이 아닌 주소·region·province만으로 위치 매칭."""

from __future__ import annotations

from typing import TYPE_CHECKING

from app.utils.province_names import matches_special_province_city, province_tokens_for_filter

if TYPE_CHECKING:
    from app.repositories.places_store import Place

# 시·군 단위: 주소에 행정구역 토큰이 있어야 함 (이름의 '강릉국밥' 등 제외)
_SIDEBAR_CITY_ADDRESS_TOKENS: dict[str, tuple[str, ...]] = {
    "서울": ("서울특별시", "서울시"),
    "인천": ("인천광역시", "인천시"),
    "강릉": ("강릉시", "강릉군"),
    "춘천": ("춘천시",),
    "원주": ("원주시",),
    "속초": ("속초시",),
    "대전": ("대전광역시", "대전시"),
    "청주": ("청주시",),
    "천안": ("천안시",),
    "충주": ("충주시",),
    "광주": ("광주광역시", "광주시"),
    "전주": ("전주시",),
    "군산": ("군산시",),
    "익산": ("익산시",),
    "남원": ("남원시",),
    "여수": ("여수시",),
    "순천": ("순천시",),
    "목포": ("목포시",),
    "부산": ("부산광역시", "부산시"),
    "대구": ("대구광역시", "대구시"),
    "경주": ("경주시",),
    "울산": ("울산광역시", "울산시"),
    "포항": ("포항시",),
    "제주시": ("제주시",),
    "서귀포": ("서귀포시",),
}

# 도 단위 (사이드바 '경기', '강원특별자치도' 등)
_SIDEBAR_PROVINCE_TOKENS: dict[str, tuple[str, ...]] = {
    "경기": ("경기도",),
    "강원": province_tokens_for_filter("강원"),
    "강원특별자치도": province_tokens_for_filter("강원특별자치도"),
    "전북": province_tokens_for_filter("전북"),
    "전북특별자치도": province_tokens_for_filter("전북특별자치도"),
}


def _compact(s: str | None) -> str:
    return str(s or "").replace(" ", "").strip()


def address_tokens_for_locality(locality: str) -> tuple[str, ...]:
    label = str(locality or "").strip()
    if label in _SIDEBAR_PROVINCE_TOKENS:
        return _SIDEBAR_PROVINCE_TOKENS[label]
    if label in _SIDEBAR_CITY_ADDRESS_TOKENS:
        return _SIDEBAR_CITY_ADDRESS_TOKENS[label]
    base = label.replace("시", "").replace("군", "").strip()
    if not base:
        return ()
    out: list[str] = []
    if label.endswith("시") or label.endswith("군"):
        out.append(label)
    out.extend([f"{base}시", f"{base}군"])
    return tuple(dict.fromkeys(out))


def place_matches_sidebar_locality(
    *,
    region: str | None,
    province: str | None,
    address: str | None,
    locality: str,
) -> bool:
    """장소명(name)은 보지 않고, 실제 소재지만 판별."""
    label = str(locality or "").strip()
    if len(label) < 2:
        return False

    addr = _compact(address)
    reg = str(region or "").strip()
    prov = _compact(province)

    if label in _SIDEBAR_PROVINCE_TOKENS:
        for tok in _SIDEBAR_PROVINCE_TOKENS[label]:
            tok_c = _compact(tok)
            if tok_c and (tok_c in prov or tok_c in addr):
                return True
        return False

    if label == "제주시":
        if "서귀포시" in addr and "제주시" not in addr:
            return False
        if "제주시" in addr or "제주특별자치도" in (address or ""):
            return True
        return reg in ("제주", "제주시")

    if label == "서귀포":
        return "서귀포시" in addr or reg in ("서귀포", "서귀포시")

    tokens = address_tokens_for_locality(label)
    for tok in tokens:
        if _compact(tok) in addr:
            return True

    base = label.replace("시", "").replace("군", "").strip()
    if reg in (label, base, f"{base}시", f"{base}군"):
        return True

    if matches_special_province_city(
        label=label,
        region=region,
        province=province,
        address=address,
        address_tokens=tokens,
    ):
        return True

    return False


def place_row_matches_sidebar_locality(place: Place, locality: str) -> bool:
    return place_matches_sidebar_locality(
        region=place.region,
        province=place.province,
        address=place.address,
        locality=locality,
    )
