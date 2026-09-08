"""장소 이미지 URL — DB/API에는 placeholder(Unsplash 등)를 저장·노출하지 않음."""

from __future__ import annotations

PLACEHOLDER_IMAGE_HOST_MARKERS = ("images.unsplash.com",)


def is_placeholder_image_url(url: str | None) -> bool:
    u = str(url or "").strip().lower()
    if not u:
        return False
    return any(marker in u for marker in PLACEHOLDER_IMAGE_HOST_MARKERS)


def sanitize_display_image_url(url: str | None) -> str:
    """API·DB 응답용 — placeholder면 빈 문자열."""
    u = str(url or "").strip()
    if not u or is_placeholder_image_url(u):
        return ""
    return u
