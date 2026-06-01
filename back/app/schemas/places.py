from pydantic import BaseModel, Field
from typing import Optional


class PlaceArticleResponse(BaseModel):
    place_id: int
    doc_id: int
    title: str
    content: str
    pinecone_id: Optional[str] = None
    cached: bool = False


class PlaceImageItem(BaseModel):
    url: str


class PlaceImagesResponse(BaseModel):
    place_id: int
    images: list[PlaceImageItem]


class PlaceTextItem(BaseModel):
    text_id: int
    blog_url: Optional[str] = None
    blog_title: Optional[str] = None
    blogger_name: Optional[str] = None
    post_date: Optional[str] = None
    description: Optional[str] = None
    content: Optional[str] = None
    content_length: Optional[int] = None


class PlaceTextsResponse(BaseModel):
    place_id: int
    texts: list[PlaceTextItem]


class GallerySearchItem(BaseModel):
    place_id: int
    name: str
    region: Optional[str] = None
    province: Optional[str] = None
    category: Optional[str] = None
    score: float = Field(..., description="최종 랭킹 (Pinecone 유사도 + 트렌드·지역 가중)")
    pinecone_similarity: Optional[float] = Field(
        None, description="Pinecone 쿼리 원시 유사도(인덱스 메트릭에 따라 스케일 상이)"
    )


class GallerySearchResponse(BaseModel):
    results: list[GallerySearchItem]
