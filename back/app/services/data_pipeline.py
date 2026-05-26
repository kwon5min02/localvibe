"""
KTO 등 수집 → 정제 → MySQL PLACES 저장 (배치 전용).
API 서버 요청 경로와 분리: 운영 시 `LV_REGIONS_SKIP_EXTERNAL_FETCH=1` 로 런타임 KTO 수집을 끄고,
주기적으로 본 모듈 또는 `scripts/sync_kto_places.py` 로 DB를 채운 뒤, 이미지는
`GET /api/regions/{id}/kto-images` 로 온디맨드 조회합니다.

실행: cd back && PYTHONPATH=. python -m app.services.data_pipeline

규모: 지역별·키워드별 목록 호출 시 `pageNo` 를 올려 `KTO_MAX_ITEMS` 까지 수집
(예: 트래픽·totalCount·중복 때문에 그만큼 못 채우면 더 적을 수 있음).

동일 적재 후 검색 인덱스까지 한 번에: `PYTHONPATH=. python scripts/sync_kto_places.py`
(MySQL만 할 때는 `sync_kto_places.py --db-only`)
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

# PLACES 비적재 타입(KTO 목록 단계에서도 regions_repository 에서 필터링됨 — 이중 방어)
KTO_PIPELINE_SKIP_CONTENTTYPE_IDS = frozenset({"15", "25"})


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
    KTO 대표 이미지 URL은 insight_json(ktoImageUrl)로만 저장합니다.
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

    ctype = str(raw.get("contentTypeId", "") or "").strip()
    if ctype in KTO_PIPELINE_SKIP_CONTENTTYPE_IDS:
        return None
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

    from app.services.media_utils import sanitize_display_image_url

    kto_img = sanitize_display_image_url(
        places_store._normalize_https_image_url(raw.get("imageUrl"))
    )

    return {
        "content_id": content_id,
        "content_type_id": ctype or None,
        "name": name,
        "category": category,
        "region": region,
        "province": province,
        "address": address,
        "latitude": lat_f,
        "longitude": lng_f,
        "description": description,
        "source": source,
        "kto_image_url": kto_img or None,
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
