import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup

# 이미지 로컬 저장 루트: back/static/images/{place_id}/{uuid}.jpg
IMAGE_SAVE_ROOT = Path(__file__).resolve().parents[2] / "static" / "images"

_CONTENT_TYPE_EXT = {"png": "png", "gif": "gif", "webp": "webp"}


# ── DB 헬퍼 ──────────────────────────────────────────────────────────────────


def _get_db_connection():
    """MYSQL_URL 환경변수로 pymysql 커넥션 반환."""
    import pymysql

    mysql_url = os.getenv("MYSQL_URL", "")
    if not mysql_url:
        raise RuntimeError("MYSQL_URL 환경변수가 설정되지 않았습니다.")

    parsed = urlparse(mysql_url)
    return pymysql.connect(
        host=parsed.hostname,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip("/"),
        port=parsed.port or 3306,
    )


def _save_images_to_db(place_id: int, images: List[Dict]) -> None:
    """
    CRAWLED_IMAGES 테이블에 이미지 정보 insert.
    동일 source_url + place_id 조합이 이미 있으면 건너뜀 (중복 방지).

    images 항목 형식: {"source_url": str, "local_path": str, "serve_url": str}
    """
    if not os.getenv("MYSQL_URL"):
        print("MYSQL_URL 환경변수가 없어 DB 저장을 건너뜁니다.")
        return

    conn = None
    try:
        conn = _get_db_connection()
        cursor = conn.cursor()
        now = datetime.now(timezone.utc)

        for img in images:
            cursor.execute(
                "SELECT image_id FROM crawled_images WHERE source_url = %s AND place_id = %s LIMIT 1",
                (img["source_url"], place_id),
            )
            if cursor.fetchone():
                continue
            cursor.execute(
                "INSERT INTO crawled_images (place_id, source_url, local_path, serve_url, crawled_at)"
                " VALUES (%s, %s, %s, %s, %s)",
                (place_id, img["source_url"], img["local_path"], img["serve_url"], now),
            )

        conn.commit()
        print(f"  DB 저장 완료: place_id={place_id}, {len(images)}개 이미지")
    except Exception as e:
        print(f"DB 저장 에러: {e}")
    finally:
        if conn:
            conn.close()


# ── 크롤러 클래스 ─────────────────────────────────────────────────────────────


