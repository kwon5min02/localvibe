import json
import os
import random
import re
from typing import Optional

from dotenv import load_dotenv
from openai import OpenAI

from app.repositories import load_regions

load_dotenv()
FEED_TOP_K = 9
DAY_TRIP_KEYWORDS = {"당일", "당일치기", "원데이", "하루"}
BROAD_REGION_HINTS = {"광주", "전남"}
OUT_OF_SCOPE_REGION_KEYWORDS = {"전북", "군산", "남원", "전주", "익산", "김제", "완주"}
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
    "당일",
    "당일치기",
    "원데이",
    "하루",
}
REGION_HINTS = {
    "광주": {"광주", "광주광역시"},
    "전남": {"전남", "전라남도"},
    "여수": {"여수"},
    "순천": {"순천"},
    "목포": {"목포"},
    "담양": {"담양"},
    "신안": {"신안"},
    "나주": {"나주"},
    "광양": {"광양"},
    "해남": {"해남"},
}
SOURCE_WEIGHT_KEYWORDS = {
    "한국관광공사": 3,
    "전라남도_남도여행길잡이": 2,
}
LOCALITY_SUFFIXES = ("동", "읍", "면", "리", "구", "시", "군")


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
    picked = [row_map[region_id]["name"] for region_id in ranked_ids[:FEED_TOP_K] if region_id in row_map]
    if not picked:
        return "요청하신 조건과 유사한 정보를 찾지 못했습니다."
    return f"요청하신 내용과 관련해 총 {len(picked)}곳을 추천합니다: {', '.join(picked)}"


def _standard_answer_from_ids(region_ids: list[int], rows: list[dict]) -> str:
    row_map = {int(row["id"]): row for row in rows}
    picked = [str(row_map[region_id]["name"]) for region_id in region_ids[:FEED_TOP_K] if region_id in row_map]
    if not picked:
        return "요청하신 조건과 유사한 정보를 찾지 못했습니다."
    return f"요청 반영 완료! 3x3 피드를 {len(picked)}곳으로 업데이트했어요: {', '.join(picked)}"


def _detect_query_regions(query_text: str, query_tokens: set[str]) -> set[str]:
    matched_regions: set[str] = set()
    for canonical, aliases in REGION_HINTS.items():
        if canonical in query_tokens or any(alias in query_text for alias in aliases):
            matched_regions.add(canonical)
    return matched_regions


def _source_weight(source: str) -> int:
    for keyword, weight in SOURCE_WEIGHT_KEYWORDS.items():
        if keyword in source:
            return weight
    return 0


def _extract_focus_tokens(query_tokens: set[str], query_regions: set[str]) -> set[str]:
    region_aliases: set[str] = set()
    for region in query_regions:
        region_aliases.update(alias.lower() for alias in REGION_HINTS.get(region, set()))
    return {
        token
        for token in query_tokens
        if token not in GENERIC_QUERY_TOKENS and token not in region_aliases and len(token) >= 2
    }


def _build_scoring_tokens(query_tokens: set[str]) -> set[str]:
    filtered = {token for token in query_tokens if token not in GENERIC_QUERY_TOKENS}
    return filtered or query_tokens


