from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from app.repositories import places_store
from app.repositories.db import mysql_url_configured, session_scope
from app.schemas import PlaceArticleResponse, PlaceImageItem, PlaceImagesResponse, PlaceTextItem, PlaceTextsResponse
from app.modules.content.service import get_or_create_article
from app.modules.content.crawler import crawl_naver_blog_for_place

router = APIRouter(prefix="/api/places", tags=["places"])


class PlaceCrawlBody(BaseModel):
    """비우면 DB의 장소명·지역으로 크롤링."""

    name: str | None = Field(None, description="검색 키워드에 쓸 장소명 (기본: PLACES.name)")
    region: str | None = Field(None, description="키워드 보강 (기본: PLACES.region)")


@router.post("/{place_id}/view")
def record_place_view(place_id: int, viewerKey: str = Query(..., min_length=1, max_length=80)):
    """장소 상세를 열었다고 기록합니다. '지금 많이 찾는 장소' 집계에만 씁니다.

    같은 사람이 같은 날 여러 번 열어도 한 번만 셉니다. 로그인 여부와 무관하게
    브라우저가 만든 키를 쓰므로 인증은 요구하지 않습니다.
    """
    if not mysql_url_configured():
        raise HTTPException(status_code=503, detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.")
    with session_scope() as session:
        place = places_store.get_place_by_id(session, place_id)
        if not place:
            raise HTTPException(status_code=404, detail="장소를 찾을 수 없습니다.")
        counted = places_store.record_place_view(
            session, place_id=place_id, viewer_key=viewerKey
        )
    return {"counted": counted}


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
        urls = [str(r.serve_url).strip() for r in rows if r.serve_url]
    return PlaceImagesResponse(
        place_id=place_id,
        images=[PlaceImageItem(url=u) for u in urls],
    )


@router.get("/{place_id}/texts", response_model=PlaceTextsResponse)
def get_place_texts(place_id: int):
    """CRAWLED_TEXTS에 저장된 블로그 텍스트 목록."""
    if not mysql_url_configured():
        raise HTTPException(status_code=503, detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.")
    with session_scope() as session:
        p = places_store.get_place_by_id(session, place_id)
        if not p:
            raise HTTPException(status_code=404, detail="Place not found")
        rows = places_store.list_crawled_texts_for_place(session, place_id)
        items = [
            PlaceTextItem(
                text_id=r.text_id,
                blog_url=r.blog_url,
                blog_title=r.blog_title,
                blogger_name=r.blogger_name,
                post_date=r.post_date,
                description=r.description,
                content=r.content,
                content_length=r.content_length,
            )
            for r in rows
        ]
    return PlaceTextsResponse(place_id=place_id, texts=items)


@router.post("/{place_id}/refresh")
def post_place_refresh(place_id: int, body: PlaceCrawlBody = PlaceCrawlBody()):
    """기존 크롤링 데이터(텍스트+이미지 DB 행)를 삭제하고 재크롤링. 2주~1달 주기 갱신용."""
    import shutil

    from app.modules.content.crawler import IMAGE_SAVE_ROOT

    if not mysql_url_configured():
        raise HTTPException(status_code=503, detail="MySQL(MYSQL_URL)이 설정되지 않았습니다.")
    with session_scope() as session:
        p = places_store.get_place_by_id(session, place_id)
        if not p:
            raise HTTPException(status_code=404, detail="Place not found")
        name = (body.name or p.name or "").strip()
        region = (body.region if body.region is not None else (p.region or "")).strip()
        deleted = places_store.clear_crawled_data_for_place(session, place_id)

    # 이미지 파일 삭제
    img_dir = IMAGE_SAVE_ROOT / str(place_id)
    if img_dir.exists():
        shutil.rmtree(img_dir, ignore_errors=True)

    if not name:
        raise HTTPException(status_code=400, detail="장소명이 비어 있습니다.")

    combined_text, serve_urls = crawl_naver_blog_for_place(name, place_id, region=region)
    return {
        "place_id": place_id,
        "deleted": deleted,
        "text_length": len(combined_text),
        "image_count": len(serve_urls),
        "serve_urls": serve_urls,
    }