class NaverBlogCrawler:
    """네이버 검색 API와 BeautifulSoup을 사용한 블로그 데이터 수집 클래스"""

    def __init__(self, client_id: str, client_secret: str):
        self.client_id = client_id
        self.client_secret = client_secret
        self.search_api_url = "https://openapi.naver.com/v1/search/blog"
        self.headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
        }
        self.naver_base_url = "https://blog.naver.com"
        self._crawl_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }

    # ── 공통 유틸 ─────────────────────────────────────────────────────────────

    def _resolve_soup(self, url: str) -> Optional[BeautifulSoup]:
        """URL을 가져와 BeautifulSoup 반환. 네이버 iframe이 있으면 iframe 내부를 파싱."""
        try:
            resp = requests.get(url, headers=self._crawl_headers, timeout=10)
            resp.encoding = "utf-8"
            resp.raise_for_status()
            soup = BeautifulSoup(resp.text, "html.parser")

            iframe = soup.find("iframe", {"id": "mainFrame"})
            if iframe:
                src = iframe.get("src", "")
                if src:
                    if not src.startswith("http"):
                        src = (
                            "https:" + src
                            if src.startswith("//")
                            else self.naver_base_url + src
                        )
                    try:
                        iframe_resp = requests.get(
                            src, headers=self._crawl_headers, timeout=10
                        )
                        iframe_resp.encoding = "utf-8"
                        soup = BeautifulSoup(iframe_resp.text, "html.parser")
                    except Exception:
                        pass  # iframe 실패 시 원본 soup 사용

            return soup
        except requests.exceptions.RequestException as e:
            print(f"페이지 로드 에러 ('{url}'): {e}")
            return None

    # ── 텍스트 크롤링 ─────────────────────────────────────────────────────────

    def search_blog(self, keyword: str, display: int = 5) -> List[Dict]:
        """네이버 검색 API로 블로그 검색. 결과 리스트 반환."""
        try:
            params = {"query": keyword, "display": display, "sort": "sim"}
            response = requests.get(
                self.search_api_url, headers=self.headers, params=params, timeout=10
            )
            response.raise_for_status()
            return [
                {
                    "title": item["title"],
                    "link": item["link"],
                    "description": item["description"],
                    "blogger_name": item.get("bloggername", "Unknown"),
                    "post_date": item.get("postdate", ""),
                }
                for item in response.json().get("items", [])
            ]
        except requests.exceptions.RequestException as e:
            print(f"검색 API 에러 ('{keyword}'): {e}")
            return []

    def extract_blog_content(self, blog_url: str) -> Optional[str]:
        """네이버 블로그 본문 텍스트 추출 (iframe 처리 포함)."""
        soup = self._resolve_soup(blog_url)
        if not soup:
            return None

        for selector in ("se-main-container", "post-view"):
            area = soup.find("div", {"class": selector})
            if area:
                text = area.get_text(strip=True)
                return text or None

        return None

    def crawl_blogs(
        self, shop_names: List[str], max_results_per_shop: int = 3
    ) -> List[Dict]:
        """여러 상호명에 대해 블로그 검색 및 본문 크롤링."""
        all_data = []
        for idx, shop_name in enumerate(shop_names, 1):
            print(f"\n[{idx}/{len(shop_names)}] '{shop_name}' 검색 중...")
            search_results = self.search_blog(shop_name, display=max_results_per_shop)
            if not search_results:
                print("  → 검색 결과 없음")
                continue
            print(f"  → {len(search_results)}개 결과 발견")
            for result_idx, result in enumerate(search_results, 1):
                print(f"    [{result_idx}] {result['title'][:50]}... 본문 추출 중...")
                content = self.extract_blog_content(result["link"])
                if content:
                    all_data.append(
                        {
                            "shop_name": shop_name,
                            "blog_title": result["title"],
                            "blog_url": result["link"],
                            "blogger_name": result["blogger_name"],
                            "post_date": result["post_date"],
                            "description": result["description"],
                            "content": content,
                            "content_length": len(content),
                        }
                    )
                    print(f"      → 성공 (본문: {len(content)}자)")
                else:
                    print("      → 본문 추출 실패")
                time.sleep(0.5)
            time.sleep(1)
        return all_data

    # ── 이미지 크롤링 ─────────────────────────────────────────────────────────

    def extract_blog_images(self, blog_url: str, max_images: int = 5) -> List[str]:
        """블로그 본문에서 이미지 URL 추출 (pstatic.net / naver.net 도메인만 수집)."""
        soup = self._resolve_soup(blog_url)
        if not soup:
            return []

        content_area = soup.find("div", {"class": "se-main-container"})
        search_scope = content_area if content_area else soup

        urls: List[str] = []
        for img in search_scope.find_all("img"):
            src = (img.get("data-lazy-src") or img.get("src") or "").strip()
            if not src.startswith("http"):
                continue
            if "pstatic.net" not in src and "naver.net" not in src:
                continue
            if src not in urls:
                urls.append(src)
            if len(urls) >= max_images:
                break

        return urls

    def download_image(self, image_url: str, place_id: int) -> Optional[Dict[str, str]]:
        """
        이미지 URL을 로컬에 저장하고 CRAWLED_IMAGES 저장용 dict 반환.

        Returns:
            {"source_url": ..., "local_path": ..., "serve_url": ...} 또는 None
        """
        try:
            resp = requests.get(image_url, headers=self._crawl_headers, timeout=10)
            resp.raise_for_status()

            content_type = resp.headers.get("Content-Type", "")
            ext = next((e for e in _CONTENT_TYPE_EXT if e in content_type), "jpg")

            filename = f"{uuid.uuid4().hex}.{ext}"
            save_dir = IMAGE_SAVE_ROOT / str(place_id)
            save_dir.mkdir(parents=True, exist_ok=True)
            (save_dir / filename).write_bytes(resp.content)

            return {
                "source_url": image_url,
                "local_path": str(save_dir / filename),
                "serve_url": f"/static/images/{place_id}/{filename}",
            }
        except Exception as e:
            print(f"이미지 다운로드 실패 ('{image_url}'): {e}")
            return None

    def crawl_and_save_images(
        self,
        place_id: int,
        keyword: str,
        max_posts: int = 3,
        max_images_per_post: int = 3,
    ) -> List[Dict]:
        """
        키워드로 블로그를 검색해 이미지를 로컬 저장 후 CRAWLED_IMAGES에 저장.

        Returns:
            이미지 정보 리스트 [{"source_url": ..., "local_path": ..., "serve_url": ...}]
        """
        # 캐시 확인은 DOCUMENTS 아티클 단위로 상위(article_service)에서 처리
        posts = self.search_blog(keyword, display=max_posts)
        saved: List[Dict] = []

        for post in posts:
            image_urls = self.extract_blog_images(
                post["link"], max_images=max_images_per_post
            )
            for img_url in image_urls:
                result = self.download_image(img_url, place_id)
                if result:
                    saved.append(result)
            time.sleep(0.5)

        if saved:
            _save_images_to_db(place_id, saved)

        return saved


