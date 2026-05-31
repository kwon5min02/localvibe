"""
갤러리·트립 플래너 공통 추천 코어.

- Pinecone 하이브리드 후보 수집
- _build_recommendation_ids 재랭킹
- DSPy 최종 선택 (갤러리 모듈 재사용)
"""

from __future__ import annotations

import logging
import os
from typing import Callable, Optional

from app.services import embedding_service
from app.services.dspy_recommender import run_dspy_gallery_search
from app.services.place_preferences import (
    detect_exclusion_tags,
    detect_trip_theme_profile,
    dspy_theme_instruction_lines,
    filter_ids_by_exclusions,
    filter_rows_by_exclusions,
    prioritize_ids_for_trip_themes,
    theme_boosted_search_query,
)
from app.services.trip_themes import TripThemeProfile

logger = logging.getLogger(__name__)

CHAT_PINECONE_TOP_K = int(os.getenv("CHAT_PINECONE_TOP_K", "30"))
CHAT_PINECONE_MIN_RESULTS = int(os.getenv("CHAT_PINECONE_MIN_RESULTS", "5"))
FEED_TOP_K = 9


def gallery_search_place_ids(
    query: str,
    region_filter: Optional[str] = None,
    *,
    limit: int = 24,
) -> list[int]:
    """
    메인 갤러리 검색창과 동일한 /api/search 파이프라인(place_id 순위).
    트립·채팅 후보의 시맨틱 1차 소스로 재사용합니다.
    """
    raw = str(query or "").strip()
    profile = detect_trip_theme_profile(raw)
    q = theme_boosted_search_query(raw, profile)
    if not q:
        return []
    try:
        from app.services.search_service import search_gallery

        hits = search_gallery(q, region_filter)
    except Exception:
        logger.exception("[RECOMMEND] search_gallery failed")
        return []
    out: list[int] = []
    for row in hits:
        try:
            pid = int(row.get("place_id"))
        except (TypeError, ValueError):
            continue
        if pid not in out:
            out.append(pid)
        if len(out) >= max(1, int(limit)):
            break
    return out


def _merge_id_lists(*lists: list[int], cap: int) -> list[int]:
    merged: list[int] = []
    seen: set[int] = set()
    for lst in lists:
        for iid in lst:
            if iid in seen:
                continue
            seen.add(iid)
            merged.append(iid)
            if len(merged) >= cap:
                return merged
    return merged


def select_ids_with_dspy(
    user_message: str,
    candidate_ids: list[int],
    row_by_id: dict[int, dict],
    limit: int,
) -> tuple[list[int], str]:
    """후보 id 목록에서 DSPy로 최종 선택. 실패 시 ([], '')."""
    exclusion_tags = detect_exclusion_tags(user_message)
    filtered_ids = filter_ids_by_exclusions(candidate_ids, row_by_id, exclusion_tags)
    candidate_rows = [row_by_id[i] for i in filtered_ids if i in row_by_id]
    candidate_rows = filter_rows_by_exclusions(candidate_rows, exclusion_tags)
    place_lines: list[str] = []
    for row in candidate_rows:
        place_lines.append(
            f"- id={row['id']} / 이름={row.get('name','')} / 지역={row.get('region','')}/{row.get('province','')} "
            f"/ 유형={row.get('category','')} / 요약={str(row.get('summary',''))[:140]}"
        )
    dspy_query = user_message
    theme_lines = dspy_theme_instruction_lines(detect_trip_theme_profile(user_message))
    if theme_lines:
        dspy_query += f"\n{theme_lines}"
    if exclusion_tags:
        if "temple" in exclusion_tags:
            dspy_query += "\n[필수] 사찰·절·암·종교시설은 추천하지 마세요. 후보 목록에 있어도 id에 넣지 마세요."
    dspy_result = run_dspy_gallery_search(dspy_query, "\n".join(place_lines))
    dspy_ids_raw = (
        dspy_result.get("recommendedRegionIds", []) if isinstance(dspy_result, dict) else []
    )
    dspy_ids = [
        int(i)
        for i in dspy_ids_raw
        if isinstance(i, int) or (isinstance(i, str) and str(i).isdigit())
    ]
    dspy_answer = dspy_result.get("answer", "").strip() if isinstance(dspy_result, dict) else ""
    if dspy_ids:
        out = filter_ids_by_exclusions(dspy_ids[: max(1, int(limit))], row_by_id, exclusion_tags)
        logger.info("[DSPY] 최종 선택 반영 %d곳 (limit=%d)", len(out), limit)
        return out, dspy_answer
    if os.getenv("USE_DSPY_GALLERY", "false").strip().lower() in {"1", "true", "y", "yes", "on"}:
        logger.info("[DSPY] id 없음 — Pinecone/baseline 순위 사용 (후보 %d곳)", len(candidate_ids))
    return [], ""


