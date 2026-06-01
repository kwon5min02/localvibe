#!/usr/bin/env python3
"""
insight_json.ktoImageUrl 에 들어간 Unsplash placeholder URL 제거 (1회 실행).

  cd back && PYTHONPATH=. python scripts/clear_placeholder_kto_images.py
  cd back && PYTHONPATH=. python scripts/clear_placeholder_kto_images.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import os
import sys

BACK = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if BACK not in sys.path:
    sys.path.insert(0, BACK)

from dotenv import load_dotenv

load_dotenv(os.path.join(BACK, ".env"), override=True)

from app.services.media_utils import is_placeholder_image_url


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="변경 없이 개수만 출력")
    args = parser.parse_args()

    if not os.getenv("MYSQL_URL", "").strip():
        print("MYSQL_URL이 없습니다.")
        sys.exit(1)

    from app.repositories.db import session_scope
    from app.repositories.places_store import Place
    from sqlalchemy import select

    cleared = 0
    scanned = 0
    with session_scope() as session:
        places = list(session.execute(select(Place.place_id, Place.insight_json)).all())
        for place_id, insight_json in places:
            scanned += 1
            if not insight_json:
                continue
            try:
                data = json.loads(insight_json)
            except Exception:
                continue
            if not isinstance(data, dict):
                continue
            kto = str(data.get("ktoImageUrl") or "").strip()
            if not kto or not is_placeholder_image_url(kto):
                continue
            cleared += 1
            if args.dry_run:
                continue
            data["ktoImageUrl"] = ""
            row = session.get(Place, int(place_id))
            if row:
                row.insight_json = json.dumps(data, ensure_ascii=False)

    mode = "dry-run" if args.dry_run else "applied"
    print(f"[{mode}] scanned={scanned} cleared_placeholder_kto={cleared}")


if __name__ == "__main__":
    main()
