"""
Sentence-Transformers 임베딩 및 Pinecone 하이브리드 upsert/검색.

하이브리드 검색:
- Dense: jhgan/ko-sentence-transformers (의미 기반, 신조어 대응)
- Sparse: BM25 (키워드 정확도, 지명/브랜드명 매칭)
- alpha로 두 방식 비중 조절 (PINECONE_SEARCH_ALPHA, 기본 0.7)
"""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_model = None
_pinecone_index = None
_pinecone_client = None
_bm25_encoder = None


def _resolve_bm25_model_path(raw_path: str) -> Path:
    p = Path(raw_path).expanduser()
    if p.is_absolute():
        return p
    # 실행 cwd 의존성을 피하기 위해 backend 루트를 기준으로도 탐색
    back_root = Path(__file__).resolve().parents[2]
    candidates = [
        Path.cwd() / p,
        back_root / p,
        back_root.parent / p,
    ]
    for c in candidates:
        if c.exists():
            return c
    return candidates[0]


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        name = os.getenv(
            "EMBEDDING_MODEL_NAME",
            "dragonkue/multilingual-e5-small-ko",
        )
        logger.info("[embed] loading dense model %s", name)
        _model = SentenceTransformer(name)
    return _model


def _get_bm25_encoder():
    """BM25 sparse 인코더 로드."""
    global _bm25_encoder
    if _bm25_encoder is not None:
        return _bm25_encoder
    try:
        from pinecone_text.sparse import BM25Encoder

        bm25_path_raw = os.getenv("BM25_MODEL_PATH", "bm25_encoder.json").strip()
        bm25_path = _resolve_bm25_model_path(bm25_path_raw)
        if bm25_path.exists():
            _bm25_encoder = BM25Encoder()
            _bm25_encoder.load(str(bm25_path))
            logger.info("[embed] BM25 모델 로드: %s", bm25_path)
        else:
            logger.warning(
                "[embed] BM25 모델 파일 없음 (%s) → 기본값 사용. "
                "scripts/train_bm25.py 실행 권장",
                bm25_path_raw,
            )
            _bm25_encoder = BM25Encoder.default()
    except ImportError:
        logger.warning("[embed] pinecone-text 미설치 → sparse 비활성화")
        _bm25_encoder = None
    except Exception:
        logger.exception("[embed] BM25 인코더 초기화 실패 → sparse 비활성화")
        _bm25_encoder = None
    return _bm25_encoder


def _get_pinecone_index():
    global _pinecone_index, _pinecone_client
    if _pinecone_index is not None:
        return _pinecone_index
    api_key = os.getenv("PINECONE_API_KEY", "").strip()
    if not api_key:
        return None
    index_name = os.getenv("PINECONE_INDEX", "localvibe-hybrid").strip()
    try:
        from pinecone import Pinecone

        _pinecone_client = Pinecone(api_key=api_key)
        _pinecone_index = _pinecone_client.Index(index_name)
        logger.info("[embed] pinecone index=%s", index_name)
    except Exception:
        logger.exception("[embed] pinecone init failed")
        _pinecone_index = None
    return _pinecone_index


def pinecone_ready() -> bool:
    return _get_pinecone_index() is not None


def embed_text(text: str) -> list[float]:
    model = _get_model()
    vec = model.encode(text, convert_to_numpy=True)
    return vec.tolist()


def embed_texts_batch(texts: list[str], batch_size: int = 64) -> list[list[float]]:
    """여러 텍스트 배치 → dense 벡터 리스트."""
    model = _get_model()
    vecs = model.encode(texts, batch_size=batch_size, convert_to_numpy=True, show_progress_bar=False)
    return [v.tolist() for v in vecs]


def encode_sparse(text: str) -> dict | None:
    """텍스트 → BM25 sparse 벡터."""
    encoder = _get_bm25_encoder()
    if encoder is None:
        return None
    try:
        result = encoder.encode_documents([text])
        sparse = result[0]
        if isinstance(sparse, dict):
            return sparse
        return {"indices": list(sparse.indices), "values": list(sparse.values)}
    except Exception:
        logger.warning("[embed] sparse encode 실패")
        return None


