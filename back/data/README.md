`regions.json`은 API가 직접 읽는 데이터셋 파일입니다.

- 앱 코드(`main.py`)를 수정하지 않고 데이터만 교체할 수 있습니다.
- 실제 데이터로 바꾸려면 동일한 필드 키를 유지해서 파일만 업데이트하면 됩니다.
- `JN_LEPORTS_SERVICE_KEY`가 설정되면 전라남도 테마여행 공공 API를 우선 사용하고,
  실패하거나 미설정이면 이 파일을 폴백 데이터로 사용합니다.
- `JN_API_ENDPOINT_URLS`(콤마 구분)에 여러 API 엔드포인트를 넣으면
  각 엔드포인트 데이터를 병합한 뒤 중복 제거하여 사용합니다.
- `JN_API_ENDPOINT_URLS`에 base URL을 넣으면 list 상세기능으로 자동 확장됩니다.
  - `.../jnCourseInfo` -> `/getCoursePlanList`, `/getCourseList`, `/getCourseImgList`
- `JN_COURSE_CATEGORIES`로 `getCourseList` 계절 카테고리를 지정할 수 있습니다.
- `JN_COURSE_PLAN_MAX`로 코스 상세 조회 최대 건수를 제한합니다.
- `JN_COURSE_PLAN_REQUEST_INTERVAL`로 코스 상세 API 요청 간격(초)을 설정합니다.
- `JN_COURSE_PLAN_EMPTY_BREAK`로 코스 상세 API 연속 빈 응답 시 조기 중단 기준을 설정합니다.
- `JN_COURSE_EMPTY_CATEGORY_BREAK`로 연속 빈 응답 시 조기 중단 기준을 설정합니다.
- `JN_COURSE_IMG_MAX_REQUEST`로 이미지 API 요청 상한을 설정합니다.
- `JN_COURSE_IMG_REQUEST_INTERVAL`로 이미지 API 요청 간격(초)을 설정합니다.
- `JN_COURSE_IMG_EMPTY_BREAK`로 이미지 API 연속 빈 응답 시 조기 중단 기준을 설정합니다.
- `JN_COURSE_DISABLE_IMAGE_FETCH=1`로 이미지 API 자체를 비활성화할 수 있습니다.
- `JN_COURSE_IMG_CACHE_TTL_SECONDS`로 이미지 캐시 유지 시간을 설정합니다.
- `JN_EXTERNAL_CACHE_TTL_SECONDS`로 외부 지역 데이터 캐시 유지 시간을 설정합니다.
- `JN_EXTERNAL_CACHE_STALE_SECONDS`로 외부 API 실패 시 허용할 만료 캐시 유효 시간을 설정합니다.
- `JN_EXTERNAL_429_COOLDOWN_SECONDS`로 429 발생 후 외부 API 재시도 지연 시간을 설정합니다.
- `JN_API_RETRY_COUNT`로 외부 API 재시도 횟수를 설정합니다.
- `JN_API_RETRY_WAIT_SECONDS`, `JN_API_429_WAIT_SECONDS`로 재시도 대기시간을 제어합니다.

`course_image_cache.json`은 마지막으로 성공한 이미지 매핑을 저장합니다.
- API가 429로 막혀도 캐시가 살아있는 동안에는 기존 이미지를 계속 사용합니다.
`external_regions_cache.json`은 마지막으로 성공한 외부 지역 목록을 저장합니다.
- API가 429로 막혀도 캐시가 살아있는 동안에는 목록/이미지를 계속 사용합니다.

필수 필드:
- `id` (number)
- `name` (string)
- `imageUrl` (string)
- `summary` (string)
- `recommendedBusinesses` (string[])
- `busyHours` (string[])
- `targetCustomers` (string[])

선택 필드:
- `province`
- `dataSource`
