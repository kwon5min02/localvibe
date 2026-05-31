"""아티클 plain text / JSON → 모달용 블록 스키마 (프론트 articleBlocks.js와 동일 의도)."""

from __future__ import annotations

import json
import re
from typing import Any


def _normalize_blocks(blocks: list) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for b in blocks or []:
        if not isinstance(b, dict):
            continue
        text = str(b.get("text") or "").strip()
        if not text:
            continue
        item: dict[str, Any] = {
            "type": str(b.get("type") or "paragraph"),
            "text": text,
        }
        if b.get("attribution"):
            item["attribution"] = str(b["attribution"])
        out.append(item)
    return out


def _structured_payload_to_blocks(data: dict) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    lead = str(data.get("lead") or "").strip()
    if lead:
        out.append({"type": "lead", "text": lead})
    for sec in data.get("sections") or []:
        if not isinstance(sec, dict):
            continue
        heading = str(sec.get("heading") or sec.get("title") or "").strip()
        if heading:
            out.append({"type": "subheader", "text": heading})
        paras = sec.get("paragraphs") or ([sec["text"]] if sec.get("text") else [])
        for p in paras:
            text = str(p or "").strip()
            if text:
                out.append({"type": "paragraph", "text": text})
    quote = data.get("quote")
    if isinstance(quote, dict) and quote.get("text"):
        out.append(
            {
                "type": "quote",
                "text": str(quote["text"]).strip(),
                "attribution": str(quote.get("attribution") or "— 방문 후기"),
            }
        )
    tip = str(data.get("visit_tip") or "").strip()
    if tip:
        out.append({"type": "subheader", "text": "방문 전 알아두면 좋은 것"})
        out.append({"type": "paragraph", "text": tip})
    return out


def try_parse_json_blocks(raw: str) -> list[dict[str, Any]] | None:
    t = str(raw or "").strip()
    if not t.startswith("{") and not t.startswith("["):
        return None
    try:
        data = json.loads(t)
    except json.JSONDecodeError:
        return None
    if isinstance(data, list):
        return _normalize_blocks(data)
    if isinstance(data, dict) and isinstance(data.get("blocks"), list):
        return _normalize_blocks(data["blocks"])
    if isinstance(data, dict) and (data.get("lead") or data.get("sections")):
        return _structured_payload_to_blocks(data)
    return None


_SECTION_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("추천 메뉴", re.compile(r"메뉴|맛집|요리|음식|라자냐|파스타|스테이크|시그니처", re.I)),
    ("분위기 & 뷰", re.compile(r"분위기|뷰|야경|전망|인테리어|공간|감성|데이트", re.I)),
    ("영업 시간", re.compile(r"영업\s*시간|운영\s*시간|브레이크|휴무|\d{1,2}\s*:\s*\d{2}", re.I)),
    ("주차 & 오시는 길", re.compile(r"주차|대중교통|지하철|버스|찾아가", re.I)),
    ("방문 팁", re.compile(r"추천|예약|대기|방문|팁|알아두", re.I)),
]


def _split_sentences(text: str) -> list[str]:
    normalized = re.sub(r"\s+", " ", str(text or "").replace("\n", " ")).strip()
    if not normalized:
        return []
    parts = re.split(r"(?<=[.!?。])\s+(?=[가-힣A-Z「])", normalized)
    return [p.strip() for p in parts if p.strip()] or [normalized]


def _classify_sentence(sentence: str) -> str:
    for header, pattern in _SECTION_RULES:
        if pattern.search(sentence):
            return header
    return "이곳의 이야기"


def content_to_blocks(content: str) -> list[dict[str, Any]]:
    parsed = try_parse_json_blocks(content)
    if parsed:
        return parsed

    text = str(content or "").strip()
    if not text:
        return []

    if "\n\n" in text:
        parts = [p.strip() for p in re.split(r"\n\n+", text) if p.strip()]
        if len(parts) >= 2:
            blocks: list[dict[str, Any]] = [{"type": "lead", "text": parts[0]}]
            for i, part in enumerate(parts[1:], start=1):
                lines = part.split("\n", 1)
                first = lines[0].strip()
                is_header = (
                    len(first) <= 28
                    and not re.search(r"[.!?。]$", first)
                    and (len(lines) > 1 or (i == 1 and len(parts) > 2))
                )
                if is_header and len(lines) > 1:
                    blocks.append({"type": "subheader", "text": first})
                    body = lines[1].strip()
                    if body:
                        blocks.append({"type": "paragraph", "text": body})
                else:
                    blocks.append({"type": "paragraph", "text": part})
            return blocks

    sentences = _split_sentences(text)
    lead_count = min(2, max(1, len(sentences) // 6 or 1))
    lead = " ".join(sentences[:lead_count])
    body = sentences[lead_count:]

    blocks = []
    if lead:
        blocks.append({"type": "lead", "text": lead})

    groups: dict[str, list[str]] = {}
    order: list[str] = []
    for s in body:
        key = _classify_sentence(s)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(s)

    for header in order:
        sents = groups[header]
        if not sents:
            continue
        blocks.append({"type": "subheader", "text": header})
        chunk = " ".join(sents)
        blocks.append({"type": "paragraph", "text": chunk})

    if len(blocks) <= 1 and text:
        return [
            {"type": "lead", "text": text[:280]},
            *(
                [{"type": "subheader", "text": "상세 정보"}, {"type": "paragraph", "text": text[280:]}]
                if len(text) > 280
                else []
            ),
        ]
    return blocks


def serialize_structured_article(
    title: str,
    lead: str,
    sections: list[dict[str, Any]],
    quote: dict[str, str] | None = None,
    visit_tip: str = "",
) -> str:
    payload: dict[str, Any] = {
        "version": 2,
        "title": title,
        "lead": lead,
        "sections": sections,
    }
    if quote:
        payload["quote"] = quote
    if visit_tip:
        payload["visit_tip"] = visit_tip
    return json.dumps(payload, ensure_ascii=False)
