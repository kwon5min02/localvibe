from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.repositories import places_store
from app.repositories.db import mysql_url_configured, session_scope
from app.schemas import PlaceArticleResponse, PlaceImageItem, PlaceImagesResponse
from app.services.article_service import get_or_create_article
from app.services.naverBlog_crawling import crawl_place_on_demand

router = APIRouter(prefix="/api/places", tags=["places"])


class PlaceCrawlBody(BaseModel):
    """비우면 DB의 장소명·지역으로 크롤링."""

    name: str | None = Field(None, description="검색 키워드에 쓸 장소명 (기본: PLACES.name)")
    region: str | None = Field(None, description="키워드 보강 (기본: PLACES.region)")


@router.get("/{place_id}/article", response_model=PlaceArticleResponse)
def get_place_article(place_id: int):
    if not mysql_url_configured():
        raise HTTPException(status_code=503, detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.")
    try:
        data = get_or_create_article(place_id)
        return PlaceArticleResponse(**data)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail="아티클 생성 실패") from e


@router.post("/{place_id}/crawl")
def post_place_crawl(place_id: int, body: PlaceCrawlBody = PlaceCrawlBody()):
    """모달 등에서 온디맨드: 네이버 블로그 이미지 크롤 → 로컬 저장 + CRAWLED_IMAGES."""
    if not mysql_url_configured():
        raise HTTPException(status_code=503, detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.")
    with session_scope() as session:
        p = places_store.get_place_by_id(session, place_id)
        if not p:
            raise HTTPException(status_code=404, detail="Place not found")
        name = (body.name or p.name or "").strip()
        region = (body.region if body.region is not None else (p.region or "")).strip()
    if not name:
        raise HTTPException(status_code=400, detail="장소명이 비어 있습니다.")
    saved = crawl_place_on_demand(place_id, name, region)
    return {
        "place_id": place_id,
        "count": len(saved),
        "serve_urls": [s.get("serve_url", "") for s in saved if s.get("serve_url")],
    }


@router.get("/{place_id}/images", response_model=PlaceImagesResponse)
def get_place_images(place_id: int):
    """CRAWLED_IMAGES에 저장된 이미지(정적 서빙 URL)."""
    if not mysql_url_configured():
        raise HTTPException(status_code=503, detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.")
    with session_scope() as session:
        p = places_store.get_place_by_id(session, place_id)
        if not p:
            raise HTTPException(status_code=404, detail="Place not found")
        rows = places_store.list_crawled_images_for_place(session, place_id)
    urls = [r.serve_url for r in rows if r.serve_url]
    return PlaceImagesResponse(
        place_id=place_id,
        images=[PlaceImageItem(url=u) for u in urls],
    )
