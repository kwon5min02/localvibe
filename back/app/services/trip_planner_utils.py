"""
여행플래너 일정 구성 유틸리티.

기능:
1) 시간대 슬롯 배분
2) 경로 최적화 (python-tsp 있으면 사용, 없으면 greedy 폴백)
3) 지역 필터 강화
"""

from __future__ import annotations

import json
import logging
import math
from typing import Optional

logger = logging.getLogger(__name__)

_CONTENT_TYPE_TO_SLOTS: dict[str, list[str]] = {
    "12": ["morning", "afternoon"],
    "14": ["morning", "afternoon"],
    "15": ["morning", "afternoon"],
    "25": ["morning", "afternoon"],
    "28": ["morning", "afternoon"],
    "32": [],
    "38": ["afternoon", "lunch"],
    "39": ["lunch", "dinner"],
}

_CATEGORY_TO_SLOTS: dict[str, list[str]] = {
    "관광지": ["morning", "afternoon"],
    "문화시설": ["morning", "afternoon"],
    "레포츠": ["morning", "afternoon"],
    "쇼핑": ["afternoon", "lunch"],
    "숙박": [],
    "음식점": ["lunch", "dinner"],
    "식당": ["lunch", "dinner"],
    "맛집": ["lunch", "dinner"],
    "한식": ["lunch", "dinner"],
    "양식": ["lunch", "dinner"],
    "일식": ["lunch", "dinner"],
    "중식": ["lunch", "dinner"],
    "고기": ["lunch", "dinner"],
    "해산물": ["lunch", "dinner"],
    "분식": ["lunch"],
    "브런치": ["morning", "lunch"],
    "카페": ["cafe_am", "cafe_pm"],
    "디저트": ["cafe_am", "cafe_pm"],
    "베이커리": ["cafe_am", "cafe_pm"],
    "커피": ["cafe_am", "cafe_pm"],
    "박물관": ["morning", "afternoon"],
    "갤러리": ["morning", "afternoon"],
    "전시": ["morning", "afternoon"],
    "역사": ["morning", "afternoon"],
    "공원": ["morning", "afternoon"],
    "자연": ["morning", "afternoon"],
    "해변": ["morning", "afternoon"],
    "산": ["morning", "afternoon"],
    "계곡": ["morning", "afternoon"],
    "체험": ["morning", "afternoon"],
    "액티비티": ["morning", "afternoon"],
    "야경": ["night"],
    "바": ["night"],
    "야시장": ["night"],
}

_DAY_SLOTS: list[tuple[str, int, str]] = [
    ("morning", 1, "오전 관광/자연"),
    ("lunch", 1, "점심 식사"),
    ("cafe_am", 1, "점심 후 카페"),
    ("afternoon", 1, "오후 관광/체험"),
    ("dinner", 1, "저녁 식사"),
    ("night", 0, "야경/바 (선택)"),
]

_SLOT_TIME_LABEL: dict[str, str] = {
    "morning": "09:00~11:00",
    "lunch": "11:30~13:00",
    "cafe_am": "13:00~14:30",
    "afternoon": "15:00~17:00",
    "dinner": "17:30~19:30",
    "night": "19:30~21:00",
}


def _get_place_slots(row: dict) -> list[str]:
    insight = {}
    try:
        insight = json.loads(row.get("insight_json") or "{}")
    except Exception:
        pass
    ct_id = str(insight.get("contentTypeId") or "").strip()
    if ct_id and ct_id in _CONTENT_TYPE_TO_SLOTS:
        slots = _CONTENT_TYPE_TO_SLOTS[ct_id]
        if slots:
            return slots

    category = str(row.get("category") or "").strip()
    if category in _CATEGORY_TO_SLOTS:
        slots = _CATEGORY_TO_SLOTS[category]
        if slots:
            return slots

    rec = row.get("recommendedBusinesses") or []
    for c in rec:
        c_str = str(c).strip()
        if c_str in _CATEGORY_TO_SLOTS:
            return _CATEGORY_TO_SLOTS[c_str]
        for key, slots in _CATEGORY_TO_SLOTS.items():
            if key in c_str:
                return slots

    name = str(row.get("name") or "").lower()
    desc = str(row.get("description") or row.get("summary") or "").lower()
    blob = name + desc
    if any(kw in blob for kw in ["카페", "커피", "브런치", "디저트"]):
        return ["cafe_am", "cafe_pm"]
    if any(kw in blob for kw in ["식당", "맛집", "음식", "갈비", "순대", "쌀밥"]):
        return ["lunch", "dinner"]
    if any(kw in blob for kw in ["야경", "야간", "밤"]):
        return ["night"]
    return ["morning", "afternoon"]


