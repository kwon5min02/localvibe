"""PLACES, CRAWLED_IMAGES ORM 및 CRUD."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import BigInteger, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint, or_, select
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.repositories.db import Base

logger = logging.getLogger(__name__)


class Place(Base):
    __tablename__ = "places"
    __table_args__ = (UniqueConstraint("name", "region", name="uq_places_name_region"),)

    place_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    content_id: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(512), nullable=False)
    category: Mapped[str | None] = mapped_column(String(128), nullable=True)
    region: Mapped[str | None] = mapped_column(String(256), nullable=True)
    province: Mapped[str | None] = mapped_column(String(256), nullable=True)
    address: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(String(256), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 마이그레이션·채팅 휴리스틱용 (스펙 외 보조 필드)
    insight_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    crawled_images: Mapped[list["CrawledImage"]] = relationship(
        "CrawledImage", back_populates="place", cascade="all, delete-orphan"
    )


class CrawledImage(Base):
    __tablename__ = "crawled_images"

    image_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    place_id: Mapped[int] = mapped_column(BigInteger, ForeignKey("places.place_id", ondelete="CASCADE"), nullable=False, index=True)
    source_url: Mapped[str | None] = mapped_column(String(2048), nullable=True)
    local_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    serve_url: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    crawled_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    place: Mapped[Place] = relationship("Place", back_populates="crawled_images")


def _deserialize_insight(insight_json: str | None) -> tuple[list[str], list[str], list[str]]:
    if not insight_json:
        return [], [], []
    try:
        data = json.loads(insight_json)
        if not isinstance(data, dict):
            return [], [], []
        rb = data.get("recommendedBusinesses") or []
        bh = data.get("busyHours") or []
        tc = data.get("targetCustomers") or []
        return (
            [str(x) for x in rb] if isinstance(rb, list) else [],
            [str(x) for x in bh] if isinstance(bh, list) else [],
            [str(x) for x in tc] if isinstance(tc, list) else [],
        )
    except Exception:
        return [], [], []


def place_to_region_dict(
    place: Place,
    *,
    primary_image_url: str = "",
    summary_short: str | None = None,
) -> dict[str, Any]:
    rec, busy, targets = _deserialize_insight(place.insight_json)
    if not rec and place.category:
        rec = [place.category]
    ss = summary_short if summary_short is not None else get_summary_short_from_insight(place.insight_json)
    return {
        "id": int(place.place_id),
        "sourceId": place.content_id or "",
        "name": place.name or "",
        "region": place.region or "",
        "province": place.province or "",
        "address": place.address or "",
        "latitude": place.latitude,
        "longitude": place.longitude,
        "imageUrl": primary_image_url or "",
        "summary": place.description or "",
        "summaryShort": ss or None,
        "recommendedBusinesses": rec,
        "busyHours": busy,
        "targetCustomers": targets,
        "dataSource": place.source,
    }


def get_place_by_id(session, place_id: int) -> Place | None:
    return session.get(Place, place_id)


def find_place_ids_for_locality_hints(session, keywords: list[str], *, limit: int = 120) -> list[int]:
    """
    검색어에 포함된 지명(예: 여수)과 연관된 장소 id.
    region/province/address/name에 부분 문자열이 있으면 후보에 포함합니다.
    """
    kws = [str(k).strip() for k in keywords if len(str(k).strip()) >= 2][:16]
    if not kws:
        return []
    conds = []
    for kw in kws:
        like = f"%{kw}%"
        conds.append(Place.name.like(like))
        conds.append(Place.region.like(like))
        conds.append(Place.province.like(like))
        conds.append(Place.address.like(like))
    stmt = select(Place.place_id).where(or_(*conds)).distinct().limit(limit)
    rows = session.execute(stmt).scalars().all()
    return [int(r) for r in rows]


def get_as_region_dict(session, place_id: int) -> dict[str, Any] | None:
    p = get_place_by_id(session, place_id)
    if not p:
        return None
    img = _first_crawled_serve_url(session, place_id)
    return place_to_region_dict(p, primary_image_url=img or "")


def _first_crawled_serve_url(session, place_id: int) -> str | None:
    stmt = (
        select(CrawledImage.serve_url)
        .where(CrawledImage.place_id == place_id)
        .where(CrawledImage.serve_url.isnot(None))
        .order_by(CrawledImage.image_id.asc())
        .limit(1)
    )
    row = session.execute(stmt).scalar_one_or_none()
    return str(row).strip() if row else None


def list_places_as_region_dicts(session) -> list[dict[str, Any]]:
    places = session.execute(select(Place).order_by(Place.place_id.desc())).scalars().all()
    if not places:
        return []
    ids = [p.place_id for p in places]
    first_by_place: dict[int, str] = {}
    for pid in ids:
        u = _first_crawled_serve_url(session, pid)
        if u:
            first_by_place[pid] = u
    return [place_to_region_dict(p, primary_image_url=first_by_place.get(p.place_id, "")) for p in places]


def upsert_place_from_legacy_row(session, row: dict[str, Any]) -> Place:
    """기존 regions 형태 dict → PLACES upsert (place_id = row['id'] 우선)."""
    try:
        legacy_id = int(row["id"])
    except Exception:
        raise ValueError("legacy row must have int id") from None

    insight = {
        "recommendedBusinesses": row.get("recommendedBusinesses") or [],
        "busyHours": row.get("busyHours") or [],
        "targetCustomers": row.get("targetCustomers") or [],
    }
    insight_json = json.dumps(insight, ensure_ascii=False)

    existing = session.get(Place, legacy_id)
    name = str(row.get("name") or "").strip()
    region = str(row.get("region") or "").strip() or None
    province = str(row.get("province") or "").strip() or None
    address = str(row.get("address") or "").strip() or None
    lat = row.get("latitude")
    lng = row.get("longitude")
    lat_f = float(lat) if lat is not None and str(lat).strip() != "" else None
    lng_f = float(lng) if lng is not None and str(lng).strip() != "" else None

    content_id = str(row.get("sourceId") or "").strip() or None
    description = str(row.get("summary") or "").strip() or None
    source = str(row.get("dataSource") or "").strip() or None
    category = None
    rb = row.get("recommendedBusinesses")
    if isinstance(rb, list) and rb:
        category = str(rb[0])

    now = datetime.utcnow()
    if existing:
        existing.content_id = content_id or existing.content_id
        existing.name = name or existing.name
        existing.category = category or existing.category
        existing.region = region
        existing.province = province
        existing.address = address
        if lat_f is not None:
            existing.latitude = lat_f
        if lng_f is not None:
            existing.longitude = lng_f
        existing.description = description or existing.description
        existing.source = source or existing.source
        existing.insight_json = insight_json
        existing.created_at = existing.created_at or now
        session.flush()
        return existing

    # 동일 name+region 다른 id 충돌 시 기존 행 갱신
    if name and region:
        stmt = select(Place).where(Place.name == name, Place.region == region)
        other = session.execute(stmt).scalar_one_or_none()
        if other and other.place_id != legacy_id:
            logger.warning(
                "[places] name+region duplicate legacy_id=%s existing_id=%s name=%s",
                legacy_id,
                other.place_id,
                name,
            )

    place = Place(
        place_id=legacy_id,
        content_id=content_id,
        name=name or "(이름없음)",
        category=category,
        region=region,
        province=province,
        address=address,
        latitude=lat_f,
        longitude=lng_f,
        description=description,
        source=source,
        created_at=now,
        insight_json=insight_json,
    )
    session.add(place)
    session.flush()
    return place


def upsert_place_from_pipeline_dict(session, data: dict[str, Any]) -> Place:
    """data_pipeline clean 출력: content_id, name, category, region, province, address, latitude, longitude, description, source."""
    content_id = data.get("content_id")
    name = str(data.get("name") or "").strip()
    region = str(data.get("region") or "").strip() or None
    stmt = select(Place).where(Place.name == name)
    if region:
        stmt = stmt.where(Place.region == region)
    existing = session.execute(stmt).scalar_one_or_none()
    now = datetime.utcnow()
    if existing:
        existing.content_id = content_id or existing.content_id
        existing.category = data.get("category") or existing.category
        existing.province = data.get("province") or existing.province
        existing.address = data.get("address") or existing.address
        if data.get("latitude") is not None:
            existing.latitude = float(data["latitude"])
        if data.get("longitude") is not None:
            existing.longitude = float(data["longitude"])
        existing.description = data.get("description") or existing.description
        existing.source = data.get("source") or existing.source
        session.flush()
        return existing

    place = Place(
        content_id=content_id,
        name=name or "(이름없음)",
        category=data.get("category"),
        region=region,
        province=data.get("province"),
        address=data.get("address"),
        latitude=float(data["latitude"]) if data.get("latitude") is not None else None,
        longitude=float(data["longitude"]) if data.get("longitude") is not None else None,
        description=data.get("description"),
        source=data.get("source"),
        created_at=now,
        insight_json=None,
    )
    session.add(place)
    session.flush()
    return place


def update_summary_short(session, place_id: int, summary_short: str) -> None:
    """summary_short는 Region 스키마용 — insight_json에 보관."""
    p = session.get(Place, place_id)
    if not p:
        return
    rec, busy, targets = _deserialize_insight(p.insight_json)
    payload = {
        "summaryShort": summary_short,
        "recommendedBusinesses": rec,
        "busyHours": busy,
        "targetCustomers": targets,
    }
    if p.insight_json:
        try:
            base = json.loads(p.insight_json)
            if isinstance(base, dict):
                base.update(payload)
                p.insight_json = json.dumps(base, ensure_ascii=False)
            else:
                p.insight_json = json.dumps(payload, ensure_ascii=False)
        except Exception:
            p.insight_json = json.dumps(payload, ensure_ascii=False)
    else:
        p.insight_json = json.dumps(payload, ensure_ascii=False)
    session.flush()


def update_coordinates(session, place_id: int, latitude: float, longitude: float) -> None:
    p = session.get(Place, place_id)
    if not p:
        return
    p.latitude = float(latitude)
    p.longitude = float(longitude)
    session.flush()


def get_summary_short_from_insight(insight_json: str | None) -> str:
    if not insight_json:
        return ""
    try:
        data = json.loads(insight_json)
        if isinstance(data, dict):
            return str(data.get("summaryShort") or "").strip()
    except Exception:
        pass
    return ""


def bulk_upsert_legacy_regions(session, rows: list[dict[str, Any]]) -> None:
    for row in rows:
        try:
            with session.begin_nested():
                upsert_place_from_legacy_row(session, row)
        except Exception:
            logger.exception("[places] upsert legacy row failed")


def list_places_by_ids_ordered(session, place_ids: list[int]) -> list[dict[str, Any]]:
    if not place_ids:
        return []
    places = session.execute(select(Place).where(Place.place_id.in_(place_ids))).scalars().all()
    by_id = {p.place_id: p for p in places}
    out: list[dict[str, Any]] = []
    for pid in place_ids:
        p = by_id.get(pid)
        if p:
            ss = get_summary_short_from_insight(p.insight_json)
            img = _first_crawled_serve_url(session, pid) or ""
            out.append(place_to_region_dict(p, primary_image_url=img, summary_short=ss or None))
    return out


def add_crawled_image(
    session,
    *,
    place_id: int,
    source_url: str | None,
    local_path: str,
    serve_url: str,
) -> CrawledImage:
    row = CrawledImage(
        place_id=place_id,
        source_url=source_url,
        local_path=local_path,
        serve_url=serve_url,
        crawled_at=datetime.utcnow(),
    )
    session.add(row)
    session.flush()
    return row


def crawled_image_exists(session, *, place_id: int, source_url: str | None) -> bool:
    if not source_url:
        return False
    stmt = (
        select(CrawledImage.image_id)
        .where(CrawledImage.place_id == place_id, CrawledImage.source_url == source_url)
        .limit(1)
    )
    return session.execute(stmt).scalar_one_or_none() is not None


def list_crawled_images_for_place(session, place_id: int) -> list[CrawledImage]:
    stmt = (
        select(CrawledImage)
        .where(CrawledImage.place_id == place_id).order_by(CrawledImage.image_id.asc())
    )
    return list(session.execute(stmt).scalars().all())


def list_all_places(session) -> list[Place]:
    return list(session.execute(select(Place).order_by(Place.place_id.asc())).scalars().all())
