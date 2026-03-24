from fastapi import HTTPException

from app.repositories import get_region_by_id, load_regions
from app.schemas import Region, RegionInsight


def list_regions() -> list[Region]:
    region_rows = load_regions()
    return [
        Region(
            id=row["id"],
            name=row["name"],
            imageUrl=row["imageUrl"],
            summary=row["summary"],
            dataSource=row.get("dataSource"),
        )
        for row in region_rows
    ]


def get_region_insight(region_id: int) -> RegionInsight:
    matched = get_region_by_id(region_id)
    if not matched:
        raise HTTPException(status_code=404, detail="Region not found")

    return RegionInsight(**matched)