def build_gallery_baseline_ids(
    user_message: str,
    rows: list[dict],
    row_by_id: dict[int, dict],
    intent: Optional[dict],
    limit: int,
    detect_filters: Callable[[str, list[dict]], tuple[Optional[str], Optional[str]]],
    build_recommendation_ids: Callable[..., list[int]],
) -> list[int]:
    """메인 갤러리용: 갤러리 검색(/api/search) + Pinecone + 재랭킹."""
    reg_f, prov_f = detect_filters(user_message, rows)
    region_filter = reg_f or prov_f
    search_ids = [
        i
        for i in gallery_search_place_ids(
            user_message, region_filter, limit=max(limit * 2, 16)
        )
        if i in row_by_id
    ]

    baseline_ids: list[int] = []
    if embedding_service.pinecone_ready():
        try:
            pinecone_ids = embedding_service.search(
                user_message,
                region_filter=reg_f,
                top_k=CHAT_PINECONE_TOP_K,
                province_filter=prov_f,
            )
        except Exception:
            logger.exception("[RECOMMEND] pinecone search failed (gallery)")
            pinecone_ids = []
        pinecone_rows = [row_by_id[int(i)] for i in pinecone_ids if int(i) in row_by_id]
        if pinecone_rows:
            baseline_ids = build_recommendation_ids(
                user_message, pinecone_rows, limit, intent=intent
            )
        if len(baseline_ids) < CHAT_PINECONE_MIN_RESULTS:
            extra = build_recommendation_ids(user_message, rows, limit, intent=intent)
            for eid in extra:
                if eid not in baseline_ids:
                    baseline_ids.append(eid)
                if len(baseline_ids) >= limit:
                    break
    else:
        baseline_ids = build_recommendation_ids(user_message, rows, limit, intent=intent)

    if search_ids:
        baseline_ids = _merge_id_lists(search_ids, baseline_ids, cap=max(limit, len(baseline_ids) or limit))
    return baseline_ids


