"""
KTO 등 수집 → 정제 → MySQL PLACES 저장.
서버 startup에 연결하지 않음. 수동: python -m app.services.data_pipeline (back 디렉터리에서 PYTHONPATH=.)
"""

from __future__ import annotations

import logging
import re
from typing import Any

from dotenv import load_dotenv

from app.repositories import places_store
from app.repositories.db import session_scope
from app.repositories.regions_repository import (
    _normalize_name_key,
    fetch_kto_regions_for_data_pipeline,
)

logger = logging.getLogger(__name__)

KTO_CONTENT_TYPE_TO_CATEGORY = {
    "12": "관광지",
    "14": "문화시설",
    "15": "축제/공연",
    "28": "레포츠",
    "32": "숙박",
    "38": "쇼핑",
    "39": "음식점",
    "25": "여행코스",
}


def _infer_province_from_address(address: str) -> str | None:
    if not address:
        return None
    addr = str(address).strip()
    for token in (
        "서울특별시",
        "부산광역시",
        "대구광역시",
        "인천광역시",
        "광주광역시",
        "대전광역시",
        "울산광역시",
        "세종특별자치시",
        "제주특별자치도",
        "경기도",
        "강원특별자치도",
        "강원도",
        "충청북도",
        "충청남도",
        "전라북도",
        "전라남도",
        "경상북도",
        "경상남도",
    ):
        if addr.startswith(token) or token in addr[:12]:
            return token.replace("특별자치도", "도").replace("특별시", "").replace("광역시", "")[:4]
    m = re.match(r"^([가-힣]+도|[가-힣]+시)", addr)
    if m:
        return m.group(1)
    return None


def fetch_kto_places(area_codes: list[str] | None = None) -> list[dict]:
    """KTO API 경로를 통한 수집. area_codes는 현재 환경변수 KTO_AREA_CODES를 사용 (인자는 호환용)."""
    _ = area_codes
    return fetch_kto_regions_for_data_pipeline()


def clean_place(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    regions_repository 정규화 dict → PLACES 컬럼 dict.
    이미지 URL 필드는 저장하지 않음.
    """
    name = re.sub(r"\s+", " ", str(raw.get("name", "")).strip())
    if not name:
        return None
    region = re.sub(r"\s+", " ", str(raw.get("region", "")).strip()) or None
    province = re.sub(r"\s+", " ", str(raw.get("province", "")).strip()) or None
    address = re.sub(r"\s+", " ", str(raw.get("address", "")).strip()) or None
    if not address and not region:
        return None

    if not province and address:
        province = _infer_province_from_address(address)

    content_id = str(raw.get("sourceId", "")).strip() or None
    description = str(raw.get("summary", "")).strip() or None
    source = str(raw.get("dataSource", "")).strip() or "KTO"

    ctype = str(raw.get("contentTypeId", "")).strip()
    category = KTO_CONTENT_TYPE_TO_CATEGORY.get(ctype)
    if not category:
        rb = raw.get("recommendedBusinesses")
        if isinstance(rb, list) and rb:
            category = str(rb[0]).strip() or "관광지"
        else:
            category = "관광지"

    lat = raw.get("latitude")
    lng = raw.get("longitude")
    lat_f = float(lat) if lat is not None and str(lat).strip() != "" else None
    lng_f = float(lng) if lng is not None and str(lng).strip() != "" else None

    return {
        "content_id": content_id,
        "name": name,
        "category": category,
        "region": region,
        "province": province,
        "address": address,
        "latitude": lat_f,
        "longitude": lng_f,
        "description": description,
        "source": source,
    }


def deduplicate(places: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for p in places:
        key = f"{_normalize_name_key(p.get('name', ''))}|{_normalize_name_key(p.get('region') or '')}"
        if not key.strip("|"):
            continue
        if key in seen:
            continue
        seen.add(key)
        out.append(p)
    return out


def save_places_to_db(places: list[dict[str, Any]]) -> int:
    if not places:
        return 0
    n = 0
    with session_scope() as session:
        for p in places:
            places_store.upsert_place_from_pipeline_dict(session, p)
            n += 1
    return n


def run_pipeline(sources: list[str] | None = None) -> int:
    sources = sources or ["kto"]
    raw: list[dict[str, Any]] = []
    if "kto" in sources:
        raw.extend(fetch_kto_places([]))

    cleaned: list[dict[str, Any]] = []
    for row in raw:
        c = clean_place(row)
        if c:
            cleaned.append(c)
    deduped = deduplicate(cleaned)
    return save_places_to_db(deduped)


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    load_dotenv()
    n = run_pipeline()
    logger.info("data_pipeline 저장 건수: %s", n)


if __name__ == "__main__":
    main()