def encode_sparse_query(query: str) -> dict | None:
    """쿼리 텍스트 → BM25 sparse 벡터."""
    encoder = _get_bm25_encoder()
    if encoder is None:
        return None
    try:
        result = encoder.encode_queries([query])
        sparse = result[0]
        if isinstance(sparse, dict):
            return sparse
        return {"indices": list(sparse.indices), "values": list(sparse.values)}
    except Exception:
        logger.warning("[embed] sparse query encode 실패")
        return None


def build_place_embed_text(
    *,
    place_name: str,
    category: str | None,
    region: str | None,
    province: str | None,
    address: str | None,
    description: str | None,
    target_customers: list[str] | None = None,
    recommended_businesses: list[str] | None = None,
    crawled_blog_texts: list[str] | None = None,
) -> str:
    """의미 검색용 임베딩 텍스트 생성."""
    parts: list[str] = []
    if place_name:
        parts.append(f"장소명: {place_name}")

    type_str = ""
    if recommended_businesses:
        type_str = ", ".join(str(b) for b in recommended_businesses if b)
    elif category:
        type_str = category
    if type_str:
        parts.append(f"유형: {type_str}")

    loc_parts = [p for p in [province, region] if p]
    if loc_parts:
        parts.append(f"지역: {' '.join(loc_parts)}")

    if address:
        parts.append(f"주소: {address}")
    if description:
        parts.append(f"설명: {description[:1000]}")

    if target_customers:
        tc_str = ", ".join(str(t) for t in target_customers if t)
        if tc_str:
            parts.append(f"추천 대상: {tc_str}")

    if crawled_blog_texts:
        for i, blog in enumerate(crawled_blog_texts[:3]):
            trimmed = str(blog or "").strip()[:500]
            if trimmed:
                parts.append(f"방문후기{i + 1}: {trimmed}")
    return "\n".join(p for p in parts if p.strip())


def embed_place_bootstrap_upsert(
    *,
    place_id: int,
    place_name: str,
    category: str | None,
    region: str | None,
    province: str | None,
    address: str | None,
    description: str | None,
    target_customers: list[str] | None = None,
    recommended_businesses: list[str] | None = None,
    crawled_blog_texts: list[str] | None = None,
) -> str | None:
    """단일 장소 Pinecone 하이브리드 upsert."""
    index = _get_pinecone_index()
    if not index:
        return None
    body = build_place_embed_text(
        place_name=place_name,
        category=category,
        region=region,
        province=province,
        address=address,
        description=description,
        target_customers=target_customers,
        recommended_businesses=recommended_businesses,
        crawled_blog_texts=crawled_blog_texts,
    )
    if not body.strip():
        return None
    vector_id = f"place_{place_id}"
    dense_values = embed_text(body)
    sparse_values = encode_sparse(body)
    created = datetime.now(timezone.utc).isoformat()
    metadata: dict[str, Any] = {
        "place_id": place_id,
        "place_name": place_name or "",
        "category": category or "",
        "region": region or "",
        "province": province or "",
        "vector_kind": "place_bootstrap",
        "created_at": created,
    }
    try:
        vector: dict[str, Any] = {"id": vector_id, "values": dense_values, "metadata": metadata}
        if sparse_values:
            vector["sparse_values"] = sparse_values
        index.upsert(vectors=[vector])
    except Exception:
        logger.exception("[embed] bootstrap upsert failed place_id=%s", place_id)
        return None
    return vector_id


def delete_pinecone_vector_ids(vector_ids: list[str]) -> None:
    if not vector_ids:
        return
    index = _get_pinecone_index()
    if not index:
        return
    try:
        index.delete(ids=list(vector_ids))
    except Exception:
        logger.exception("[embed] pinecone delete failed ids=%s", vector_ids[:5])


def embed_and_upsert(
    *,
    doc_id: int,
    place_id: int,
    article_text: str,
    place_name: str,
    category: str | None,
    region: str | None,
    province: str | None,
) -> str | None:
    """문서 기반 Pinecone 하이브리드 upsert."""
    index = _get_pinecone_index()
    if not index:
        return None
    vector_id = f"doc_{doc_id}"
    dense_values = embed_text(article_text)
    sparse_values = encode_sparse(article_text)
    created = datetime.now(timezone.utc).isoformat()
    metadata: dict[str, Any] = {
        "doc_id": doc_id,
        "place_id": place_id,
        "place_name": place_name or "",
        "category": category or "",
        "region": region or "",
        "province": province or "",
        "source": "ai_generated",
        "created_at": created,
    }
    try:
        vector: dict[str, Any] = {"id": vector_id, "values": dense_values, "metadata": metadata}
        if sparse_values:
            vector["sparse_values"] = sparse_values
        index.upsert(vectors=[vector])
        delete_pinecone_vector_ids([f"place_{place_id}"])
    except Exception:
        logger.exception("[embed] upsert failed doc_id=%s", doc_id)
        return None
    return vector_id


