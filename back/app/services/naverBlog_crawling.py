import json
import os
import time
from typing import Dict, List, Optional

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv()

# ========== DB 연결 설정 (TODO: 데이터베이스 라이브러리 설치 필요) ==========
# 아래 중 원하는 DB에 맞게 수정하세요
# MySQL: pip install mysql-connector-python 또는 pip install PyMySQL
# PostgreSQL: pip install psycopg2-binary
# SQLite: 기본 내장 (sqlite3)
# MongoDB: pip install pymongo

# 예제: MySQL 연결
# import mysql.connector
# OR PostgreSQL 연결
# import psycopg2
# OR SQLite 연결
# import sqlite3

DB_CONFIG = {
    # TODO: 실제 DB 정보로 수정
    "host": "your_db_host",
    "user": "your_db_user",
    "password": "your_db_password",
    "database": "your_database_name",
    "port": 3306,  # MySQL 기본 포트
}


class NaverBlogCrawler:
    """네이버 검색 API와 BeautifulSoup을 사용한 블로그 데이터 수집 클래스"""

    def __init__(self, client_id: str, client_secret: str):
        """
        Naver API 크리덴셜 초기화

        Args:
            client_id: 네이버 API 클라이언트 ID
            client_secret: 네이버 API 클라이언트 시크릿
        """
        self.client_id = client_id
        self.client_secret = client_secret
        self.search_api_url = "https://openapi.naver.com/v1/search/blog"
        self.headers = {
            "X-Naver-Client-Id": self.client_id,
            "X-Naver-Client-Secret": self.client_secret,
        }
        self.naver_base_url = "https://blog.naver.com"

    def search_blog(self, keyword: str, display: int = 5) -> List[Dict]:
        """
        네이버 검색 API를 사용하여 블로그 검색

        Args:
            keyword: 검색 키워드 (상호명)
            display: 조회할 결과 수 (기본 5개)

        Returns:
            검색 결과 리스트 [{"title": "...", "link": "...", "description": "..."}]
        """
        try:
            params = {
                "query": keyword,
                "display": display,
                "sort": "sim",  # 정확도순 정렬
            }

            response = requests.get(
                self.search_api_url, headers=self.headers, params=params, timeout=10
            )
            response.raise_for_status()

            data = response.json()
            results = []

            for item in data.get("items", []):
                results.append(
                    {
                        "title": item["title"],
                        "link": item["link"],
                        "description": item["description"],
                        "blogger_name": item.get("bloggername", "Unknown"),
                        "post_date": item.get("postdate", ""),
                    }
                )

            return results

        except requests.exceptions.RequestException as e:
            print(f"검색 API 에러 ('{keyword}'): {e}")
            return []

    def extract_blog_content(self, blog_url: str) -> Optional[str]:
        """
        네이버 블로그의 본문 내용 추출 (iframe 처리 포함)

        Args:
            blog_url: 네이버 블로그 URL

        Returns:
            본문 텍스트 또는 None
        """
        try:
            # 블로그 페이지 요청
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            response = requests.get(blog_url, headers=headers, timeout=10)
            response.encoding = "utf-8"
            response.raise_for_status()

            soup = BeautifulSoup(response.text, "html.parser")

            # 방법 1: 일반적인 블로그 본문 영역 추출
            content_area = soup.find("div", {"class": "se-main-container"})
            if content_area:
                # 텍스트 추출
                text_content = content_area.get_text(strip=True)
                return text_content if text_content else None

            # 방법 2: iframe에서 main.naver.com 링크 추출 및 처리
            iframe = soup.find("iframe", {"id": "mainFrame"})
            if iframe:
                iframe_src = iframe.get("src")
                if iframe_src:
                    # iframe 주소 정규화
                    if not iframe_src.startswith("http"):
                        iframe_src = (
                            "https:" + iframe_src
                            if iframe_src.startswith("//")
                            else self.naver_base_url + iframe_src
                        )

                    # iframe 내용 추출
                    try:
                        iframe_response = requests.get(
                            iframe_src, headers=headers, timeout=10
                        )
                        iframe_response.encoding = "utf-8"
                        iframe_soup = BeautifulSoup(iframe_response.text, "html.parser")

                        # 실제 본문 내용 추출
                        content = iframe_soup.find(
                            "div", {"class": "se-main-container"}
                        )
                        if content:
                            text_content = content.get_text(strip=True)
                            return text_content if text_content else None
                    except Exception as e:
                        print(f"iframe 처리 에러: {e}")

            # 방법 3: 기본 div 영역에서 추출 (구형 블로그)
            post_view = soup.find("div", {"class": "post-view"})
            if post_view:
                text_content = post_view.get_text(strip=True)
                return text_content if text_content else None

            return None

        except requests.exceptions.RequestException as e:
            print(f"블로그 본문 추출 에러 ('{blog_url}'): {e}")
            return None
        except Exception as e:
            print(f"예상치 못한 에러 ('{blog_url}'): {e}")
            return None

    def crawl_blogs(
        self, shop_names: List[str], max_results_per_shop: int = 3
    ) -> List[Dict]:
        """
        여러 상호명에 대해 블로그 검색 및 본문 크롤링 수행

        Args:
            shop_names: 검색할 상호명 리스트
            max_results_per_shop: 각 상호명당 수집할 최대 포스트 수

        Returns:
            수집된 데이터 리스트
        """
        all_data = []

        for idx, shop_name in enumerate(shop_names, 1):
            print(f"\n[{idx}/{len(shop_names)}] '{shop_name}' 검색 중...")

            # 블로그 검색
            search_results = self.search_blog(shop_name, display=max_results_per_shop)

            if not search_results:
                print("  → 검색 결과 없음")
                continue

            print(f"  → {len(search_results)}개 결과 발견")

            for result_idx, result in enumerate(search_results, 1):
                print(f"    [{result_idx}] {result['title'][:50]}... 본문 추출 중...")

                # 블로그 본문 추출
                content = self.extract_blog_content(result["link"])

                if content:
                    # 전체 본문 내용 저장
                    data_entry = {
                        "shop_name": shop_name,
                        "blog_title": result["title"],
                        "blog_url": result["link"],
                        "blogger_name": result["blogger_name"],
                        "post_date": result["post_date"],
                        "description": result["description"],
                        "content": content,
                        "content_length": len(content),
                    }
                    all_data.append(data_entry)
                    print(f"      → 성공 (본문: {len(content)}자)")
                else:
                    print("      → 본문 추출 실패")

                # API 호출 빈도 조절
                time.sleep(0.5)

            # 상호명별 딜레이
            time.sleep(1)

        return all_data

    def save_to_json(self, data: List[Dict], output_file: str) -> None:
        """
        수집된 데이터를 JSON 파일로 저장

        Args:
            data: 저장할 데이터 리스트
            output_file: 출력 파일 경로
        """
        try:
            with open(output_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            print(f"\n✓ 데이터 저장 완료: {output_file}")
            print(f"  수집된 포스트: {len(data)}개")
        except Exception as e:
            print(f"JSON 저장 에러: {e}")

    def save_to_database(self, data: List[Dict]) -> None:
        """
        TODO: 수집된 데이터를 데이터베이스에 저장

        구현 방법:
        1. DB 라이브러리 import 해제
        2. 아래 코드를 실제 DB INSERT 쿼리로 변경
        3. 연결, 커서 생성, 쿼리 실행, 커밋 순으로 진행

        예제 (MySQL):
        ```python
        import mysql.connector
        conn = mysql.connector.connect(**DB_CONFIG)
        cursor = conn.cursor()

        query = "INSERT INTO blog_posts (shop_name, blog_title, blog_url, content) VALUES (%s, %s, %s, %s)"
        for entry in data:
            cursor.execute(query, (entry['shop_name'], entry['blog_title'], entry['blog_url'], entry['content']))

        conn.commit()
        cursor.close()
        conn.close()
        ```

        Args:
            data: DB에 저장할 데이터 리스트
        """
        if not data:
            print("저장할 데이터가 없습니다.")
            return

        try:
            # TODO: DB 연결 및 저장 로직 구현
            print("\n⚠️  데이터베이스 저장 기능이 아직 구현되지 않았습니다.")
            print(f"   (데이터: {len(data)}개 포스트)")
            print("\n   구현 방법은 save_to_database() 함수의 docstring을 참고하세요.")

        except Exception as e:
            print(f"데이터베이스 저장 에러: {e}")


def load_shop_names_from_db() -> List[str]:
    """
    TODO: 데이터베이스에서 상호명 리스트 조회

    구현 방법:
    1. DB 연결 후 SELECT 쿼리 실행
    2. 상호명 컬럼만 추출해서 리스트로 반환

    예제 (MySQL):
    ```python
    import mysql.connector
    conn = mysql.connector.connect(**DB_CONFIG)
    cursor = conn.cursor()
    cursor.execute("SELECT shop_name FROM shops WHERE is_active = 1")
    results = cursor.fetchall()
    shop_names = [row[0] for row in results]
    cursor.close()
    conn.close()
    return shop_names
    ```

    Returns:
        상호명 리스트
    """
    # 임시: 테스트 데이터 반환 (나중에 DB 쿼리로 변경)
    test_data = {
        "shops": [
            {"name": "스타벅스"},
            {"name": "이디야커피"},
            {"name": "투썸플레이스"},
            {"name": "카페베네"},
            {"name": "할리스커피"},
        ]
    }
    shop_names = [shop["name"] for shop in test_data["shops"]]
    return shop_names


def main():
    """
    메인 실행 함수
    """
    # ===== 설정 =====
    # 네이버 API 크리덴셜 (환경변수 또는 직접 입력)
    CLIENT_ID = os.getenv("NAVER_CLIENT_ID", "YOUR_CLIENT_ID_HERE")
    CLIENT_SECRET = os.getenv("NAVER_CLIENT_SECRET", "YOUR_CLIENT_SECRET_HERE")

    # 크리덴셜 확인
    if CLIENT_ID == "YOUR_CLIENT_ID_HERE" or CLIENT_SECRET == "YOUR_CLIENT_SECRET_HERE":
        print("=" * 60)
        print("⚠️  네이버 API 크리덴셜이 설정되지 않았습니다.")
        print("=" * 60)
        print("\n설정 방법:\n")
        print("1. .env 파일 생성:")
        print("   $ cp .env.example .env\n")
        print("2. .env 파일 수정 (아래 내용 입력):")
        print("   NAVER_CLIENT_ID=your_actual_client_id")
        print("   NAVER_CLIENT_SECRET=your_actual_client_secret\n")
        print("3. 네이버 개발자 센터에서 발급받기:")
        print("   https://developers.naver.com/console/dashboard\n")
        return

    # ===== 데이터 입력 =====
    # TODO: DB 연결 여부에 따라 아래 두 방식 중 하나 선택
    # 방식 1: 테스트 데이터 사용 (현재)
    # shop_names = load_shop_names_from_db()

    # 방식 2: DB에서 조회 (나중에 구현)
    # shop_names = load_shop_names_from_db()  # 함수 내부 DB 로직 활성화 필요

    # 현재는 테스트 데이터 사용
    test_db = {
        "shops": [
            {"name": "스타벅스"},
            {"name": "이디야커피"},
            {"name": "투썸플레이스"},
            {"name": "카페베네"},
            {"name": "할리스커피"},
        ]
    }
    shop_names = [shop["name"] for shop in test_db["shops"]]

    print("=" * 60)
    print("네이버 블로그 데이터 수집 시작")
    print("=" * 60)
    print(f"검색할 상호명: {', '.join(shop_names)}\n")

    # ===== 크롤링 실행 =====
    crawler = NaverBlogCrawler(CLIENT_ID, CLIENT_SECRET)
    collected_data = crawler.crawl_blogs(shop_names, max_results_per_shop=3)

    # ===== 결과 저장 (JSON 또는 DB) =====
    # 옵션 1: JSON 파일로 저장 (현재)
    output_path = "blog_data.json"
    crawler.save_to_json(collected_data, output_path)

    # 옵션 2: 데이터베이스에 저장 (TODO: 구현 필요)
    # crawler.save_to_database(collected_data)

    # ===== 결과 요약 =====
    print("\n" + "=" * 60)
    print("수집 완료 요약")
    print("=" * 60)
    if collected_data:
        print(f"✓ 총 {len(collected_data)}개 포스트 수집")
        for entry in collected_data[:3]:  # 처음 3개만 출력
            print(f"\n  • [{entry['shop_name']}]")
            print(f"    제목: {entry['blog_title'][:50]}...")
            print(f"    본문: {entry['content'][:80]}...")
    else:
        print("✗ 수집된 데이터가 없습니다.")


if __name__ == "__main__":
    main()
