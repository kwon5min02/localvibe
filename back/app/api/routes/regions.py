from fastapi import APIRouter

from app.schemas import RegionInsightResponse, RegionKtoImagesResponse, RegionListResponse
from app.services import get_region_insight, list_region_kto_image_urls, list_regions


router = APIRouter(prefix="/api/regions", tags=["regions"])


@router.get("", response_model=RegionListResponse)
def get_regions():
    return {"regions": list_regions()}


@router.get("/{region_id}/kto-images", response_model=RegionKtoImagesResponse)
def get_region_kto_images(region_id: int):
    return {"urls": list_region_kto_image_urls(region_id)}


@router.get("/{region_id}/insight", response_model=RegionInsightResponse)
def get_region_detail(region_id: int):
    return {"region": get_region_insight(region_id)}
