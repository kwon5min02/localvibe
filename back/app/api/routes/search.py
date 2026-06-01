from fastapi import APIRouter, Query

from app.schemas import GallerySearchItem, GallerySearchResponse
from app.services.search_service import search_gallery

router = APIRouter(prefix="/api/search", tags=["search"])


@router.get("", response_model=GallerySearchResponse)
def gallery_search(q: str = Query(..., min_length=1), region: str | None = Query(None)):
    rows = search_gallery(q, region)
    return GallerySearchResponse(
        results=[
            GallerySearchItem(
                place_id=r["place_id"],
                name=r["name"],
                imageUrl=r.get("imageUrl"),
                region=r.get("region"),
                province=r.get("province"),
                category=r.get("category"),
                score=float(r["score"]),
                pinecone_similarity=r.get("pinecone_similarity"),
            )
            for r in rows
        ]
    )
