"""크롤링 배치 스케줄러.

- crawl_all_places(): 전체 place 순회 → 기존 데이터 삭제 후 재크롤링
- start_scheduler(): APScheduler로 2주 주기 자동 실행 (서버 lifespan에서 호출)
- 수동 실행: python -m app.services.crawl_scheduler
"""

from __future__ import annotations

import logging
import os
import shutil
import time

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

CRAWL_INTERVAL_WEEKS = int(os.getenv("CRAWL_INTERVAL_WEEKS", "2"))
# place 간 딜레이 (초) — 네이버 API 호출 제한 방어
PLACE_DELAY_SECONDS = float(os.getenv("CRAWL_PLACE_DELAY", "3"))


def crawl_all_places() -> dict:
    """전체 place를 순회하며 크롤링 데이터를 갱신."""
    from app.repositories import places_store
    from app.repositories.db import session_scope
    from app.services.naverBlog_crawling import IMAGE_SAVE_ROOT, crawl_naver_blog_for_place

    logger.info("[crawl_batch] 전체 place 크롤링 시작")

    with session_scope() as session:
        all_places = places_store.list_all_places(session)

    total = len(all_places)
    success, failed = 0, 0

    for idx, place in enumerate(all_places, 1):
        place_id = int(place.place_id)
        name = place.name or ""
        region = place.region or ""
        province = place.province or ""
        region_kw = " ".join(x for x in (region, province) if x).strip()

        logger.info("[crawl_batch] [%d/%d] place_id=%d name=%s", idx, total, place_id, name)

        try:
            # 기존 데이터 삭제
            with session_scope() as session:
                deleted = places_store.clear_crawled_data_for_place(session, place_id)

            # 이미지 파일 삭제
            img_dir = IMAGE_SAVE_ROOT / str(place_id)
            if img_dir.exists():
                shutil.rmtree(img_dir, ignore_errors=True)

            # 재크롤링
            combined_text, serve_urls = crawl_naver_blog_for_place(
                place_name=name,
                place_id=place_id,
                max_results=int(os.getenv("NAVER_BLOG_MAX_RESULTS", "3")),
                region=region_kw,
            )

            logger.info(
                "[crawl_batch] place_id=%d 완료 — 텍스트 %d자, 이미지 %d장 (삭제: %s)",
                place_id, len(combined_text), len(serve_urls), deleted,
            )
            success += 1

        except Exception:
            logger.exception("[crawl_batch] place_id=%d 실패", place_id)
            failed += 1

        if idx < total:
            time.sleep(PLACE_DELAY_SECONDS)

    result = {"total": total, "success": success, "failed": failed}
    logger.info("[crawl_batch] 완료 %s", result)
    return result


def start_scheduler() -> None:
    """APScheduler를 백그라운드로 시작. FastAPI lifespan에서 호출."""
    from apscheduler.schedulers.background import BackgroundScheduler

    scheduler = BackgroundScheduler()
    scheduler.add_job(
        crawl_all_places,
        trigger="interval",
        weeks=CRAWL_INTERVAL_WEEKS,
        id="crawl_all_places",
        replace_existing=True,
    )
    scheduler.start()
    logger.info("[crawl_batch] 스케줄러 시작 — %d주 간격", CRAWL_INTERVAL_WEEKS)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    crawl_all_places()
