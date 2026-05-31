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

load_dotenv()
logger = logging.getLogger(__name__)


def _strip_html(text: str) -> str:
    return re.sub(r"<[^>]+>", " ", text)


def _generate_article_with_gpt(
    place_name: str, description: str, blog_blob: str
) -> tuple[str, str]:
    api_key = os.getenv("OPEN_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        title = f"{place_name} 여행 스팟"
        body = (description or "")[:800]
        if blog_blob:
            body = f"{body}\n\n{blog_blob[:1200]}"
        return title, body[:2000]

    client = OpenAI(api_key=api_key)
    system = (
        "당신은 한국 여행 매거진 에디터입니다. "
        "입력된 공식 설명과 블로그 발췌만 바탕으로 한국어 아티클을 작성하세요. "
        "과장·확인되지 않은 사실은 쓰지 마세요.\n\n"
        "아래 JSON 형식으로 반환하세요:\n"
        '{"title": "...", "body": [\n'
        '  {"type": "lead", "text": "..."},\n'
        '  {"type": "subheader", "text": "..."},\n'
        '  {"type": "paragraph", "text": "..."},\n'
        '  {"type": "quote", "text": "...", "attribution": "— 방문객 후기"},\n'
        '  {"type": "paragraph", "text": "..."}\n'
        "]}\n\n"
        "body 구성 규칙:\n"
        "- lead: 1개, 독자를 끌어당기는 첫 문장 (2~3문장)\n"
        "- subheader: 2~3개, 섹션 제목\n"
        "- paragraph: 4~6개, 각 200자 내외\n"
        "- quote: 1개, 방문객 느낌을 담은 인용문"
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
        body = data.get("body")
        if isinstance(body, list) and body:
            content = json.dumps(body, ensure_ascii=False)
        else:
            content = str(data.get("content") or "").strip()
        if not content:
            return title, description or blog_blob[:1000]
        return title, content
    except Exception:
        logger.exception("[article] GPT 실패 place=%s", place_name)
        return f"{place_name} 소개", (description or "")[:1000]


def get_or_create_article(place_id: int) -> dict[str, Any]:
    with session_scope() as session:
        existing = documents_store.get_document_by_place_id(session, place_id)
        if existing and existing.content:
            return {
                "place_id": place_id,
                "doc_id": existing.doc_id,
                "title": existing.title or "",
                "content": existing.content or "",
                "pinecone_id": existing.pinecone_id,
                "cached": True,
            }

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

    title, content = _generate_article_with_gpt(pname, pdesc, blog_blob)

    with session_scope() as session:
        dup = documents_store.get_document_by_place_id(session, place_id)
        if dup and dup.content:
            return {
                "place_id": place_id,
                "doc_id": dup.doc_id,
                "title": dup.title or "",
                "content": dup.content or "",
                "pinecone_id": dup.pinecone_id,
                "cached": True,
            }

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

    return {
        "place_id": place_id,
        "doc_id": doc_id,
        "title": title,
        "content": content,
        "pinecone_id": final_pinecone_id,
        "cached": False,
    }
