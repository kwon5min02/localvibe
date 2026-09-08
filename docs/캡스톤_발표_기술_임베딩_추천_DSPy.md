# LocalVibe — 기술 스택 발표용 요약

> **용도:** 캡스톤 발표에서 “전문성”을 보여줄 **벡터 검색 · 추천 알고리즘 · DSPy · 하드코딩 프롬프트** 정리  
> **연관 문서:** [10분 발표 스크립트](./캡스톤_발표_10분_LocalVibe.md)

---

## 1. 한 줄 아키텍처

```
사용자 질문
  → (1) 의도 분석 (GPT JSON / 키워드 폴백)
  → (2) 후보 수집: Pinecone 하이브리드 + 갤러리 검색 + MySQL 트렌드
  → (3) 재랭킹: 토큰·지역·의도 부스트 (_build_recommendation_ids)
  → (4) 최종 선택: DSPy(옵션) 또는 baseline → OpenAI JSON 응답(트립 일정)
```

---

## 2. 벡터 임베딩 & Pinecone 하이브리드 검색

### 2.1 구현 위치

| 역할 | 파일 |
|------|------|
| 임베딩·upsert·검색 | `back/app/services/embedding_service.py` |
| 갤러리 검색 + 점수 합산 | `back/app/services/search_service.py` |
| 일괄 재임베딩 | `back/scripts/reembed_all.py`, `embed_places_to_pinecone.py` |
| KTO 적재 후 동기화 | `back/scripts/sync_kto_places.py` |

### 2.2 Dense + Sparse (하이브리드)

- **Dense:** Sentence-Transformers  
  - 기본 모델: `dragonkue/multilingual-e5-small-ko` (`EMBEDDING_MODEL_NAME`)
- **Sparse:** BM25 (`pinecone-text`, `bm25_encoder.json` — `scripts/train_bm25.py`로 학습)
- **비중:** `PINECONE_SEARCH_ALPHA` (기본 **0.7**) — dense 쪽 가중이 큼  
  - `hybrid_convex_scale`로 dense/sparse 벡터 스케일 후 Pinecone `query`

### 2.3 임베딩에 넣는 텍스트 (`build_place_embed_text`)

장소명, 유형(카테고리·추천업종), 시·도/시·군·구, 주소, 설명(최대 1000자), 추천 대상, 크롤링 블로그 후기(최대 3건×500자)를 줄 단위로 합침.

### 2.4 인덱스·메타데이터

- 인덱스명: `PINECONE_INDEX` (기본 `localvibe-hybrid`)
- 벡터 ID: `place_{id}` (부트스트랩) / `doc_{id}` (아티클 생성 시 place 벡터 대체)
- 검색 시 `region`, `province`, `category` 메타데이터 필터 가능

### 2.5 갤러리 검색 최종 점수 (`search_gallery`)

Pinecone Top-K(기본 20) 유사도에 대해 MySQL에서 트렌드·최신성·지역 일치를 더해 **재정렬**:

```
final = 0.6×similarity + 0.25×trend + 0.1×recency + 0.05×location
```

추가 부스트(환경변수로 조절):

- 질의 내 **지명 힌트** (`_LOCALITY_TOKENS`) → DB 보강 + `GALLERY_LOCALITY_HINT_SCORE_BOOST`
- **여행 테마** (`trip_themes`) → must-visit / theme 매칭 시 가산, deprioritize 시 감점
- 실제 표시 이미지 없는 장소 제외 (`GALLERY_REQUIRE_REAL_IMAGE`)

---

## 3. 추천 파이프라인 (코드·로직)

### 3.1 공통 코어 — `recommend_core.py`

갤러리·메인 채팅·트립 플래너가 **같은 후보·선택 로직**을 공유.

| 함수 | 역할 |
|------|------|
| `gallery_search_place_ids` | `/api/search`와 동일한 `search_gallery` → place_id 목록 |
| `build_gallery_baseline_ids` | 갤러리 검색 + Pinecone + `_build_recommendation_ids` 병합 |
| `build_trip_baseline_ids` | 트립: 지역 필터·이미 일정에 있는 id 제외·lexical 병합 |
| `select_ids_with_dspy` | 후보 중 DSPy 최종 id + answer (실패 시 `[]`) |
| `apply_trip_theme_priority` | 테마 프로필로 id 순서 재정렬 |

