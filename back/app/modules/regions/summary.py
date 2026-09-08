import os
import re
from typing import Optional

from openai import OpenAI


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", str(text or "")).strip()


def _truncate_text(text: str, max_len: int) -> str:
    normalized = _normalize_text(text)
    if len(normalized) <= max_len:
        return normalized
    return normalized[: max_len - 1].rstrip() + "…"


def summarize_korean_text(text: str, max_len: int = 100) -> str:
    normalized = _normalize_text(text)
    if not normalized:
        return ""
    if len(normalized) <= max_len:
        return normalized

    api_key: Optional[str] = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return _truncate_text(normalized, max_len)

    try:
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.2,
            messages=[
                {
                    "role": "system",
                    "content": f"한국어 여행 정보 요약가입니다. 반드시 {max_len}자 이하 한 문장으로 요약하세요.",
                },
                {"role": "user", "content": normalized},
            ],
        )
        content = _normalize_text(response.choices[0].message.content or "")
        if not content:
            return _truncate_text(normalized, max_len)
        if len(content) > max_len:
            return _truncate_text(content, max_len)
        return content
    except Exception:
        return _truncate_text(normalized, max_len)