def build_trip_baseline_ids(
    user_message: str,
    rows: list[dict],
    row_by_id: dict[int, dict],
    intent: dict,
    reg_f: Optional[str],
    prov_f: Optional[str],
    candidate_limit: int,
    current_ids_set: set[int],
    row_matches_geo: Callable[[dict, Optional[str], Optional[str]], bool],
    build_recommendation_ids: Callable[..., list[int]],
) -> list[int]:
    """트립 플래너용: 갤러리 검색 + Pinecone + 지명 스코어 + 지역 필터."""
    region_filter = reg_f or prov_f
    search_cap = max(candidate_limit * 2, 16)
    gallery_ids = [
        i
        for i in gallery_search_place_ids(
            user_message, region_filter, limit=search_cap
        )
        if i not in current_ids_set and i in row_by_id
    ]
    if reg_f or prov_f:
        gallery_ids = [
            i
            for i in gallery_ids
            if row_matches_geo(row_by_id[i], reg_f, prov_f)
        ]

    baseline_ids: list[int] = []
    min_semantic = max(
        CHAT_PINECONE_MIN_RESULTS,
        min(candidate_limit, max(3, candidate_limit // 2 + 1)),
    )

    def pool_for_fallback() -> list[dict]:
        if reg_f or prov_f:
            geo_rows = [r for r in rows if row_matches_geo(r, reg_f, prov_f)]
            if geo_rows:
                return geo_rows
        return rows

    if embedding_service.pinecone_ready():
        top_k = max(CHAT_PINECONE_TOP_K, candidate_limit * 3, 24)
        pinecone_ids: list[int] = []
        try:
            pinecone_ids = embedding_service.search(
                user_message,
                region_filter=reg_f,
                top_k=top_k,
                province_filter=prov_f,
            )
        except Exception:
            logger.exception("[RECOMMEND] pinecone search failed (trip)")
            pinecone_ids = []
        pinecone_rows: list[dict] = []
        for raw in pinecone_ids:
            try:
                pid = int(raw)
            except (TypeError, ValueError):
                continue
            if pid in row_by_id and pid not in current_ids_set:
                pinecone_rows.append(row_by_id[pid])
        if pinecone_rows:
            baseline_ids = build_recommendation_ids(
                user_message,
                pinecone_rows,
                candidate_limit,
                intent=intent,
            )
            baseline_ids = [i for i in baseline_ids if i not in current_ids_set]
        if len(baseline_ids) < min_semantic:
            pool = pool_for_fallback()
            extra = build_recommendation_ids(
                user_message,
                pool,
                candidate_limit,
                intent=intent,
            )
            for eid in extra:
                if (
                    eid not in baseline_ids
                    and eid not in current_ids_set
                    and eid in row_by_id
                ):
                    baseline_ids.append(eid)
                if len(baseline_ids) >= candidate_limit:
                    break
    else:
        pool = pool_for_fallback()
        baseline_ids = build_recommendation_ids(
            user_message,
            pool,
            candidate_limit,
            intent=intent,
        )
        baseline_ids = [i for i in baseline_ids if i not in current_ids_set]

    pool_lex = pool_for_fallback()
    lex_cap = max(candidate_limit, 12)
    lexical_ids = build_recommendation_ids(
        user_message,
        pool_lex,
        lex_cap,
        intent=intent,
    )
    lexical_ids = [i for i in lexical_ids if i not in current_ids_set and i in row_by_id]
    merged_ids = _merge_id_lists(
        gallery_ids,
        lexical_ids,
        baseline_ids,
        cap=candidate_limit,
    )
    if merged_ids:
        baseline_ids = merged_ids

    if reg_f or prov_f:
        geo_ids = [
            i
            for i in baseline_ids
            if i in row_by_id and row_matches_geo(row_by_id[i], reg_f, prov_f)
        ]
        if geo_ids:
            baseline_ids = geo_ids
        else:
            geo_rows = [r for r in rows if row_matches_geo(r, reg_f, prov_f)]
            if geo_rows:
                baseline_ids = build_recommendation_ids(
                    user_message,
                    geo_rows,
                    candidate_limit,
                    intent=intent,
                )
                baseline_ids = [i for i in baseline_ids if i not in current_ids_set]
            else:
                baseline_ids = []

    return baseline_ids


def apply_trip_theme_priority(
    ids: list[int],
    row_by_id: dict[int, dict],
    user_message: str,
    intent: Optional[dict],
    limit: int,
) -> list[int]:
    profile = _theme_profile_from_intent(user_message, intent)
    if profile.active:
        return prioritize_ids_for_trip_themes(ids, row_by_id, limit, profile)
    return ids[: max(1, int(limit))]


def _theme_profile_from_intent(
    user_message: str, intent: Optional[dict]
) -> TripThemeProfile:
    themes = list((intent or {}).get("themes") or [])
    must_visit = list((intent or {}).get("mustVisit") or [])
    if themes or must_visit:
        return TripThemeProfile(themes=themes, must_visit=must_visit)
    return detect_trip_theme_profile(user_message)


def schedule_entries_for_api(schedule: list[dict]) -> list[dict]:
    """프론트용 schedule 배열 (camelCase)."""
    if not schedule:
        return []
    out: list[dict] = []
    for entry in schedule:
        try:
            place_id = int(entry.get("place_id"))
        except (TypeError, ValueError):
            continue
        out.append(
            {
                "day": int(entry.get("day") or 1),
                "slot": str(entry.get("slot") or ""),
                "time": str(entry.get("time") or ""),
                "placeId": place_id,
                "placeName": str(entry.get("place_name") or ""),
                "category": str(entry.get("category") or ""),
            }
        )
    return out
