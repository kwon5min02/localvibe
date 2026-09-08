"""장소 비교 — 속성 표·AI 한 줄 결론."""

from __future__ import annotations

import logging
import os

logger = logging.getLogger(__name__)

_MATRIX_LABELS = ("지역", "추천 업종", "혼잡 시간대", "예상 고객층")


def build_attribute_matrix(items: list[dict]) -> list[dict]:
    """행=속성, values=장소별 값."""
    if not items:
        return []
    by_label: dict[str, list[str]] = {lb: [] for lb in _MATRIX_LABELS}
    extra_labels: list[str] = []

    for item in items:
        attr_map = {
            str(a.get("label") or "").strip(): str(a.get("value") or "").strip()
            for a in (item.get("attributes") or [])
            if isinstance(a, dict)
        }
        for lb in _MATRIX_LABELS:
            by_label[lb].append(attr_map.get(lb) or "—")
        for lb, val in attr_map.items():
            if lb and lb not in _MATRIX_LABELS and lb not in extra_labels:
                extra_labels.append(lb)

    rows: list[dict] = []
    for lb in _MATRIX_LABELS:
        vals = by_label[lb]
        if any(v and v != "—" for v in vals):
            rows.append({"label": lb, "values": vals})
    for lb in extra_labels:
        vals = []
        for item in items:
            attr_map = {
                str(a.get("label") or "").strip(): str(a.get("value") or "").strip()
                for a in (item.get("attributes") or [])
                if isinstance(a, dict)
            }
            vals.append(attr_map.get(lb) or "—")
        if any(v and v != "—" for v in vals):
            rows.append({"label": lb, "values": vals})
    return rows


def _rule_based_summary(items: list[dict]) -> str:
    if len(items) < 2:
        name = items[0].get("name") if items else "장소"
        return f"{name} 한 곳만 비교할 수 있어요. 다른 장소를 함께 지정해 주세요."
    a, b = items[0], items[1]
    na, nb = str(a.get("name") or "A"), str(b.get("name") or "B")

    def _attr(item: dict, label: str) -> str:
        for x in item.get("attributes") or []:
            if str(x.get("label") or "") == label:
                return str(x.get("value") or "").strip()
        return ""

    reg_a, reg_b = _attr(a, "지역"), _attr(b, "지역")
    rec_a, rec_b = _attr(a, "추천 업종"), _attr(b, "추천 업종")

    parts = [f"「{na}」와 「{nb}」를 나란히 비교했어요."]
    if reg_a and reg_b and reg_a != reg_b:
        parts.append(f"지역은 {na}({reg_a}), {nb}({reg_b})로 달라요.")
    if rec_a and rec_b and rec_a != rec_b:
        parts.append(f"분위기·업종은 {rec_a} vs {rec_b} 쪽 차이가 있어요.")
    parts.append("확정 일정이 아니라 취향에 맞는 쪽을 골라 보시면 돼요.")
    return " ".join(parts)


def generate_comparison_summary(items: list[dict]) -> str:
    if len(items) < 2:
        return _rule_based_summary(items)

    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        return _rule_based_summary(items)

    try:
        from openai import OpenAI

        client = OpenAI(api_key=api_key)
        lines = []
        for it in items[:2]:
            attrs = {
                str(a.get("label")): str(a.get("value"))
                for a in (it.get("attributes") or [])
                if isinstance(a, dict)
            }
            lines.append(
                f"- {it.get('name')}: 요약={str(it.get('summary') or '')[:200]}; "
                f"지역={attrs.get('지역', '')}; 업종={attrs.get('추천 업종', '')}"
            )
        prompt = (
            "두 여행 장소를 비교해 한국어로 2~3문장만 답하세요. "
            "시간·예약·정확한 도착 시각은 쓰지 마세요. "
            "차이점과 누가 어디에 맞을지 느슨하게만 말하세요.\n"
            + "\n".join(lines)
        )
        resp = client.chat.completions.create(
            model=os.getenv("OPENAI_CHAT_MODEL", "gpt-4o-mini"),
            messages=[
                {"role": "system", "content": "간결한 여행 장소 비교 어시스턴트"},
                {"role": "user", "content": prompt},
            ],
            max_tokens=220,
            temperature=0.5,
        )
        text = str(resp.choices[0].message.content or "").strip()
        return text or _rule_based_summary(items)
    except Exception:
        logger.exception("[comparison] LLM summary failed")
        return _rule_based_summary(items)
