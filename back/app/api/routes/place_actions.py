from app.repositories import load_regions


def _find_place(rows: list[dict], name: str) -> dict | None:
    name_lower = name.strip().lower()
    for row in rows:
        if name_lower in str(row.get("name", "")).lower():
            return row
    return None


def _row_to_card(row: dict, attributes: list[dict] | None = None) -> dict:
    return {
        "id": int(row["id"]),
        "name": row.get("name", ""),
        "summary": row.get("summary", ""),
        "imageUrl": row.get("imageUrl", ""),
        "address": row.get("address", ""),
        "attributes": attributes or [
            {"label": "지역", "value": row.get("province", row.get("region", ""))},
            {"label": "추천 업종", "value": row.get("recommendedBusinesses", "")},
            {"label": "혼잡 시간대", "value": row.get("busyHours", "")},
            {"label": "예상 고객층", "value": row.get("targetCustomers", "")},
        ],
    }


async def compare_places(place_a: str, place_b: str) -> dict:
    rows = load_regions()
    row_a = _find_place(rows, place_a)
    row_b = _find_place(rows, place_b)
    items = []
    if row_a:
        items.append(_row_to_card(row_a))
    if row_b:
        items.append(_row_to_card(row_b))
    if not items:
        return {"items": [], "message": "해당 장소를 찾을 수 없어요."}
    return {"items": items}


async def show_image_gallery(theme: str, count: int = 9) -> dict:
    rows = load_regions()
    theme_lower = theme.strip().lower()
    matched = [
        row for row in rows
        if theme_lower in str(row.get("name", "")).lower()
        or theme_lower in str(row.get("summary", "")).lower()
        or theme_lower in str(row.get("region", "")).lower()
        or theme_lower in str(row.get("province", "")).lower()
    ]
    images = [
        {
            "id": int(row["id"]),
            "name": row.get("name", ""),
            "imageUrl": row.get("imageUrl", ""),
            "caption": row.get("summary", "")[:60],
        }
        for row in matched[:count]
        if row.get("imageUrl")
    ]
    return {"images": images}