환경변수 예: `CHAT_PINECONE_TOP_K=30`, `CHAT_PINECONE_MIN_RESULTS=5`

### 3.2 규칙 기반 재랭킹 — `chat_service._build_recommendation_ids`

Pinecone/검색 후보 각 행에 대해:

1. **토큰·지명·포커스 키워드** 스코어 (`_score_row`)
2. **의도 부스트** (`_apply_intent_score_boost`) — mood/relation/테마/제외(사찰 등)
3. **트렌드 DB 점수** × `CHAT_TREND_SCORE_WEIGHT` (기본 6.0)
4. 지역·이름 중복 제거 후 상위 N개 (갤러리 기본 9개 `FEED_TOP_K`)

→ “LLM만 믿지 않고” **검색 + 규칙 + (선택) LLM** 3단 구조.

### 3.3 트립 플래너 (`chat_service` 트립 경로)

1. `_parse_intent` — 여행 relation/mood/transport/duration
2. `build_trip_baseline_ids` — 후보 place_id
3. `select_ids_with_dspy` — `USE_DSPY_GALLERY=true`일 때 DSPy 우선
4. 없으면 baseline → `apply_trip_theme_priority`
5. OpenAI에 **JSON 스키마**로 `recommendedRegionIds`, `schedule`, `detectedAction`, `answer` 요청
6. `trip_planner_utils` — 일정 슬롯·지오·교체 동작

### 3.4 테마·제외 규칙 — `trip_themes.py`, `place_preferences.py`

- `detect_trip_theme_profile`: “성심당”, “광안리”, “야구” 등 → `themes`, `mustVisit`
- `dspy_theme_instruction_lines` / `exclusion_prompt_lines`: DSPy·GPT 프롬프트에 **[필수]** 줄 삽입
- `filter_ids_by_exclusions`: 사찰 제외 등 후처리

### 3.5 프론트 연동

- 갤러리: 검색 API → 카드 피드
- 트립: `TripChatPanel` → `/api/chat/trip` → `tripSchedule.js`로 일정·로드맵 반영

---

## 4. DSPy (프롬프트 최적화·2단 추론)

### 4.1 구현 위치

- `back/app/services/dspy_recommender.py`
- 학습 결과물: `back/dspy_gallery_optimized.json` (MIPROv2 최적화 weights)
- 의존성: `dspy-ai` (`requirements.txt`)

### 4.2 모듈 구조

```
GallerySearchRecommender (dspy.Module)
  ├─ ChainOfThought(GallerySearchIntent)     # 질문 → relation, mood, transport, region
  └─ ChainOfThought(GallerySearchRecommendation)  # 후보 목록 + intent_summary → answer, recommended_ids
```

- LM: `DSPY_OPENAI_MODEL` (기본 `gpt-4o-mini`)
- **활성화:** `USE_DSPY_GALLERY=true` + API 키 + (선택) `DSPY_GALLERY_MODEL_PATH`

### 4.3 런타임 흐름 (`run_dspy_gallery_search`)

1. 최적화 JSON 로드 시도 → 없으면 기본 `GallerySearchRecommender`
2. `user_query` + `place_list`(id/이름/지역/유형/요약 줄 목록)
3. `recommended_ids` 파싱 → API 응답 필드명 `recommendedRegionIds`로 매핑
4. 실패·빈 id → **Pinecone/baseline 순위 유지** (로그: `[DSPY] id 없음`)

### 4.4 오프라인 최적화

- `_TRAINSET_RAW`: 연인·분좌카·혼행·맛집 등 **예시 Q&A** (id + answer)
- `optimize_and_save()` → `dspy.MIPROv2` 로 시그니처·프롬프트 튜닝
- CLI: `python -m app.services.dspy_recommender --optimize` / `--infer`

### 4.5 발표용 한 문장

> “벡터 검색으로 후보를 좁힌 뒤, DSPy Chain-of-Thought로 **의도 분석 → 목록 내 최종 선택**을 하고, MIPROv2로 발표 데모용 예시에 맞게 프롬프트를 오프라인 튜닝했습니다.”

---

## 5. 하드코딩·템플릿 프롬프트 목록

### 5.1 `chat_service.py` (핵심)

