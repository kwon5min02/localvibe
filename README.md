# LocalVibe

전국 관광·지역 상권 데이터를 통합하고, AI 검색·대화형 추천으로 개인 맞춤 여행 경험을 제공하는 웹 플랫폼.

---

## 목차

1. [프로젝트 개요](#프로젝트-개요)
2. [기술 스택](#기술-스택)
3. [폴더 구조](#폴더-구조)
4. [로컬 개발 환경 설정](#로컬-개발-환경-설정)
5. [아키텍처 규칙](#아키텍처-규칙)
6. [협업 가이드 — 팀원 필독](#협업-가이드--팀원-필독)
7. [새 기능 추가 방법](#새-기능-추가-방법)
8. [환경 변수](#환경-변수)

---

## 프로젝트 개요

| 구분 | 내용 |
|---|---|
| 서비스명 | LocalVibe |
| 성격 | 캡스톤 디자인 / 데이터관광포털 경진대회 출품작 |
| 주요 기능 | 갤러리형 장소 탐색, AI 벡터 검색, 대화형 여행 플래너, 스크랩·일정 관리 |
| 데이터 소스 | 한국관광공사 KorService2 OpenAPI, 네이버 블로그 크롤링 |

---

## 기술 스택

### 프론트엔드 (`front/`)
- React 18 + Vite
- React Router v6
- Google OAuth (`@react-oauth/google`)

### 백엔드 (`back/`)
- FastAPI + Uvicorn
- SQLAlchemy + MySQL (PyMySQL)
- Sentence-Transformers + Pinecone (하이브리드 벡터 검색)
- DSPy (갤러리 검색 프롬프트 최적화)
- OpenAI GPT-4o-mini (아티클 생성, 요약)
- APScheduler (크롤링 배치)

---

## 폴더 구조

```
localvibe/
├── front/                  # React 클라이언트
│   └── src/
│       ├── shared/         # 앱 전역 공유 레이어
│       │   ├── api/        # HTTP 클라이언트 (apiFetch, publicFetch, API_BASE_URL)
│       │   └── auth/       # AuthContext (useAuth)
│       ├── features/       # 도메인별 기능 모듈 ← 팀별 작업 영역
│       │   ├── gallery/    # 갤러리 피드·검색 훅 (useGalleryFeed)
│       │   ├── scraps/     # 스크랩 Context + API
│       │   └── trips/      # 여행 일정 Context + API
│       ├── components/     # 공용 UI 컴포넌트
│       ├── pages/          # 페이지 컴포넌트
│       ├── data/           # 정적 시드 데이터
│       ├── hooks/          # 범용 커스텀 훅
│       └── utils/          # 순수 유틸 함수
│
└── back/                   # FastAPI 서버
    └── app/
        ├── shared/         # 서버 전역 공유 유틸
        │   ├── media.py    # 이미지 URL 검증
        │   └── comparison.py
        ├── modules/        # 도메인별 서비스 모듈 ← 팀별 작업 영역
        │   ├── auth/       # JWT 인증 서비스
        │   ├── regions/    # 장소·지역 서비스 (geocode, KTO, summary)
        │   ├── search/     # 임베딩·벡터 검색·추천 (Pinecone, DSPy)
        │   ├── chat/       # AI 여행 플래너 서비스
        │   ├── content/    # 아티클 생성·크롤링·스케줄러
        │   ├── data/       # KTO 데이터 파이프라인
        │   └── user_data/  # 스크랩·여행·트렌드 저장소
        ├── api/            # FastAPI 라우터 (thin adapter — 비즈니스 로직 없음)
        │   └── routes/
        ├── repositories/   # SQLAlchemy ORM 모델·CRUD
        ├── schemas/        # Pydantic 요청·응답 스키마
        └── services/       # ⚠️ re-export 스텁 (신규 코드 금지 — modules/ 사용)
```

---

## 로컬 개발 환경 설정

### 프론트엔드

```bash
cd front
npm install
cp .env.example .env        # VITE_API_BASE_URL, VITE_GOOGLE_CLIENT_ID 설정
npm run dev
```

### 백엔드

```bash
cd back
pip install -r requirements.txt
cp .env.example .env        # MYSQL_URL, JWT_SECRET 등 설정
uvicorn app.main:app --reload
```

### 아키텍처 검사 (로컬)

```bash
# 프론트엔드 — lint + depcruiser 아키텍처 가드
cd front && npm run verify

# 백엔드 — import-linter 아키텍처 가드
cd back && lint-imports
# 또는
cd back && make arch-check
```

---

## 아키텍처 규칙

> **이 규칙들은 자동으로 검사됩니다.** 위반 시 `npm run verify` 또는 `lint-imports`가 error로 실패합니다.

### 프론트엔드 레이어 규칙

```
shared    ← 누구도 import 불가 (최하위 레이어)
features  ← shared만 import 가능. 다른 feature에서 import 금지
components← shared만 import 가능
pages     ← 모두 import 가능
```

**같은 feature 내 파일끼리는 자유롭게 import 가능.**

```js
// 올바른 예
import { apiFetch } from '../../shared/api/client';       // shared → OK
import { useScraps } from '../scraps/ScrapsContext';       // 다른 feature → 금지

// 틀린 예 (arch 위반 — error)
import { useGalleryFeed } from '../gallery/useGalleryFeed'; // features → features 금지
```

### 백엔드 레이어 규칙

```
shared          ← 모든 모듈이 import 가능
modules/<domain>← repositories/, schemas/, shared/에서만 import
api/routes/     ← modules/ 또는 repositories/ 에서 import (services/ 직접 import 금지)
services/       ← re-export 스텁 전용. 새 코드 작성 금지
```

**허용되는 cross-module import:**
- `modules/chat/` → `modules/search/` (추천·임베딩 활용)
- `modules/content/` → `modules/search/` (아티클 임베딩)

---

## 협업 가이드 — 팀원 필독

### 팀별 담당 영역

| 팀 | 프론트엔드 | 백엔드 |
|---|---|---|
| 갤러리·검색 | `features/gallery/` `pages/` (갤러리 탭) | `modules/regions/` `modules/search/` `api/routes/regions.py` `api/routes/search.py` |
| AI 플래너 | `features/trips/` `pages/TripPlannerPage.jsx` `components/TripChatPanel.jsx` `components/RoadMap.jsx` | `modules/chat/` `api/routes/chat.py` |
| 사용자·인증 | `features/scraps/` `shared/auth/` `pages/MyPage.jsx` | `modules/auth/` `modules/user_data/` `api/routes/me.py` `api/routes/scraps_trips.py` |
| 콘텐츠·크롤링 | `components/RegionModal.jsx` (아티클 표시) | `modules/content/` `api/routes/places.py` `api/routes/place_actions.py` |

### 머지 충돌을 줄이는 규칙

**1. 내 담당 모듈 밖 파일은 최대한 건드리지 않는다.**

각 기능이 `features/<domain>/` 또는 `modules/<domain>/` 단위로 분리되어 있기 때문에, 담당 영역만 작업하면 다른 팀원과 충돌이 거의 없습니다.

**2. `App.jsx`는 공유 파일이므로 변경 전 팀에 공지한다.**

`App.jsx`는 레이아웃·탭 전환 로직만 담당하는 얇은 파일입니다. 기능 추가는 반드시 `features/` 훅이나 Context로 분리한 뒤, `App.jsx`에는 최소한의 연결만 추가합니다.

**3. 신규 백엔드 서비스는 반드시 `modules/<domain>/`에 작성한다.**

`back/app/services/`는 이전 코드의 re-export 스텁만 있습니다. 여기에 새 코드를 쓰면 아키텍처 가드가 통과하지 않습니다.

**4. PR 올리기 전 항상 arch-check를 통과시킨다.**

```bash
# 프론트
cd front && npm run verify

# 백엔드
cd back && lint-imports
```

실패하면 import 경로를 수정한 뒤 PR을 올립니다.

**5. API 엔드포인트 추가 시 `api/routes/`에 얇은 어댑터만 작성한다.**

라우터는 요청 파싱과 응답 반환만 담당합니다. 비즈니스 로직은 `modules/<domain>/service.py`에 작성합니다.

```python
# 올바른 예 — routes/에 로직 최소화
@router.get("/regions")
def list_regions_endpoint(place_in: str | None = None):
    return {"regions": list_regions_in_location(place_in) if place_in else list_regions()}

# 틀린 예 — routes/에 비즈니스 로직 직접 작성
@router.get("/regions")
def list_regions_endpoint():
    with session_scope() as session:
        rows = session.execute(...)  # ← 이 로직은 modules/에 있어야 함
```

**6. Cross-feature 공유 상태는 Context로 뽑는다.**

두 개 이상의 페이지·컴포넌트가 같은 상태를 필요로 하면, `shared/` (앱 전역) 또는 `features/<domain>/Context`로 분리합니다. 다른 feature의 Context를 직접 import하는 것은 아키텍처 위반입니다.

### Git 워크플로

```
main           ← 릴리즈 브랜치. 직접 push 금지.
  └── feat/<이름>/<기능>   ← 기능 브랜치 (예: feat/jiwoo/gallery-search)
```

1. `main`에서 브랜치를 따 작업합니다.
2. PR 전 `npm run verify` / `lint-imports` 통과를 확인합니다.
3. 리뷰어 최소 1명의 approve 후 merge합니다.
4. merge 후 브랜치는 삭제합니다.

---

## 새 기능 추가 방법

### 프론트엔드에 새 도메인 기능 추가

```
front/src/features/<domain>/
├── <Domain>Context.jsx     # 전역 상태 필요 시
├── <domain>Api.js          # 백엔드 통신 (apiFetch / publicFetch 사용)
└── use<Domain>.js          # 복잡한 UI 로직 훅
```

`main.jsx`에서 Context Provider로 감싸고, `App.jsx`에서 훅을 연결합니다.

### 백엔드에 새 도메인 모듈 추가

```
back/app/modules/<domain>/
├── __init__.py
└── service.py              # 비즈니스 로직
```

라우터는 `api/routes/<domain>.py`에 추가하고 `api/__init__.py`와 `main.py`에 등록합니다.

### HTTP 클라이언트 사용 규칙 (프론트)

```js
import { apiFetch, publicFetch, API_BASE_URL } from '../../shared/api/client';

// 로그인 필요한 요청
const data = await apiFetch('/api/me/scraps');

// 공개 요청
const data = await publicFetch('/api/regions');

// API_BASE_URL 직접 노출이 필요한 경우 (예: RegionModal 이미지 URL)
const url = `${API_BASE_URL}/static/images/...`;
```

`fetch()`를 직접 쓰거나, `.env`에서 직접 `VITE_API_BASE_URL`을 가져오는 것은 금지입니다.

---

## 환경 변수

### 프론트엔드 (`front/.env`)

| 변수 | 설명 | 예시 |
|---|---|---|
| `VITE_API_BASE_URL` | 백엔드 서버 주소 | `http://127.0.0.1:8000` |
| `VITE_GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID | `xxx.apps.googleusercontent.com` |

### 백엔드 (`back/.env`)

| 변수 | 설명 |
|---|---|
| `MYSQL_URL` | MySQL 연결 문자열 (`mysql+pymysql://...`) |
| `JWT_SECRET` | JWT 서명 키 |
| `JWT_ALGORITHM` | 기본 `HS256` |
| `JWT_EXPIRE_MINUTES` | 기본 `10080` (7일) |
| `GOOGLE_CLIENT_ID` | Google OAuth 클라이언트 ID |
| `OPENAI_API_KEY` | OpenAI API 키 (아티클 생성·요약) |
| `PINECONE_API_KEY` | Pinecone 벡터 DB API 키 |
| `PINECONE_INDEX` | Pinecone 인덱스 이름 |
| `KAKAO_REST_API_KEY` | 카카오 REST API 키 (주소 → 좌표 변환) |
| `KTO_SERVICE_KEY` | 한국관광공사 API 서비스 키 |
| `NAVER_CLIENT_ID` | 네이버 검색 API 클라이언트 ID |
| `NAVER_CLIENT_SECRET` | 네이버 검색 API 시크릿 |
| `EMBEDDING_MODEL_NAME` | 기본 `dragonkue/multilingual-e5-small-ko` |
| `BM25_MODEL_PATH` | BM25 인코더 파일 경로 (기본 `bm25_encoder.json`) |