def assign_time_slots(place_ids: list[int], rows: list[dict], days: int) -> list[dict]:
    row_by_id = {int(row["id"]): row for row in rows}
    slot_buckets: dict[str, list[int]] = {slot: [] for slot, _, _ in _DAY_SLOTS}
    unassigned: list[int] = []

    for pid in place_ids:
        row = row_by_id.get(pid)
        if not row:
            continue
        slots = _get_place_slots(row)
        assigned = False
        for slot in slots:
            if slot in slot_buckets:
                slot_buckets[slot].append(pid)
                assigned = True
                break
        if not assigned:
            unassigned.append(pid)

    for pid in unassigned:
        if len(slot_buckets["morning"]) <= len(slot_buckets["afternoon"]):
            slot_buckets["morning"].append(pid)
        else:
            slot_buckets["afternoon"].append(pid)

    schedule: list[dict] = []
    for day in range(1, days + 1):
        for slot_name, max_count, _ in _DAY_SLOTS:
            bucket = slot_buckets[slot_name]
            if not bucket:
                continue
            limit = max_count if max_count > 0 else 1
            for _ in range(limit):
                if not bucket:
                    break
                pid = bucket.pop(0)
                row = row_by_id.get(pid, {})
                schedule.append(
                    {
                        "day": day,
                        "slot": slot_name,
                        "time": _SLOT_TIME_LABEL.get(slot_name, ""),
                        "place_id": pid,
                        "place_name": row.get("name", ""),
                        "category": str((row.get("recommendedBusinesses") or [""])[0]),
                        "latitude": row.get("latitude"),
                        "longitude": row.get("longitude"),
                    }
                )
    return schedule


def schedule_to_ordered_ids(schedule: list[dict]) -> list[int]:
    return [entry["place_id"] for entry in schedule]


def schedule_to_prompt_context(schedule: list[dict]) -> str:
    lines: list[str] = []
    current_day = 0
    for entry in schedule:
        if entry["day"] != current_day:
            current_day = entry["day"]
            lines.append(f"\n[{current_day}일차]")
        lines.append(
            f"  {entry['time']} | {entry['place_name']} ({entry['category']})"
            f" | id={entry['place_id']}"
        )
    return "\n".join(lines)


def _haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _build_distance_matrix(coords: list[tuple[float, float]]) -> list[list[float]]:
    n = len(coords)
    matrix = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            if i != j:
                matrix[i][j] = _haversine_distance(coords[i][0], coords[i][1], coords[j][0], coords[j][1])
    return matrix


def _greedy_tsp(distance_matrix: list[list[float]]) -> list[int]:
    n = len(distance_matrix)
    if n == 0:
        return []
    visited = [False] * n
    path = [0]
    visited[0] = True
    for _ in range(n - 1):
        current = path[-1]
        nearest = -1
        nearest_dist = float("inf")
        for j in range(n):
            if not visited[j] and distance_matrix[current][j] < nearest_dist:
                nearest_dist = distance_matrix[current][j]
                nearest = j
        if nearest == -1:
            break
        path.append(nearest)
        visited[nearest] = True
    return path