def _extract_locality_tokens(query_tokens: set[str]) -> set[str]:
    return {
        token
        for token in query_tokens
        if len(token) >= 2 and token.endswith(LOCALITY_SUFFIXES) and token not in GENERIC_QUERY_TOKENS
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
    blob = " ".join(
        [
            str(row.get("region", "")),
            str(row.get("province", "")),
            str(row.get("address", "")),
            str(row.get("name", "")),
            str(row.get("summary", "")),
        ]
    ).lower()
    return any(any(alias in blob for alias in REGION_HINTS[region]) for region in regions if region in REGION_HINTS)


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


def _score_row(
    row: dict,
    scoring_tokens: set[str],
    query_regions: set[str],
    specific_regions: set[str],
    focus_tokens: set[str],
    locality_tokens: set[str],
    day_trip: bool,
) -> tuple[int, int, str]:
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

    score = len(scoring_tokens.intersection(doc_tokens)) * 2
    score += len(scoring_tokens.intersection(name_tokens)) * 4
    score += len(scoring_tokens.intersection(summary_tokens)) * 3
    score += len(scoring_tokens.intersection(rec_tokens)) * 2
    score += len(scoring_tokens.intersection(target_tokens)) * 2
    score += len(scoring_tokens.intersection(source_tokens))
    score += _source_weight(source)
    if image_url.startswith("http"):
        score += 2

    region_blob = " ".join([region, province, address, name, summary]).lower()
    if specific_regions:
        if _region_match(row, specific_regions):
            score += 12
        else:
            score -= 14 if day_trip else 10
    elif query_regions:
        if _region_match(row, query_regions):
            score += 6
        elif day_trip:
            score -= 4
        else:
            score -= 2

    for token in focus_tokens:
        if token in name.lower():
            score += 9
        elif token in address.lower():
            score += 6
        elif token in summary.lower():
            score += 5
        elif token in region_blob:
            score += 3

    if locality_tokens:
        if _locality_match(row, locality_tokens):
            score += 14
        else:
            score -= 4

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
    query_regions = _detect_query_regions(query_text, query_tokens)
    specific_regions = {region for region in query_regions if region not in BROAD_REGION_HINTS}
    scoring_tokens = _build_scoring_tokens(query_tokens)
    focus_tokens = _extract_focus_tokens(query_tokens, query_regions)
    locality_tokens = _extract_locality_tokens(query_tokens)

    scored = [
        _score_row(
            row,
            scoring_tokens,
            query_regions,
            specific_regions,
            focus_tokens,
            locality_tokens,
            day_trip,
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


def _build_recommendation_ids(user_message: str, rows: list[dict], size: int = FEED_TOP_K) -> list[int]:
    if not rows:
        return []

    query_tokens = _tokenize(user_message)
    query_text = user_message.lower()
    day_trip = any(keyword in query_text for keyword in DAY_TRIP_KEYWORDS)
    query_regions = _detect_query_regions(query_text, query_tokens)
    specific_regions = {region for region in query_regions if region not in BROAD_REGION_HINTS}
    scoring_tokens = _build_scoring_tokens(query_tokens)
    focus_tokens = _extract_focus_tokens(query_tokens, query_regions)
    locality_tokens = _extract_locality_tokens(query_tokens)

    scored: list[tuple[int, int, str, dict]] = []
    for row in rows:
        region_id, score, name = _score_row(
            row,
            scoring_tokens,
            query_regions,
            specific_regions,
            focus_tokens,
            locality_tokens,
            day_trip,
        )
        scored.append((region_id, score, name, row))
    scored.sort(key=lambda item: (item[1], item[2]), reverse=True)

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

    # 1) 높은 관련도만 우선 채택
    for region_id, score, _, row in scored:
        if score < 6:
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
        anchor_city = str(anchor_row.get("address", "")).strip().split(" ")[0].lower() if anchor_row else ""
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
            if anchor_city and anchor_city not in blob and not any(key in blob for key in anchor_keys):
                continue
            push(region_id, row)
            if len(picked) >= size:
                return picked[:size]

    # 3) 남은 슬롯은 낮은 점수 순서대로 최소 보충
    for region_id, _, _, row in scored:
        push(region_id, row)
        if len(picked) >= size:
            break

    return picked[:size]


def _normalize_recommended_ids(candidate_ids: list, valid_ids: set[int], fallback_ids: list[int]) -> list[int]:
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


def get_chat_result(user_message: str) -> dict:
    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    scope_notice = _out_of_scope_notice(user_message)
    valid_region_ids = {int(row["id"]) for row in rows}
    ranked_ids = _score_regions(user_message)
    baseline_ids = _build_recommendation_ids(user_message, rows, FEED_TOP_K)
    recommended_ids = _normalize_recommended_ids(baseline_ids, valid_region_ids, baseline_ids)
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


def get_trip_chat_result(user_message: str, trip_duration: dict) -> dict:
    """Trip planner용 채팅 - OpenAI 답변만 반환 (자동 메시지 없음)"""
    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    model = "gpt-4o-mini"
    rows = load_regions()
    valid_region_ids = {int(row["id"]) for row in rows}
    
    # tripDuration 기반 최대 개수 계산
    days = trip_duration.get("days", 1)
    max_locations = max(1, days * 5)
    
    baseline_ids = _build_recommendation_ids(user_message, rows, max_locations)
    recommended_ids = _normalize_recommended_ids(baseline_ids, valid_region_ids, baseline_ids)
    
    if not api_key:
        # API 키 없을 때는 기본 답변만 반환 (메시지 없이)
        return {
            "answer": "추천 장소를 조회했습니다.",
            "recommendedRegionIds": recommended_ids
        }
    
    client = OpenAI(api_key=api_key)
    region_context = _build_region_context()
    nights = trip_duration.get("nights", 0)
    system_prompt = (
        "당신은 LocalVibe 여행 계획 도우미입니다. "
        f"사용자는 {nights}박 {days}일 여행을 계획 중입니다. "
        f"최대 {max_locations}개 장소를 추천할 수 있습니다. "
        "질문에 친절하고 구체적으로 답하세요."
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
                        f'{{"answer":"...", "recommendedRegionIds":[id1,id2,...,max {max_locations}개]}}\n'
                        f"질문: {user_message}"
                    ),
                },
            ],
        )
        content = response.choices[0].message.content or ""
        parsed = json.loads(content)
        answer = parsed.get("answer") or "추천 장소를 찾았습니다."
        ids = parsed.get("recommendedRegionIds")
        if not isinstance(ids, list):
            ids = []
        ids = _normalize_recommended_ids(ids, valid_region_ids, baseline_ids)[:max_locations]
        
        # OpenAI 답변만 그대로 반환 (자동 메시지 X)
        return {"answer": answer, "recommendedRegionIds": ids}
    except Exception:
        return {
            "answer": "추천을 처리하는 중 오류가 발생했습니다.",
            "recommendedRegionIds": recommended_ids
        }
