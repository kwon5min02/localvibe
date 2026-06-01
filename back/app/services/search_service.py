"""갤러리 검색: Pinecone + 트렌드·최신성·지역 가중 점수."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Any

from app.repositories import places_store, trends_store
from app.repositories.db import mysql_url_configured, session_scope
from app.repositories.places_store import Place
from app.services import embedding_service
from app.services.trip_themes import (
    detect_trip_theme_profile,
    place_matches_must_visit,
    place_matches_theme,
    theme_deprioritize_row,
)

# 긴 지명을 먼저 두어 '여수시'만 잡고 '여수'는 중복 제거하기 쉽게 합니다.
_LOCALITY_TOKENS: tuple[str, ...] = (
    "서울특별시",
    "부산광역시",
    "대구광역시",
    "인천광역시",
    "광주광역시",
    "대전광역시",
    "울산광역시",
    "세종특별자치시",
    "제주특별자치도",
    "전라남도",
    "전북특별자치도",
    "전라북도",
    "경상남도",
    "경상북도",
    "충청남도",
    "충청북도",
    "강원특별자치도",
    "강원도",
    "경기도",
    "서울",
    "부산",
    "대구",
    "인천",
    "광주",
    "대전",
    "울산",
    "세종",
    "제주",
    "여수시",
    "순천시",
    "목포시",
    "전주시",
    "군산시",
    "김해시",
    "창원시",
    "수원시",
    "성남시",
    "용인시",
    "고양시",
    "부천시",
    "안산시",
    "안양시",
    "남양주시",
    "화성시",
    "평택시",
    "의정부시",
    "파주시",
    "강릉시",
    "속초시",
    "춘천시",
    "평창군",
    "양양군",
    "가평군",
    "양평군",
    "포천시",
    "홍천군",
    "태안군",
    "서산시",
    "여수",
    "순천",
    "목포",
    "전주",
    "군산",
    "남원",
    "담양",
    "보성",
    "구례",
    "하동",
    "해운대",
    "광안리",
    "송도",
    "홍대",
    "명동",
    "강남",
    "이태원",
)


def _use_mysql() -> bool:
    return mysql_url_configured()


def _calc_trend_score(session, place_id: int) -> float:
    """TRENDS 집계를 0~1로 정규화 (스키마에 mentions/growth 없음 → scrap/crawl 가중)."""
    rows = trends_store.list_trends_for_place(session, place_id)
    if not rows:
        return 0.35
    scrap = sum(int(r.scrap_count or 0) for r in rows)
    crawl = sum(int(r.crawling_count or 0) for r in rows)
    mentions_24h = min(1.0, scrap / 50.0)
    growth_7d = 0.5
    crawl_freq = min(1.0, crawl / 20.0)
    return max(0.0, min(1.0, 0.5 * mentions_24h + 0.3 * growth_7d + 0.2 * crawl_freq))


def _calc_recency_score(created_at: datetime | None) -> float:
    if not created_at:
        return 0.4
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    delta = datetime.now(timezone.utc) - created_at
    days = delta.total_seconds() / 86400.0
    if days <= 1:
        return 1.0
    if days <= 7:
        return 0.65
    return 0.35


def _calc_location_score(region: str | None, province: str | None, filter_region: str | None) -> float:
    if not filter_region:
        return 0.7
    fr = filter_region.strip().lower()
    if region and fr in region.lower():
        return 1.0
    if province and fr in province.lower():
        return 0.85
    return 0.2


def _calc_final_score(similarity: float, trend: float, recency: float, location: float) -> float:
    return 0.6 * similarity + 0.25 * trend + 0.1 * recency + 0.05 * location


def _locality_hints_from_query(query: str) -> list[str]:
    """질문 안에 등장하는 알려진 지명 토큰(긴 것 우선, 짧은 것은 상위 토큰에 포함되면 제외)."""
    q = str(query or "").strip()
    if not q:
        return []
    hits: list[str] = []
    for tok in _LOCALITY_TOKENS:
        if tok and tok in q:
            hits.append(tok)
    if not hits:
        return []
    hits.sort(key=len, reverse=True)
    chosen: list[str] = []
    for t in hits:
        if any(t in u and t != u for u in chosen):
            continue
        if any(u in t and u != t for u in chosen):
            continue
        chosen.append(t)
    return chosen


def _place_matches_locality_hints(place: Place, hints: list[str]) -> bool:
    if not hints:
        return False
    blob = " ".join(
        [
            str(place.name or ""),
            str(place.region or ""),
            str(place.province or ""),
            str(place.address or ""),
        ]
    ).lower()
    return any(h.lower() in blob for h in hints)


def search_gallery(query: str, region_filter: str | None) -> list[dict[str, Any]]:
    """
    Pinecone Top-K(20) → 점수 재계산 후 정렬된 place 요약 dict 리스트.
    MySQL/Pinecone 미설정 시 빈 리스트.
    """
    if not _use_mysql() or not embedding_service.pinecone_ready():
        return []

    top_k = int(os.getenv("GALLERY_SEARCH_TOP_K", "20"))
    scored = embedding_service.search_with_scores(query, region_filter, top_k)
    hints = _locality_hints_from_query(query)
    theme_profile = detect_trip_theme_profile(query)

    merged: dict[int, float] = {pid: float(sim) for pid, sim in scored}
    if hints and not region_filter:
        with session_scope() as session:
            extra_ids = places_store.find_place_ids_for_locality_hints(session, hints, limit=120)
        floor_sim = float(os.getenv("GALLERY_LOCALITY_HINT_FLOOR_SIM", "0.48"))
        for pid in extra_ids:
            merged[pid] = max(merged.get(pid, 0.0), floor_sim)

    ranked = sorted(merged.items(), key=lambda x: x[1], reverse=True)
    scan_cap = min(len(ranked), max(top_k * 4, 48))

    locality_boost = float(os.getenv("GALLERY_LOCALITY_HINT_SCORE_BOOST", "0.42"))

    with session_scope() as session:
        out: list[dict[str, Any]] = []
        for place_id, sim in ranked[:scan_cap]:
            p = places_store.get_place_by_id(session, place_id)
            if not p:
                continue
            if os.getenv("GALLERY_REQUIRE_REAL_IMAGE", "1").strip() != "0":
                if not places_store.place_has_real_display_image(session, place_id):
                    continue
            trend = _calc_trend_score(session, place_id)
            rec = _calc_recency_score(p.created_at)
            loc = _calc_location_score(p.region, p.province, region_filter)
            sim_n = max(0.0, min(1.0, (sim + 1.0) / 2.0)) if sim <= 1.0 else max(0.0, min(1.0, sim))
            final = _calc_final_score(sim_n, trend, rec, loc)
            if hints and not region_filter and _place_matches_locality_hints(p, hints):
                final += locality_boost
            if theme_profile.active:
                row_stub = {
                    "name": p.name,
                    "summary": p.description,
                    "category": p.category,
                    "insight_json": p.insight_json,
                    "recommendedBusinesses": [],
                }
                if any(
                    place_matches_must_visit(row_stub, phrase)
                    for phrase in theme_profile.must_visit
                ):
                    final += float(os.getenv("GALLERY_MUST_VISIT_SCORE_BOOST", "0.52"))
                for theme in theme_profile.themes:
                    if place_matches_theme(row_stub, theme):
                        final += float(os.getenv("GALLERY_THEME_SCORE_BOOST", "0.34"))
                        break
                if theme_deprioritize_row(row_stub, theme_profile):
                    final -= float(os.getenv("GALLERY_THEME_DEPRIORITIZE_PENALTY", "0.24"))
            out.append(
                {
                    "place_id": place_id,
                    "name": p.name,
                    "region": p.region,
                    "province": p.province,
                    "category": p.category,
                    "score": final,
                    "similarity": sim,
                    "pinecone_similarity": float(sim),
                }
            )
        out.sort(key=lambda x: x["score"], reverse=True)
        return out