def optimize_route_for_day(place_ids: list[int], rows: list[dict]) -> list[int]:
    if len(place_ids) <= 2:
        return place_ids

    row_by_id = {int(row["id"]): row for row in rows}
    coords_map: dict[int, tuple[float, float]] = {}
    for pid in place_ids:
        row = row_by_id.get(pid, {})
        lat = row.get("latitude")
        lng = row.get("longitude")
        if lat is not None and lng is not None:
            try:
                coords_map[pid] = (float(lat), float(lng))
            except (TypeError, ValueError):
                pass
    if len(coords_map) < 2:
        return place_ids

    tsp_ids = [pid for pid in place_ids if pid in coords_map]
    no_coord_ids = [pid for pid in place_ids if pid not in coords_map]
    coords = [coords_map[pid] for pid in tsp_ids]
    distance_matrix = _build_distance_matrix(coords)

    try:
        from python_tsp.distances import great_circle_distance_matrix
        from python_tsp.heuristics import solve_tsp_simulated_annealing
        import numpy as np

        np_coords = np.array(coords)
        dm = great_circle_distance_matrix(np_coords)
        permutation, _ = solve_tsp_simulated_annealing(dm)
        optimized_ids = [tsp_ids[i] for i in permutation]
        logger.info("[TRIP] python-tsp 경로 최적화 완료: %d개 장소", len(optimized_ids))
    except ImportError:
        logger.info("[TRIP] python-tsp 미설치 -> greedy TSP 사용")
        permutation = _greedy_tsp(distance_matrix)
        optimized_ids = [tsp_ids[i] for i in permutation]
    except Exception:
        logger.warning("[TRIP] TSP 최적화 실패 -> 원래 순서 유지")
        optimized_ids = tsp_ids

    return optimized_ids + no_coord_ids


def optimize_route_by_day(schedule: list[dict], rows: list[dict], days: int) -> list[dict]:
    result: list[dict] = []
    for day in range(1, days + 1):
        day_entries = [e for e in schedule if e["day"] == day]
        fixed_slots = {"lunch", "dinner"}
        fixed = [e for e in day_entries if e["slot"] in fixed_slots]
        movable = [e for e in day_entries if e["slot"] not in fixed_slots]

        if movable:
            movable_ids = [e["place_id"] for e in movable]
            optimized_ids = optimize_route_for_day(movable_ids, rows)
            id_to_entry = {e["place_id"]: e for e in movable}
            movable = [id_to_entry[pid] for pid in optimized_ids if pid in id_to_entry]

        slot_order = [s for s, _, _ in _DAY_SLOTS]
        day_merged = fixed + movable
        day_merged.sort(key=lambda e: slot_order.index(e["slot"]) if e["slot"] in slot_order else 99)
        result.extend(day_merged)
    return result


def _matches_geo_filter(row: dict, reg_f: Optional[str], prov_f: Optional[str]) -> bool:
    if prov_f and str(row.get("province") or "").strip() != prov_f:
        return False
    if reg_f:
        rr = str(row.get("region") or "").strip()
        if rr == reg_f:
            return True
        blob = " ".join(
            [rr, str(row.get("address") or ""), str(row.get("name") or ""), str(row.get("summary") or "")[:80]]
        )
        return reg_f in blob
    return True


def filter_by_geo_strict(
    place_ids: list[int],
    row_by_id: dict[int, dict],
    reg_f: Optional[str],
    prov_f: Optional[str],
    rows: list[dict],
) -> list[int]:
    if not reg_f and not prov_f:
        return place_ids
    filtered = [pid for pid in place_ids if pid in row_by_id and _matches_geo_filter(row_by_id[pid], reg_f, prov_f)]
    removed = len(place_ids) - len(filtered)
    if removed > 0:
        logger.info("[TRIP] 지역 필터 강화: %d개 제거 (reg=%s, prov=%s)", removed, reg_f, prov_f)

    if len(filtered) < 3:
        filtered_set = set(filtered)
        geo_rows = [r for r in rows if _matches_geo_filter(r, reg_f, prov_f) and int(r["id"]) not in filtered_set]
        extra = [int(r["id"]) for r in geo_rows[: 10 - len(filtered)]]
        filtered = filtered + extra
        logger.info("[TRIP] 지역 필터 후 부족 -> %d개 보충", len(extra))
    return filtered


def build_trip_schedule(
    place_ids: list[int],
    rows: list[dict],
    days: int,
    reg_f: Optional[str] = None,
    prov_f: Optional[str] = None,
    row_by_id: Optional[dict[int, dict]] = None,
) -> tuple[list[int], str]:
    if row_by_id is None:
        row_by_id = {int(r["id"]): r for r in rows}

    if reg_f or prov_f:
        place_ids = filter_by_geo_strict(place_ids, row_by_id, reg_f, prov_f, rows)
    if not place_ids:
        return [], ""

    schedule = assign_time_slots(place_ids, rows, days)
    schedule = optimize_route_by_day(schedule, rows, days)
    ordered_ids = schedule_to_ordered_ids(schedule)
    schedule_ctx = schedule_to_prompt_context(schedule)
    return ordered_ids, schedule_ctx
