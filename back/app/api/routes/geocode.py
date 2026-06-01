from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from app.services.geocode_service import geocode_address_with_kakao

router = APIRouter(prefix="/api", tags=["geocode"])


class GeocodeItem(BaseModel):
    id: Optional[int | str] = None
    address: str = ""


class GeocodeBatchRequest(BaseModel):
    items: list[GeocodeItem] = Field(default_factory=list, max_length=30)


class GeocodeResult(BaseModel):
    id: Optional[int | str] = None
    address: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    ok: bool = False


@router.post("/geocode/batch")
def geocode_batch(body: GeocodeBatchRequest):
    results: list[GeocodeResult] = []
    for item in body.items:
        addr = str(item.address or "").strip()
        if not addr:
            results.append(
                GeocodeResult(id=item.id, address=addr, ok=False),
            )
            continue
        coords = geocode_address_with_kakao(addr)
        if coords:
            lat, lng = coords
            results.append(
                GeocodeResult(
                    id=item.id,
                    address=addr,
                    latitude=lat,
                    longitude=lng,
                    ok=True,
                ),
            )
        else:
            results.append(
                GeocodeResult(id=item.id, address=addr, ok=False),
            )
    return {"results": results}
