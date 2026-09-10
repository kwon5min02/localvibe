"""커뮤니티 게시판 목록.

게시판은 테이블이 아니라 코드 상수로 관리합니다.
프런트의 front/src/data/communityMock.js `COMMUNITY_BOARDS`와 id가 1:1로 같아야 하며,
한쪽만 고치면 목록 필터가 조용히 비게 되므로 함께 수정하세요.
"""

from __future__ import annotations

# id -> 화면에 쓰는 이름 (백엔드는 검증에만 사용)
BOARDS: dict[str, str] = {
    "gwangju-dong": "광주 동구",
    "gwangju-seo": "광주 서구",
    "gwangju-nam": "광주 남구",
    "gwangju-buk": "광주 북구",
    "gwangju-gwangsan": "광주 광산구",
    "yeosu": "여수",
    "suncheon": "순천",
    "mokpo": "목포",
    "damyang": "담양",
    "boseong": "보성",
    "wando": "완도",
}

# 목록 조회에서 "전체"를 뜻하는 값
ALL_BOARD_ID = "all"


def is_valid_board(board_id: str) -> bool:
    return board_id in BOARDS


def normalize_board_filter(board_id: str | None) -> str | None:
    """목록 필터용 — 전체이거나 알 수 없는 값이면 None(필터 없음)."""
    if not board_id or board_id == ALL_BOARD_ID:
        return None
    return board_id if is_valid_board(board_id) else None
