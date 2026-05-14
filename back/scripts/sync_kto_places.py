#!/usr/bin/env python3
"""
KTO 관광 API → MySQL `places` 적재 후, 기본으로 Pinecone 검색 인덱스까지 맞춥니다.

  cd back && PYTHONPATH=. python scripts/sync_kto_places.py

  # MySQL만 (Pinecone 키 없거나 임베딩 생략 시)
  cd back && PYTHONPATH=. python scripts/sync_kto_places.py --db-only

  # 임베딩 일부만 테스트
  cd back && PYTHONPATH=. python scripts/sync_kto_places.py --embed-limit 50

API 서버는 `.env`에 `LV_REGIONS_SKIP_EXTERNAL_FETCH=1` 을 두면 요청 시 KTO를
다시 긁지 않고 DB만 읽습니다. 이미지는 `GET /api/regions/{id}/kto-images` 로
필요할 때만 KTO를 호출합니다.
"""

from __future__ import annotations

import argparse
import importlib.util
import logging
import sys
from pathlib import Path

BACK = Path(__file__).resolve().parents[1]
if str(BACK) not in sys.path:
    sys.path.insert(0, str(BACK))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("sync_kto_places")


def _load_embed_module():
    path = BACK / "scripts" / "embed_places_to_pinecone.py"
    spec = importlib.util.spec_from_file_location("_lv_embed_places", path)
    if spec is None or spec.loader is None:
        raise RuntimeError("embed_places_to_pinecone.py 를 불러올 수 없습니다.")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def main() -> None:
    parser = argparse.ArgumentParser(description="KTO → MySQL places (+ 기본: Pinecone 동기화)")
    parser.add_argument(
        "--db-only",
        action="store_true",
        help="MySQL 적재만 하고 Pinecone 임베딩은 건너뜁니다.",
    )
    parser.add_argument(
        "--embed-limit",
        type=int,
        default=0,
        help="Pinecone 반영 시 최대 행 수 (0이면 전체). embed_places_to_pinecone.py --limit 과 동일.",
    )
    parser.add_argument(
        "--embed-interval",
        type=float,
        default=0.05,
        help="Pinecone upsert 간 간격(초).",
    )
    args = parser.parse_args()

    from dotenv import load_dotenv

    load_dotenv(BACK / ".env")

    from app.repositories.db import mysql_url_configured
    from app.services.data_pipeline import run_pipeline

    if not mysql_url_configured():
        logger.error("MYSQL_URL 이 없습니다.")
        sys.exit(1)

    n = run_pipeline(["kto"])
    logger.info("sync_kto_places: MySQL upsert %s 건", n)

    if args.db_only:
        logger.info("sync_kto_places: --db-only 이므로 Pinecone 생략")
        return

    embed_mod = _load_embed_module()
    rc = embed_mod.run_embed_places_to_pinecone(limit=args.embed_limit, interval=args.embed_interval)
    if rc != 0:
        sys.exit(rc)
    logger.info("sync_kto_places: Pinecone 동기화까지 완료")


if __name__ == "__main__":
    main()
