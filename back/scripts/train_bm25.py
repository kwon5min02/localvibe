"""
BM25 모델 학습 스크립트.
실행: python scripts/train_bm25.py
"""

from __future__ import annotations

import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BM25_MODEL_PATH = os.getenv("BM25_MODEL_PATH", "bm25_encoder.json")


def train_bm25() -> None:
    try:
        from pinecone_text.sparse import BM25Encoder
    except ImportError:
        logger.error("pinecone-text 미설치. 먼저 pip install pinecone-text")
        sys.exit(1)

    from app.repositories.db import session_scope
    from app.repositories.places_store import (
        _deserialize_insight,
        list_all_places,
        list_crawled_texts_for_place,
    )
    from app.services.embedding_service import build_place_embed_text

    logger.info("BM25 학습용 말뭉치 수집 시작")

    corpus: list[str] = []
    with session_scope() as session:
        places = list_all_places(session)
        logger.info("장소 %d개 수집", len(places))
        for place in places:
            try:
                crawled_texts = list_crawled_texts_for_place(session, place.place_id)
                blog_contents = [
                    ct.content
                    for ct in crawled_texts
                    if ct.content and len(ct.content.strip()) > 50
                ]
                rec_businesses, _, target_customers = _deserialize_insight(place.insight_json)
                text = build_place_embed_text(
                    place_name=place.name or "",
                    category=place.category,
                    region=place.region,
                    province=place.province,
                    address=place.address,
                    description=place.description,
                    target_customers=target_customers or [],
                    recommended_businesses=rec_businesses or [],
                    crawled_blog_texts=blog_contents,
                )
                if text.strip():
                    corpus.append(text)
            except Exception:
                logger.warning("place_id=%d 말뭉치 수집 실패", place.place_id)

    if not corpus:
        logger.error("말뭉치가 비어 있습니다. DB 연결 상태를 확인하세요.")
        sys.exit(1)

    logger.info("말뭉치 %d개로 BM25 학습 시작", len(corpus))
    encoder = BM25Encoder()
    encoder.fit(corpus)
    encoder.dump(BM25_MODEL_PATH)
    logger.info("BM25 학습 완료: %s", BM25_MODEL_PATH)


if __name__ == "__main__":
    train_bm25()
