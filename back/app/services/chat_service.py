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


def _tokenize(text: str) -> set[str]:
    tokens = re.findall(r"[가-힣A-Za-z0-9]+", text.lower())
    return {token for token in tokens if len(token) >= 2}


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
    picked = [row_map[region_id]["name"] for region_id in ranked_ids[:3] if region_id in row_map]
    if not picked:
        return "요청하신 조건과 유사한 정보를 찾지 못했습니다."
    return f"질문과 유사한 항목은 {', '.join(picked)} 입니다."


def _score_regions(user_message: str) -> list[int]:
    rows = load_regions()
    if not rows:
        return []

    query_tokens = _tokenize(user_message)
    if not query_tokens:
        all_ids = [int(row["id"]) for row in rows]
        random.shuffle(all_ids)
        return all_ids

    day_trip = any(keyword in user_message.lower() for keyword in DAY_TRIP_KEYWORDS)

    # 질의에서 실제 데이터명과 겹치는 토큰을 권역 토큰으로 사용합니다(하드코딩 도시 목록 제거).
    location_candidates = [token for token in query_tokens if any(token in str(row.get("name", "")).lower() for row in rows)]
    location_token = max(location_candidates, key=len) if location_candidates else None

    scored: list[tuple[int, int, str]] = []
    for row in rows:
        name = str(row.get("name", ""))
        summary = str(row.get("summary", ""))
        source = str(row.get("dataSource", ""))
        rec = " ".join(row.get("recommendedBusinesses", []))
        target = " ".join(row.get("targetCustomers", []))
        busy = " ".join(row.get("busyHours", []))
        doc_text = " ".join([name, summary, source, rec, target, busy]).lower()
        doc_tokens = _tokenize(doc_text)
        name_tokens = _tokenize(name)
        source_tokens = _tokenize(source)

        overlap = query_tokens.intersection(doc_tokens)
        score = len(overlap) * 2
        score += len(query_tokens.intersection(name_tokens)) * 3
        score += len(query_tokens.intersection(source_tokens))

        if location_token:
            if location_token in name.lower() or location_token in summary.lower():
                score += 4
            elif day_trip:
                score -= 3

        scored.append((int(row["id"]), score, name))

    scored.sort(key=lambda item: (item[1], item[2]), reverse=True)
    ordered_ids = [region_id for region_id, _, _ in scored]

    if all(score <= 0 for _, score, _ in scored):
        random.shuffle(ordered_ids)
    return ordered_ids


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
    valid_region_ids = {int(row["id"]) for row in rows}
    ranked_ids = _score_regions(user_message)
    recommended_ids = _normalize_recommended_ids(ranked_ids, valid_region_ids, ranked_ids)
    if not api_key:
        return {"answer": _fallback_answer(user_message), "recommendedRegionIds": recommended_ids}

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
        ids = _normalize_recommended_ids(ids, valid_region_ids, ranked_ids)
        return {"answer": answer, "recommendedRegionIds": ids}
    except Exception:
        return {"answer": _fallback_answer(user_message), "recommendedRegionIds": recommended_ids}
