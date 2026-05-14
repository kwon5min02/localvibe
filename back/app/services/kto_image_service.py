"""KTO detailImage2 등 온디맨드 이미지 URL 조회 (DB 비저장)."""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

logger = logging.getLogger(__name__)

KTO_DEFAULT_BASE_URL = "https://apis.data.go.kr/B551011/KorService2"


def _fetch_json(url: str, params: dict[str, str]) -> dict[str, Any]:
    request_url = f"{url}?{urllib.parse.urlencode(params)}"
    timeout = int(os.getenv("JN_API_TIMEOUT_SECONDS", "12"))
    req = urllib.request.Request(url=request_url, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read().decode("utf-8", errors="ignore")
    return json.loads(body)


def fetch_detail_image_urls(content_id: str, content_type_id: str | None = None) -> list[str]:
    """contentId 기준 KTO detailImage2 이미지 URL 목록."""
    service_key = os.getenv("KTO_SERVICE_KEY", "").strip()
    if not service_key or not content_id:
        return []

    base = os.getenv("KTO_API_BASE_URL", KTO_DEFAULT_BASE_URL).rstrip("/")
    endpoint = f"{base}/detailImage2"
    params = {
        "serviceKey": service_key,
        "MobileOS": os.getenv("KTO_MOBILE_OS", "ETC"),
        "MobileApp": os.getenv("KTO_MOBILE_APP", "LocalVibe"),
        "_type": "json",
        "contentId": content_id,
        "imageYN": "Y",
        "pageNo": "1",
        "numOfRows": "50",
    }
    if content_type_id:
        params["contentTypeId"] = content_type_id
    try:
        payload = _fetch_json(endpoint, params)
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
        logger.warning("[KTO] detailImage failed contentId=%s err=%s", content_id, e)
        return []

    header = payload.get("response", {}).get("header", {})
    code = str(header.get("resultCode", "")).strip()
    if code and code not in {"0000", "00"}:
        return []

    items = payload.get("response", {}).get("body", {}).get("items", {})
    item = items.get("item", [])
    if isinstance(item, dict):
        item = [item]
    urls: list[str] = []
    for row in item:
        if not isinstance(row, dict):
            continue
        for key in ("originimgurl", "imgname", "smallimageurl", "originimgUrl", "imgUrl"):
            u = str(row.get(key) or "").strip()
            if u.startswith("http"):
                urls.append(u)
        for k, v in row.items():
            if isinstance(v, str) and v.startswith("http") and "img" in str(k).lower():
                urls.append(v)
    return list(dict.fromkeys(urls))