# ── 온디맨드 진입점 ───────────────────────────────────────────────────────────


def _get_crawler() -> Optional["NaverBlogCrawler"]:
    """환경변수로 NaverBlogCrawler 인스턴스 반환. 크리덴셜 없으면 None."""
    client_id = os.getenv("NAVER_CLIENT_ID", "")
    client_secret = os.getenv("NAVER_CLIENT_SECRET", "")
    if not client_id or not client_secret:
        print("NAVER_CLIENT_ID / NAVER_CLIENT_SECRET 환경변수가 없습니다.")
        return None
    return NaverBlogCrawler(client_id, client_secret)


def crawl_place_text_on_demand(
    name: str, region: str = "", max_posts: int = 3
) -> List[Dict]:
    """
    장소명으로 블로그 텍스트를 온디맨드 크롤링하여 반환.
    반환값을 상위 서비스(article_service)에서 AI 아티클 생성에 사용.

    Args:
        name: 장소명 (검색 키워드 기반)
        region: 지역명 (키워드 보강용, 예: "강릉")
        max_posts: 수집할 블로그 포스트 수

    Returns:
        [{shop_name, blog_title, blog_url, blogger_name, post_date, description, content, content_length}, ...]
    """
    crawler = _get_crawler()
    if not crawler:
        return []

    keyword = f"{name} {region}".strip()
    return crawler.crawl_blogs([keyword], max_results_per_shop=max_posts)


def crawl_place_on_demand(place_id: int, name: str, region: str = "") -> List[Dict]:
    """
    갤러리 모달 요청 시 호출되는 온디맨드 이미지 크롤링 함수.
    DOCUMENTS 아티클 캐시 확인은 상위 서비스(article_service)에서 처리하며,
    여기서는 네이버 블로그 크롤링 → 로컬 저장 → CRAWLED_IMAGES 저장만 담당.

    Args:
        place_id: PLACES.place_id
        name: 장소명 (검색 키워드 기반)
        region: 지역명 (키워드 보강용, 예: "강릉")

    Returns:
        이미지 정보 리스트 [{"source_url": ..., "local_path": ..., "serve_url": ...}]
    """
    crawler = _get_crawler()
    if not crawler:
        return []

    keyword = f"{name} {region}".strip()
    return crawler.crawl_and_save_images(place_id=place_id, keyword=keyword)


if __name__ == "__main__":
    # 직접 실행 시 동작 테스트용
    from dotenv import load_dotenv

    load_dotenv()
    results = crawl_place_text_on_demand(name="성수동 카페", region="서울", max_posts=2)
    for r in results:
        print(r["blog_title"], "-", r["content_length"], "자")