def search(
    query: str,
    region_filter: str | None,
    top_k: int,
    province_filter: str | None = None,
    category_filter: str | None = None,
) -> list[int]:
    """Pinecone 하이브리드 검색 → place_id 리스트."""
    index = _get_pinecone_index()
    if not index:
        return []
    dense_vec = embed_text(query)
    sparse_vec = encode_sparse_query(query)
    alpha = _get_search_alpha()
    flt: dict[str, Any] = {}
    if region_filter:
        flt["region"] = {"$eq": region_filter}
    if province_filter:
        flt["province"] = {"$eq": province_filter}
    if category_filter:
        flt["category"] = {"$eq": category_filter}
    try:
        kwargs: dict[str, Any] = {
            "vector": dense_vec,
            "top_k": max(1, min(top_k, 100)),
            "include_metadata": True,
        }
        if sparse_vec:
            try:
                from pinecone_text.hybrid import hybrid_convex_scale

                dense_scaled, sparse_scaled = hybrid_convex_scale(dense_vec, sparse_vec, alpha=alpha)
                kwargs["vector"] = dense_scaled
                kwargs["sparse_vector"] = sparse_scaled
            except Exception:
                # hybrid 스케일링 실패 시에도 dense 검색은 계속 진행
                kwargs["sparse_vector"] = sparse_vec
        if flt:
            kwargs["filter"] = flt
        res = index.query(**kwargs)
    except Exception:
        logger.exception("[embed] hybrid search failed")
        return []
    out: list[int] = []
    for m in res.matches or []:
        meta = getattr(m, "metadata", None) or {}
        pid = meta.get("place_id")
        if pid is not None:
            try:
                out.append(int(pid))
            except (TypeError, ValueError):
                continue
    return out


def search_with_scores(
    query: str,
    region_filter: str | None,
    top_k: int,
    province_filter: str | None = None,
) -> list[tuple[int, float]]:
    """(place_id, Pinecone 유사도 score). place_id 당 최고 점수만 유지."""
    index = _get_pinecone_index()
    if not index:
        return []
    dense_vec = embed_text(query)
    sparse_vec = encode_sparse_query(query)
    alpha = _get_search_alpha()
    flt: dict[str, Any] = {}
    if region_filter:
        flt["region"] = {"$eq": region_filter}
    if province_filter:
        flt["province"] = {"$eq": province_filter}
    mult = max(1, int(os.getenv("GALLERY_PINECONE_QUERY_MULTIPLIER", "4")))
    fetch_k = max(1, min(top_k * mult, 100))
    try:
        kwargs: dict[str, Any] = {
            "vector": dense_vec,
            "top_k": fetch_k,
            "include_metadata": True,
        }
        if sparse_vec:
            try:
                from pinecone_text.hybrid import hybrid_convex_scale

                dense_scaled, sparse_scaled = hybrid_convex_scale(dense_vec, sparse_vec, alpha=alpha)
                kwargs["vector"] = dense_scaled
                kwargs["sparse_vector"] = sparse_scaled
            except Exception:
                kwargs["sparse_vector"] = sparse_vec
        if flt:
            kwargs["filter"] = flt
        res = index.query(**kwargs)
    except Exception:
        logger.exception("[embed] hybrid search_with_scores failed")
        return []
    best: dict[int, float] = {}
    for m in res.matches or []:
        meta = getattr(m, "metadata", None) or {}
        pid = meta.get("place_id")
        if pid is None:
            continue
        try:
            pid_i = int(pid)
            score = float(getattr(m, "score", 0.0) or 0.0)
        except (TypeError, ValueError):
            continue
        prev = best.get(pid_i)
        if prev is None or score > prev:
            best[pid_i] = score
    ranked = sorted(best.items(), key=lambda x: x[1], reverse=True)
    return ranked[:top_k]


def _get_search_alpha() -> float:
    """하이브리드 검색 alpha 값 (dense/sparse 비중)."""
    try:
        return float(os.getenv("PINECONE_SEARCH_ALPHA", "0.7"))
    except ValueError:
        return 0.7
