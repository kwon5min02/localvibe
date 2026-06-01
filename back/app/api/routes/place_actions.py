from app.repositories import load_regions


def _display_field(value: object) -> str:
    """develop PLACES 행: recommendedBusinesses 등이 list[str] 일 수 있음."""
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(str(x) for x in value if str(x).strip())
    return str(value).strip()


def _find_place(rows: list[dict], name: str) -> dict | None:
    name_lower = name.strip().lower()
    if not name_lower:
        return None

    exact: list[dict] = []
    name_hit: list[dict] = []
    geo_hit: list[dict] = []

    for row in rows:
        nm = str(row.get("name", "")).strip().lower()
        if nm == name_lower:
            exact.append(row)
        elif name_lower in nm or nm in name_lower:
            name_hit.append(row)
        else:
            blob = " ".join(
                [
                    str(row.get("address", "")),
                    str(row.get("region", "")),
                    str(row.get("province", "")),
                    str(row.get("summary", ""))[:120],
                ]
            ).lower()
            if name_lower in blob:
                geo_hit.append(row)

    if exact:
        return exact[0]
    if name_hit:
        return name_hit[0]
    if geo_hit:
        return geo_hit[0]
    return None


def _row_to_card(row: dict, attributes: list[dict] | None = None) -> dict:
    rec_disp = _display_field(row.get("recommendedBusinesses"))
    busy_disp = _display_field(row.get("busyHours"))
    target_disp = _display_field(row.get("targetCustomers"))
    region_disp = _display_field(row.get("province")) or _display_field(row.get("region"))

    return {
        "id": int(row["id"]),
        "name": row.get("name", ""),
        "summary": _display_field(row.get("summary")),
        "imageUrl": _display_field(row.get("imageUrl")),
        "address": _display_field(row.get("address")),
        "attributes": attributes
        or [
            {"label": "지역", "value": region_disp},
            {"label": "추천 업종", "value": rec_disp},
            {"label": "혼잡 시간대", "value": busy_disp},
            {"label": "예상 고객층", "value": target_disp},
        ],
    }


async def compare_places(place_a: str, place_b: str) -> dict:
    from app.services.comparison_utils import (
        build_attribute_matrix,
        generate_comparison_summary,
    )

    rows = load_regions()
    if not rows:
        return {"items": [], "message": "아직 불러온 장소 데이터가 없어요. DB·동기화를 확인해 주세요."}
    row_a = _find_place(rows, place_a)
    row_b = _find_place(rows, place_b) if place_b and place_b.strip() else None
    items = []
    if row_a:
        items.append(_row_to_card(row_a))
    if row_b:
        items.append(_row_to_card(row_b))
    if not items:
        return {"items": [], "message": "해당 장소를 찾을 수 없어요."}
    return {
        "items": items,
        "comparisonSummary": generate_comparison_summary(items),
        "matrixRows": build_attribute_matrix(items),
    }


async def show_image_gallery(theme: str, count: int = 9) -> dict:
    rows = load_regions()
    if not rows:
        return {"images": []}
    theme_lower = theme.strip().lower()
    if not theme_lower:
        return {"images": []}
    matched = [
        row
        for row in rows
        if theme_lower in str(row.get("name", "")).lower()
        or theme_lower in str(row.get("summary", "")).lower()
        or theme_lower in str(row.get("region", "")).lower()
        or theme_lower in str(row.get("province", "")).lower()
        or theme_lower in str(row.get("address", "")).lower()
    ]
    images = [
        {
            "id": int(row["id"]),
            "name": row.get("name", ""),
            "imageUrl": row.get("imageUrl", ""),
            "caption": (row.get("summary") or "")[:60],
        }
        for row in matched[:count]
        if row.get("imageUrl")
    ]
    return {"images": images}
