import json
import os
import urllib.parse
import urllib.request
from typing import Optional


KAKAO_ADDRESS_API_URL = "https://dapi.kakao.com/v2/local/search/address.json"


def geocode_address_with_kakao(address: str) -> Optional[tuple[float, float]]:
    query = str(address or "").strip()
    if not query:
        return None

    rest_key = os.getenv("KAKAO_REST_API_KEY", "").strip()
    if not rest_key:
        return None

    params = urllib.parse.urlencode({"query": query, "analyze_type": "similar"})
    url = f"{KAKAO_ADDRESS_API_URL}?{params}"
    headers = {"Authorization": f"KakaoAK {rest_key}"}
    request = urllib.request.Request(url=url, headers=headers, method="GET")

    try:
        with urllib.request.urlopen(request, timeout=5) as response:
            body = response.read().decode("utf-8", errors="ignore")
        payload = json.loads(body)
        documents = payload.get("documents", [])
        if not isinstance(documents, list) or not documents:
            return None
        doc = documents[0] if isinstance(documents[0], dict) else None
        if not doc:
            return None
        x = float(doc.get("x"))
        y = float(doc.get("y"))
        return (y, x)
    except Exception:
        return None
