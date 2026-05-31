"""갤러리 아티클: DOCUMENTS 캐시 + 사전 크롤링 텍스트 + PLACES 정보 + GPT + 임베딩."""

from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from dotenv import load_dotenv
from openai import OpenAI

from app.repositories import documents_store, places_store, trends_store
from app.repositories.db import session_scope
from app.services import embedding_service
from app.services.article_blocks import content_to_blocks, serialize_structured_article

load_dotenv()
logger = logging.getLogger(__name__)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


def _generate_article_with_gpt(
    place_name: str, description: str, blog_blob: str
) -> tuple[str, str, list[dict]]:
    api_key = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        title = f"{place_name} 여행 스팟"
        body = (description or "")[:800]
        if blog_blob:
            body = f"{body}\n\n{blog_blob[:1200]}"
        return title, body[:2000], content_to_blocks(body[:2000])

    client = OpenAI(api_key=api_key)
    system = (
        "당신은 한국 여행 매거진 에디터입니다. "
        "입력된 공식 설명과 블로그 발췌만 바탕으로 한국어 아티클을 작성하세요. "
        "과장·확인되지 않은 사실은 쓰지 마세요. "
        "반드시 JSON 한 개로만 응답하세요. 필드: "
        "title(제목), lead(2문장 이내 도입), "
        "sections(배열: {heading, paragraphs[]}), "
        "quote(선택: {text, attribution}), "
        "visit_tip(선택: 방문·예약·혼잡 팁 한 단락). "
        "sections는 3~5개, heading 예: '분위기 & 뷰', '추천 메뉴', '영업 시간', '주차 & 오시는 길'."
    )
    user = (
        f"장소명: {place_name}\n"
        f"공식/요약 설명:\n{description or '없음'}\n\n"
        f"블로그 발췌:\n{_strip_html(blog_blob)[:4000]}"
    )
    try:
        resp = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.4,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
        )
        raw = resp.choices[0].message.content or "{}"
        data = json.loads(raw)
        title = str(data.get("title") or f"{place_name} 소개").strip()
        lead = str(data.get("lead") or "").strip()
        sections = data.get("sections") if isinstance(data.get("sections"), list) else []
        quote = data.get("quote") if isinstance(data.get("quote"), dict) else None
        visit_tip = str(data.get("visit_tip") or "").strip()

        if lead or sections:
            content = serialize_structured_article(
                title, lead, sections, quote=quote, visit_tip=visit_tip
            )
            blocks = content_to_blocks(content)
            return title, content, blocks

        content = str(data.get("content") or "").strip()
        if not content:
            fallback = (description or "")[:1000] or blog_blob[:1000]
            return title, fallback, content_to_blocks(fallback)
        return title, content, content_to_blocks(content)
    except Exception:
        logger.exception("[article] GPT 실패 place=%s", place_name)
        fallback = (description or "")[:1000]
        return f"{place_name} 소개", fallback, content_to_blocks(fallback)


def _article_response_payload(
    place_id: int,
    doc_id: int,
    title: str,
    content: str,
    *,
    pinecone_id: str | None = None,
    cached: bool = False,
) -> dict[str, Any]:
    return {
        "place_id": place_id,
        "doc_id": doc_id,
        "title": title or "",
        "content": content or "",
        "blocks": content_to_blocks(content or ""),
        "pinecone_id": pinecone_id,
        "cached": cached,
    }


def get_or_create_article(place_id: int) -> dict[str, Any]:
    with session_scope() as session:
        existing = documents_store.get_document_by_place_id(session, place_id)
        if existing and existing.content:
            return _article_response_payload(
                place_id,
                existing.doc_id,
                existing.title or "",
                existing.content or "",
                pinecone_id=existing.pinecone_id,
                cached=True,
            )

        place = places_store.get_place_by_id(session, place_id)
        if not place:
            raise ValueError("place not found")

        trends_store.upsert_trend_row(
            session,
            place_id=place_id,
            keyword=place.name or "",
            crawl_delta=1,
        )

        pname = place.name or ""
        pdesc = place.description or ""
        pcat = place.category
        preg = place.region
        pprov = place.province

        crawled_texts = places_store.list_crawled_texts_for_place(session, place_id)
        blog_blob = "\n\n".join(
            str(r.content)[:4000] for r in crawled_texts if r.content
        )

    title, content, _blocks = _generate_article_with_gpt(pname, pdesc, blog_blob)

    with session_scope() as session:
        dup = documents_store.get_document_by_place_id(session, place_id)
        if dup and dup.content:
            return _article_response_payload(
                place_id,
                dup.doc_id,
                dup.title or "",
                dup.content or "",
                pinecone_id=dup.pinecone_id,
                cached=True,
            )

        place = places_store.get_place_by_id(session, place_id)
        if not place:
            raise ValueError("place not found")

        doc = documents_store.get_document_by_place_id(session, place_id)
        if doc:
            documents_store.update_document_content(
                session, doc, title=title, content=content
            )
            doc_id = doc.doc_id
        else:
            doc = documents_store.create_document(
                session, place_id=place_id, title=title, content=content
            )
            doc_id = doc.doc_id

        vec_id = embedding_service.embed_and_upsert(
            doc_id=doc_id,
            place_id=place_id,
            article_text=content,
            place_name=place.name or "",
            category=place.category,
            region=place.region,
            province=place.province,
        )
        if vec_id:
            documents_store.set_pinecone_id(session, doc_id, vec_id)

        final_doc = documents_store.get_document_by_place_id(session, place_id)
        final_pinecone_id = final_doc.pinecone_id if final_doc else vec_id

    return _article_response_payload(
        place_id,
        doc_id,
        title,
        content,
        pinecone_id=final_pinecone_id,
        cached=False,
    )
