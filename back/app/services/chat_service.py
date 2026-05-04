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
    user_message: str, rows: list[dict], size: int = FEED_TOP_K
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
        scored.append((region_id, score, name, row))
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


def get_chat_result(user_message: str) -> dict:
    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    scope_notice = _out_of_scope_notice(user_message)
    valid_region_ids = {int(row["id"]) for row in rows}
    ranked_ids = _score_regions(user_message)
    baseline_ids = _build_recommendation_ids(user_message, rows, FEED_TOP_K)
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
    system_prompt = (
        "당신은 LocalVibe 추천 도우미입니다. "
        "질문에 짧게 답하고, 반드시 recommendedRegionIds를 9개 반환하세요."
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
                        "데이터 목록:\n"
                        f"{region_context}\n\n"
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
        # UI와 채팅 텍스트가 동일한 추천 집합을 보도록 항상 IDs 기준 문구를 사용합니다.
        answer = _standard_answer_from_ids(ids, rows)
        if scope_notice:
            answer = f"{scope_notice}\n{answer}"
        return {"answer": answer, "recommendedRegionIds": ids}
    except Exception:
        fallback = _standard_answer_from_ids(recommended_ids, rows)
        answer = f"{scope_notice}\n{fallback}" if scope_notice else fallback
        return {"answer": answer, "recommendedRegionIds": recommended_ids}


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

    baseline_ids = _build_recommendation_ids(user_message, rows, candidate_limit)
    # 현재 로드맵에 이미 있는 것들 제외
    baseline_ids = [id for id in baseline_ids if id not in current_ids_set]

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
    region_context = _build_region_context()
    nights = trip_duration.get("nights", 0)
    system_prompt = (
        "당신은 LocalVibe 여행 계획 도우미입니다. "
        f"사용자는 {nights}박 {days}일 여행을 계획 중입니다. "
        f"최대 {max_locations}개 장소를 추천할 수 있습니다. "
        "질문에 친절하고 구체적으로 답하세요. "
        "응답은 반드시 json 객체 한 개로만 반환하세요."
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
                        "데이터 목록:\n"
                        f"{region_context}\n\n"
                        "다음 json 형식으로 답하세요: "
                        f'{{"answer":"...", "recommendedRegionIds":[id1,id2,...,max {max_locations}개]}}\n'
                        f"질문: {user_message}"
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        _llm_answer = parsed.get("answer") or "추천 장소를 찾았습니다."
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
        answer = _trip_answer_from_ids(ids, rows)

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
