"""커뮤니티 첨부 이미지 저장.

back/static/community/YYYY/MM/ 아래에 저장하고 /static/community/... 로 서빙합니다.
- 원본 파일명은 쓰지 않습니다(경로 조작·중복 방지). uuid 로 새로 짓습니다.
- 긴 변을 1600px로 줄이고 썸네일(400px)을 함께 만듭니다.
- 다시 인코딩하므로 EXIF의 위치정보가 남지 않습니다.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps

_BACKEND_ROOT = Path(__file__).resolve().parents[3]
IMAGE_ROOT = _BACKEND_ROOT / "static" / "community"

MAX_BYTES = 8 * 1024 * 1024  # 8MB
MAX_EDGE = 1600
THUMB_EDGE = 400
ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP", "GIF"}


class ImageError(Exception):
    """업로드된 파일이 이미지가 아니거나 처리할 수 없을 때."""


def save_upload(data: bytes) -> tuple[str, str]:
    """이미지 바이트를 저장하고 (원본 URL, 썸네일 URL)을 돌려줍니다."""
    if not data:
        raise ImageError("빈 파일입니다.")
    if len(data) > MAX_BYTES:
        raise ImageError("이미지는 8MB까지 올릴 수 있어요.")

    try:
        image = Image.open(BytesIO(data))
        image.verify()  # 실제 이미지인지 먼저 확인
        image = Image.open(BytesIO(data))
    except Exception as exc:  # noqa: BLE001 - 손상 파일 등 모두 동일 처리
        raise ImageError("이미지 파일이 아니거나 손상되었습니다.") from exc

    if (image.format or "").upper() not in ALLOWED_FORMATS:
        raise ImageError("JPG·PNG·WEBP·GIF만 올릴 수 있어요.")

    # 세로로 찍은 사진이 눕지 않도록 EXIF 회전을 먼저 적용
    image = ImageOps.exif_transpose(image)
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    now = datetime.utcnow()
    folder = IMAGE_ROOT / f"{now:%Y}" / f"{now:%m}"
    folder.mkdir(parents=True, exist_ok=True)

    name = uuid.uuid4().hex
    full_path = folder / f"{name}.jpg"
    thumb_path = folder / f"{name}_thumb.jpg"

    full = image.copy()
    full.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)
    full.save(full_path, "JPEG", quality=85, optimize=True)

    thumb = image.copy()
    thumb.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.LANCZOS)
    thumb.save(thumb_path, "JPEG", quality=80, optimize=True)

    rel = f"/static/community/{now:%Y}/{now:%m}/{name}"
    return f"{rel}.jpg", f"{rel}_thumb.jpg"


def delete_image(url: str) -> None:
    """글이 지워질 때 파일도 정리합니다. 경로가 이상하면 아무것도 하지 않습니다."""
    prefix = "/static/community/"
    if not url or not url.startswith(prefix):
        return
    target = (IMAGE_ROOT / url[len(prefix) :]).resolve()
    try:
        target.relative_to(IMAGE_ROOT.resolve())
    except ValueError:
        return  # 루트 밖을 가리키면 무시
    target.unlink(missing_ok=True)
