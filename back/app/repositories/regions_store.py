"""
지역/장소 영속 계층 — MySQL + SQLAlchemy 전용.
SQLite(regions 파일) 경로는 제거되었습니다. MYSQL_URL 필수.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)


def _mysql_configured() -> bool:
    return bool(os.getenv("MYSQL_URL", "").strip())


def init_region_db() -> None:
    """SQLAlchemy 메타데이터로 테이블 생성 (없으면 생성)."""
    if not _mysql_configured():
        logger.warning(
            "[regions_store] MYSQL_URL이 없습니다. DB 초기화를 건너뜁니다. "
            "서버에서는 .env에 MYSQL_URL을 설정하세요."
        )
        return
    from app.repositories.db import init_db

    init_db()


def upsert_regions_to_db(rows: list[dict]) -> None:
    if not rows:
        return
    if not _mysql_configured():
        logger.warning("[regions_store] MYSQL_URL 없음 — upsert_regions_to_db 무시")
        return
    from app.repositories import places_store
    from app.repositories.db import session_scope

    with session_scope() as session:
        places_store.bulk_upsert_legacy_regions(session, rows)


def load_regions_from_db() -> list[dict]:
    if not _mysql_configured():
        return []
    from app.repositories import places_store
    from app.repositories.db import session_scope

    with session_scope() as session:
        return places_store.list_places_as_region_dicts(session)


def get_region_by_id_from_db(region_id: int) -> Optional[dict]:
    if not _mysql_configured():
        return None
    from app.repositories import places_store
    from app.repositories.db import session_scope

    with session_scope() as session:
        return places_store.get_as_region_dict(session, region_id)


def update_region_summary_short_in_db(region_id: int, summary_short: str) -> None:
    if not _mysql_configured():
        return
    from app.repositories import places_store
    from app.repositories.db import session_scope

    with session_scope() as session:
        places_store.update_summary_short(session, region_id, summary_short)


def update_region_coordinates_in_db(region_id: int, latitude: float, longitude: float) -> None:
    if not _mysql_configured():
        return
    from app.repositories import places_store
    from app.repositories.db import session_scope

    with session_scope() as session:
        places_store.update_coordinates(session, region_id, latitude, longitude)