| 상수/함수 | 내용 |
|-----------|------|
| `_RELATION_SYSTEM_PROMPTS` | couple / family / formal / friends / solo 별 **큐레이터 역할** |
| `_DEFAULT_SYSTEM_PROMPT` | LocalVibe 도우미, 9곳 id, 분위기 우선 |
| `_ATMOSPHERE_CURATION_RULES` | 요약 읽고 분위기 매칭, answer에 이유 한두 문장 |
| `_parse_intent` system | relation/mood/transport/duration **JSON 분류 규칙** (분좌카→calm 등) |
| `_build_system_prompt` | relation base + mood/transport/duration/테마/제외 **extras** |
| `_MOOD_BOOST_KEYWORDS`, `_RELATION_TARGET_KEYWORDS` | 재랭킹 키워드 (코드 상수) |
| 트립 OpenAI 호출 | 지역 `prov_f`/`reg_f` 강제, `exclusion_prompt_lines`, JSON only |

### 5.2 `trip_themes.py`

- `dspy_theme_instruction_lines`: must-visit·테마별 **[필수]** 지시문 (맛집/해변/야구 등)

### 5.3 `place_preferences.py`

- `exclusion_prompt_lines`: 사찰·종교시설 **절대 추천 금지** 문구

### 5.4 `dspy_recommender.py`

- `GallerySearchIntent` / `GallerySearchRecommendation` **Signature docstring** (필드 desc)
- 학습용 `answer` + `recommended_ids` 예시 문장 다수 (`_TRAINSET_RAW`)

### 5.5 기타 서비스

| 파일 | 용도 |
|------|------|
| `article_service.py` | 지역 아티클 생성 system 프롬프트 |
| `visual.py` | 트립 비주얼/이미지 설명 system |
| `comparison_utils.py` | 장소 비교 한 줄 요약 user prompt |
| `summary_service.py` | 장소 요약 생성 |

### 5.6 프론트

| 파일 | 용도 |
|------|------|
| `TripChatPanel.jsx` | `HELP_TEXT` — 사용자 도움말 (채팅 UI) |

---

## 6. 환경 변수 치트시트 (발표 슬라이드용)

| 변수 | 기본 | 의미 |
|------|------|------|
| `PINECONE_API_KEY` / `PINECONE_INDEX` | — | 벡터 DB |
| `PINECONE_SEARCH_ALPHA` | 0.7 | dense/sparse 혼합 |
| `EMBEDDING_MODEL_NAME` | multilingual-e5-small-ko | dense 모델 |
| `GALLERY_SEARCH_TOP_K` | 20 | Pinecone 1차 K |
| `USE_DSPY_GALLERY` | false | DSPy 최종 선택 on/off |
| `DSPY_GALLERY_MODEL_PATH` | dspy_gallery_optimized.json | 최적화 weights |
| `CHAT_PINECONE_TOP_K` | 30 | 채팅·트립 후보 K |
| `OPENAI_API_KEY` / `OPEN_API_KEY` | — | GPT·DSPy LM |

---

## 7. 발표 멘트 제안 (30초 × 2)

**검색:**  
“관광 데이터를 장소 단위로 임베딩하고, 한국어 dense 모델과 BM25 sparse를 섞은 Pinecone 하이브리드로 의미 검색합니다. 유사도만 쓰지 않고 트렌드·최신성·지명·여행 테마를 점수에 반영해 갤러리 순위를 만듭니다.”

**추천·AI:**  
“채팅과 트립 플래너는 같은 recommend 코어를 씁니다. 벡터 후보를 규칙으로 재랭킹하고, 옵션으로 DSPy 2단 CoT로 최종 id를 고릅니다. 일정 생성은 동행·무드별 system 프롬프트와 JSON 스키마로 LLM 출력을 구조화해 프론트 일정표에 붙입니다.”

---

## 8. 데모 시 체크리스트

- [ ] Pinecone·MySQL 연결 (검색 0건이면 임베딩/키 확인)
- [ ] DSPy 켜려면 `USE_DSPY_GALLERY=true` + OpenAI 키
- [ ] “연인 + 분좌카 + ○○시” / “사찰 빼고” 등 **의도·제외** 문장 준비
- [ ] 트립: 채팅 후 로드맵·일정 슬롯이 채워지는지 확인

---

*문서 기준 브랜치: `test1` · 코드 경로는 `back/app/services/`, `back/app/repositories/` 기준.*
