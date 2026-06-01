from fastapi import HTTPException

from app.repositories import get_region_by_id, load_regions, places_store
from app.repositories.db import session_scope
from app.repositories.regions_store import update_region_coordinates_in_db, update_region_summary_short_in_db
from app.schemas import Region, RegionInsight
from app.services.geocode_service import geocode_address_with_kakao
from app.services.kto_image_service import fetch_detail_image_urls
from app.services.summary_service import summarize_korean_text


KTO_CONTENT_TYPE_LABELS = {
    "12": "관광지",
    "14": "문화시설",
    "15": "축제/공연",
    "25": "여행코스",
    "28": "레포츠",
    "32": "숙박",
    "38": "쇼핑",
    "39": "음식점",
}


def _fill_missing_insight_fields(row: dict) -> dict:
    enriched = dict(row)
    source = str(enriched.get("dataSource") or "")
    if "한국관광공사" not in source:
        return enriched

    name = str(enriched.get("name") or "")
    summary = str(enriched.get("summary") or "")
    text = f"{name} {summary}".lower()

    current_recommended = enriched.get("recommendedBusinesses") or []
    if isinstance(current_recommended, list):
        normalized_recommended: list[str] = []
        for item in current_recommended:
            value = str(item).strip()
            normalized_recommended.append(KTO_CONTENT_TYPE_LABELS.get(value, value))
        enriched["recommendedBusinesses"] = [value for value in normalized_recommended if value]

    if not enriched.get("recommendedBusinesses"):
        rec = ["로컬 관광"]
        if any(keyword in text for keyword in ["카페", "커피", "디저트"]):
            rec.append("카페/디저트")
        if any(keyword in text for keyword in ["맛집", "식당", "음식"]):
            rec.append("식음료")
        if any(keyword in text for keyword in ["바다", "해변", "야경", "오션"]):
            rec.append("경관/야경")
        enriched["recommendedBusinesses"] = list(dict.fromkeys(rec))

    if not enriched.get("busyHours"):
        if any(keyword in text for keyword in ["식당", "맛집", "카페", "디저트"]):
            enriched["busyHours"] = ["12:00-14:00", "18:00-20:00"]
        else:
            enriched["busyHours"] = ["주말 13:00-17:00"]

    if not enriched.get("targetCustomers"):
        targets = ["로컬 여행객", "당일 방문객"]
        if any(keyword in text for keyword in ["가족", "키즈", "아이"]):
            targets.append("가족 단위 고객")
        if any(keyword in text for keyword in ["커플", "데이트", "야경"]):
            targets.append("커플/친구 방문객")
        enriched["targetCustomers"] = list(dict.fromkeys(targets))

    if not summary or summary == "정보를 제공 받을 수 없습니다.":
        address = str(enriched.get("address") or "").strip()
        enriched["summary"] = f"한국관광공사 공개데이터 기반 장소 정보입니다. (주소: {address})" if address else "한국관광공사 공개데이터 기반 장소 정보입니다."

    return enriched


def _region_from_row(row: dict) -> Region:
    return Region(
        id=row["id"],
        name=row["name"],
        imageUrl=row["imageUrl"],
        summary=row["summary"],
        summaryShort=row.get("summaryShort"),
        address=row.get("address"),
        latitude=row.get("latitude"),
        longitude=row.get("longitude"),
        region=row.get("region"),
        province=row.get("province"),
        sourceId=row.get("sourceId"),
        dataSource=row.get("dataSource"),
        contentTypeId=row.get("contentTypeId"),
    )


def list_regions() -> list[Region]:
    region_rows = load_regions()
    return [_region_from_row(row) for row in region_rows]


def list_regions_in_location(locality: str, *, limit: int = 120) -> list[Region]:
    """사이드바 지역 클릭 — 주소·행정구역 기준 장소 목록 (이름 매칭 없음)."""
    label = str(locality or "").strip()
    if len(label) < 2:
        return []
    with session_scope() as session:
        ids = places_store.find_place_ids_by_location_locality(session, label, limit=limit)
        rows: list[dict] = []
        for pid in ids:
            d = places_store.get_as_region_dict(session, pid)
            if d:
                rows.append(_fill_missing_insight_fields(d))
    return [_region_from_row(row) for row in rows]


def get_region_insight(region_id: int) -> RegionInsight:
    matched = get_region_by_id(region_id)
    if not matched:
        raise HTTPException(status_code=404, detail="Region not found")

    enriched = _fill_missing_insight_fields(matched)
    summary_short = str(enriched.get("summaryShort") or "").strip()
    if not summary_short:
        summary_short = summarize_korean_text(str(enriched.get("summary") or ""), max_len=100)
        enriched["summaryShort"] = summary_short
        if summary_short:
            try:
                update_region_summary_short_in_db(int(enriched["id"]), summary_short)
            except Exception:
                pass

    latitude = enriched.get("latitude")
    longitude = enriched.get("longitude")
    if (latitude is None or longitude is None) and str(enriched.get("address") or "").strip():
        coords = geocode_address_with_kakao(str(enriched.get("address") or ""))
        if coords:
            lat, lng = coords
            enriched["latitude"] = lat
            enriched["longitude"] = lng
            try:
                update_region_coordinates_in_db(int(enriched["id"]), lat, lng)
            except Exception:
                pass

    return RegionInsight(**enriched)


def list_region_kto_image_urls(region_id: int) -> list[str]:
    """DB의 content_id(+contentTypeId)로 KTO detailImage2 호출. URL은 DB에 저장하지 않음."""
    with session_scope() as session:
        cid, ctype = places_store.get_kto_image_ids_for_place(session, region_id)
    if not cid:
        raise HTTPException(status_code=404, detail="Region not found or missing KTO content id")
    return fetch_detail_image_urls(cid, ctype or None)
