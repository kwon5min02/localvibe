"""
전체 장소 재임베딩 스크립트.
실행:
  python scripts/train_bm25.py
  nohup python scripts/reembed_all.py > reembed.log 2>&1 &
"""

from __future__ import annotations

import json
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

BATCH_SIZE = int(os.getenv("REEMBED_BATCH_SIZE", "64"))
PINECONE_UPSERT_BATCH = int(os.getenv("REEMBED_PINECONE_BATCH", "100"))
CHECKPOINT_PATH = os.getenv("REEMBED_CHECKPOINT", "reembed_checkpoint.json")


def _load_checkpoint() -> set[int]:
    if not os.path.exists(CHECKPOINT_PATH):
        return set()
    try:
        with open(CHECKPOINT_PATH, encoding="utf-8") as f:
            data = json.load(f)
        done = set(int(x) for x in data.get("done", []))
        logger.info("[체크포인트] 완료된 장소 %d개 건너뜀", len(done))
        return done
    except Exception:
        logger.warning("[체크포인트] 로드 실패, 처음부터 재시작")
        return set()


def _save_checkpoint(done_ids: set[int]) -> None:
    try:
        with open(CHECKPOINT_PATH, "w", encoding="utf-8") as f:
            json.dump({"done": list(done_ids)}, f, ensure_ascii=False)
    except Exception:
        logger.warning("[체크포인트] 저장 실패")


def _upsert_with_retry(index, vectors: list[dict], max_retries: int = 3) -> bool:
    for attempt in range(max_retries):
        try:
            index.upsert(vectors=vectors)
            return True
        except Exception as e:
            wait = 2**attempt
            logger.warning(
                "[embed] upsert 실패 (%d/%d): %s -> %d초 후 재시도",
                attempt + 1,
                max_retries,
                str(e)[:120],
                wait,
            )
            time.sleep(wait)
    logger.error("[embed] upsert 최대 재시도 초과")
    return False


def reembed_all() -> None:
    from app.repositories.db import session_scope
    from app.repositories.places_store import (
        _deserialize_insight,
        list_all_places,
        list_crawled_texts_for_place,
    )
    from app.services import embedding_service
    from app.services.embedding_service import build_place_embed_text

    bm25_path = os.getenv("BM25_MODEL_PATH", "bm25_encoder.json")
    if not os.path.exists(bm25_path):
        logger.warning("BM25 모델 파일 없음 (%s) — dense 위주로 동작할 수 있음", bm25_path)

    if not embedding_service.pinecone_ready():
        logger.error("Pinecone 연결 실패. PINECONE_API_KEY/PINECONE_INDEX 확인 필요")
        sys.exit(1)

    index = embedding_service._get_pinecone_index()
    model = embedding_service._get_model()
    bm25_encoder = embedding_service._get_bm25_encoder()
    use_hybrid = bm25_encoder is not None
    logger.info("하이브리드 모드: %s", "ON" if use_hybrid else "OFF(dense only)")

    done_ids = _load_checkpoint()

    with session_scope() as session:
        places = list_all_places(session)
        remaining = [p for p in places if p.place_id not in done_ids]
        logger.info(
            "총 %d개 | 완료 %d개 | 남음 %d개 | 배치 %d",
            len(places),
            len(done_ids),
            len(remaining),
            BATCH_SIZE,
        )

        success = 0
        fail = 0
        for batch_start in range(0, len(remaining), BATCH_SIZE):
            batch = remaining[batch_start : batch_start + BATCH_SIZE]

            texts: list[str] = []
            metas: list[dict] = []
            for place in batch:
                try:
                    crawled_texts = list_crawled_texts_for_place(session, place.place_id)
                    blog_contents = [
                        ct.content
                        for ct in crawled_texts
                        if ct.content and len(ct.content.strip()) > 50
                    ]
                    rec_businesses, _, target_customers = _deserialize_insight(place.insight_json)
                    body = build_place_embed_text(
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
                    if not body.strip():
                        continue
                    texts.append(body)
                    metas.append(
                        {
                            "place_id": int(place.place_id),
                            "place_name": place.name or "",
                            "category": place.category or "",
                            "region": place.region or "",
                            "province": place.province or "",
                        }
                    )
                except Exception:
                    logger.exception("[ERROR] place_id=%s 텍스트 준비 실패", place.place_id)
                    fail += 1

            if not texts:
                continue

            try:
                dense_vecs = model.encode(
                    texts,
                    batch_size=BATCH_SIZE,
                    show_progress_bar=False,
                    convert_to_numpy=True,
                )
            except Exception:
                logger.exception("[embed] dense 배치 인코딩 실패")
                fail += len(texts)
                continue

            sparse_vecs: list[dict | None] = [None] * len(texts)
            if use_hybrid:
                try:
                    raw_sparse = bm25_encoder.encode_documents(texts)
                    for i, sp in enumerate(raw_sparse):
                        if isinstance(sp, dict):
                            sparse_vecs[i] = sp
                        else:
                            sparse_vecs[i] = {"indices": list(sp.indices), "values": list(sp.values)}
                except Exception:
                    logger.warning("[embed] sparse 배치 인코딩 실패 — dense만 진행")

            upsert_batch: list[dict] = []
            for i, (meta, dense_vec) in enumerate(zip(metas, dense_vecs)):
                vector = {
                    "id": f"place_{meta['place_id']}",
                    "values": dense_vec.tolist(),
                    "metadata": {
                        "place_id": meta["place_id"],
                        "place_name": meta["place_name"],
                        "category": meta["category"],
                        "region": meta["region"],
                        "province": meta["province"],
                        "vector_kind": "place_bootstrap",
                    },
                }
                sp = sparse_vecs[i]
                if sp and sp.get("indices"):
                    vector["sparse_values"] = sp
                upsert_batch.append(vector)

                if len(upsert_batch) >= PINECONE_UPSERT_BATCH:
                    ok = _upsert_with_retry(index, upsert_batch)
                    if ok:
                        for item in upsert_batch:
                            done_ids.add(int(item["metadata"]["place_id"]))
                            success += 1
                    else:
                        fail += len(upsert_batch)
                    upsert_batch = []

            if upsert_batch:
                ok = _upsert_with_retry(index, upsert_batch)
                if ok:
                    for item in upsert_batch:
                        done_ids.add(int(item["metadata"]["place_id"]))
                        success += 1
                else:
                    fail += len(upsert_batch)

            _save_checkpoint(done_ids)
            done = min(batch_start + BATCH_SIZE, len(remaining))
            logger.info("[진행] %d/%d | 성공 %d | 실패 %d", done, len(remaining), success, fail)

    logger.info("재임베딩 종료: 성공 %d | 실패 %d", success, fail)
    if fail == 0 and os.path.exists(CHECKPOINT_PATH):
        os.remove(CHECKPOINT_PATH)
        logger.info("[체크포인트] 전체 성공으로 파일 삭제")


if __name__ == "__main__":
    reembed_all()
