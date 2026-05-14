"""Sentence-Transformers 임베딩 및 Pinecone upsert/검색."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)

_model = None
_pinecone_index = None
_pinecone_client = None


def _get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        name = os.getenv(
            "EMBEDDING_MODEL_NAME",
            "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
        )
        logger.info("[embed] loading model %s", name)
        _model = SentenceTransformer(name)
    return _model


def _get_pinecone_index():
    global _pinecone_index, _pinecone_client
    if _pinecone_index is not None:
        return _pinecone_index
    api_key = os.getenv("PINECONE_API_KEY", "").strip()
    if not api_key:
        return None
    index_name = os.getenv("PINECONE_INDEX", "localvibe-places").strip()
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


def build_place_embed_text(
    *,
    place_name: str,
    category: str | None,
    region: str | None,
    province: str | None,
    address: str | None,
    description: str | None,
) -> str:
    """MySQL PLACES 행만으로 의미 검색용 텍스트 블록."""
    parts = [
        place_name or "",
        category or "",
        region or "",
        province or "",
        address or "",
        (description or "")[:4000],
    ]
    return " \n".join(p for p in parts if p.strip())


def embed_place_bootstrap_upsert(
    *,
    place_id: int,
    place_name: str,
    category: str | None,
    region: str | None,
    province: str | None,
    address: str | None,
    description: str | None,
) -> str | None:
    """
    PLACES 메타만으로 Pinecone 벡터 upsert (id=place_{place_id}).
    아티클(doc_*) 생성 시 동일 place 의 place_* 벡터는 삭제하는 편이 안전.
    """
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
    )
    if not body.strip():
        return None
    vector_id = f"place_{place_id}"
    values = embed_text(body)
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
        index.upsert(vectors=[{"id": vector_id, "values": values, "metadata": metadata}])
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
    """Pinecone upsert 후 벡터 id 반환. 실패 시 None."""
    index = _get_pinecone_index()
    if not index:
        return None
    vector_id = f"doc_{doc_id}"
    values = embed_text(article_text)
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
        index.upsert(vectors=[{"id": vector_id, "values": values, "metadata": metadata}])
        # 동일 장소의 PLACES-only 벡터 제거 → 검색 시 doc 기준 한 벡터만 유지
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
    """Pinecone 유사도 검색 → place_id 리스트."""
    index = _get_pinecone_index()
    if not index:
        return []
    query_vec = embed_text(query)
    flt: dict[str, Any] = {}
    if region_filter:
        flt["region"] = {"$eq": region_filter}
    if province_filter:
        flt["province"] = {"$eq": province_filter}
    if category_filter:
        flt["category"] = {"$eq": category_filter}
    try:
        kwargs: dict[str, Any] = {
            "vector": query_vec,
            "top_k": max(1, min(top_k, 100)),
            "include_metadata": True,
        }
        if flt:
            kwargs["filter"] = flt
        res = index.query(**kwargs)
    except Exception:
        logger.exception("[embed] query failed")
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
    """(place_id, Pinecone 유사도 score). place_* / doc_* 중복 시 place_id 당 최고 점수만 유지."""
    index = _get_pinecone_index()
    if not index:
        return []
    query_vec = embed_text(query)
    flt: dict[str, Any] = {}
    if region_filter:
        flt["region"] = {"$eq": region_filter}
    if province_filter:
        flt["province"] = {"$eq": province_filter}
    mult = max(1, int(os.getenv("GALLERY_PINECONE_QUERY_MULTIPLIER", "4")))
    fetch_k = max(1, min(top_k * mult, 100))
    try:
        kwargs: dict[str, Any] = {
            "vector": query_vec,
            "top_k": fetch_k,
            "include_metadata": True,
        }
        if flt:
            kwargs["filter"] = flt
        res = index.query(**kwargs)
    except Exception:
        logger.exception("[embed] query failed")
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
