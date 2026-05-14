#!/usr/bin/env python3
"""
MySQL `places` 테이블 전체를 읽어 Pinecone에 `place_{place_id}` 벡터로 시딩합니다.
임베딩 모델은 `EMBEDDING_MODEL_NAME`(기본: paraphrase-multilingual-MiniLM-L12-v2, 차원 384).

실행 (반드시 back 디렉터리에서, PYTHONPATH 포함):

  cd back && PYTHONPATH=. python scripts/embed_places_to_pinecone.py

  # 처음 50개만 테스트
  cd back && PYTHONPATH=. python scripts/embed_places_to_pinecone.py --limit 50

일반 운영에서는 `scripts/sync_kto_places.py` 가 KTO 적재 후 같은 작업을 이어서 수행합니다.
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from pathlib import Path

BACK = Path(__file__).resolve().parents[1]
if str(BACK) not in sys.path:
    sys.path.insert(0, str(BACK))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("embed_places")


def run_embed_places_to_pinecone(*, limit: int = 0, interval: float = 0.05) -> int:
    """
    MySQL places → Pinecone upsert. 성공 0, 설정 오류 1.
    `sync_kto_places.py` 등에서 재사용합니다.
    """
    from dotenv import load_dotenv

    load_dotenv(BACK / ".env")

    from app.repositories.db import mysql_url_configured, session_scope
    from app.repositories import places_store
    from app.services import embedding_service

    if not mysql_url_configured():
        logger.error("MYSQL_URL 이 설정되지 않았습니다.")
        return 1
    if not embedding_service.pinecone_ready():
        logger.error("Pinecone 을 사용할 수 없습니다. PINECONE_API_KEY, PINECONE_INDEX 를 확인하세요.")
        return 1

    with session_scope() as session:
        places = places_store.list_all_places(session)
        rows = [
            {
                "place_id": int(p.place_id),
                "name": p.name or "",
                "category": p.category,
                "region": p.region,
                "province": p.province,
                "address": p.address,
                "description": p.description,
            }
            for p in places
        ]

    if limit and limit > 0:
        rows = rows[:limit]

    ok, skip, fail = 0, 0, 0
    for i, r in enumerate(rows, 1):
        vid = embedding_service.embed_place_bootstrap_upsert(
            place_id=r["place_id"],
            place_name=r["name"],
            category=r["category"],
            region=r["region"],
            province=r["province"],
            address=r["address"],
            description=r["description"],
        )
        if vid:
            ok += 1
        elif not embedding_service.build_place_embed_text(
            place_name=r["name"],
            category=r["category"],
            region=r["region"],
            province=r["province"],
            address=r["address"],
            description=r["description"],
        ).strip():
            skip += 1
        else:
            fail += 1
        if i % 50 == 0:
            logger.info("진행 %s / %s (ok=%s skip=%s fail=%s)", i, len(rows), ok, skip, fail)
        time.sleep(max(0.0, interval))

    logger.info("완료: 총 %s건 → ok=%s skip(빈텍스트)=%s fail=%s", len(rows), ok, skip, fail)
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="PLACES → Pinecone bootstrap upsert")
    parser.add_argument("--limit", type=int, default=0, help="처리할 최대 행 수 (0이면 전체)")
    parser.add_argument("--interval", type=float, default=0.05, help="upsert 간 간격(초)")
    args = parser.parse_args()

    sys.exit(run_embed_places_to_pinecone(limit=args.limit, interval=args.interval))


if __name__ == "__main__":
    main()
