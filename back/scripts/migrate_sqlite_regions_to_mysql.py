"""
SQLite regions → MySQL PLACES 마이그레이션 (1회 실행).

사용:
  MYSQL_URL=mysql+pymysql://user:pw@host:3306/dbname python -m scripts.migrate_sqlite_regions_to_mysql
"""

from __future__ import annotations

import json
import os
import sqlite3
import sys
from pathlib import Path

# back 루트를 path에 추가
BACK_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACK_ROOT))

os.chdir(BACK_ROOT)


def main() -> None:
    if not os.getenv("MYSQL_URL", "").strip():
        print("MYSQL_URL이 필요합니다.")
        sys.exit(1)

    from app.repositories.db import init_db, session_scope
    from app.repositories import places_store
    from app.repositories.regions_store import _db_path  # noqa: SLF001

    init_db()

    db_path = _db_path()
    if not db_path.exists():
        print(f"SQLite 파일 없음: {db_path}")
        sys.exit(1)

    rows: list[dict] = []
    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        for row in conn.execute("SELECT * FROM regions").fetchall():
            rows.append(
                {
                    "id": int(row["id"]),
                    "sourceId": row["source_id"] or "",
                    "name": row["name"] or "",
                    "region": row["region"] or "",
                    "province": row["province"] or "",
                    "address": row["address"] or "",
                    "latitude": row["latitude"],
                    "longitude": row["longitude"],
                    "imageUrl": row["image_url"] or "",
                    "summary": row["summary"] or "",
                    "summaryShort": row["summary_short"] or "",
                    "recommendedBusinesses": json.loads(row["recommended_businesses_json"] or "[]"),
                    "busyHours": json.loads(row["busy_hours_json"] or "[]"),
                    "targetCustomers": json.loads(row["target_customers_json"] or "[]"),
                    "dataSource": row["data_source"] or "",
                }
            )

    with session_scope() as session:
        places_store.bulk_upsert_legacy_regions(session, rows)
    print(f"마이그레이션 완료: {len(rows)}건")


if __name__ == "__main__":
    main()
