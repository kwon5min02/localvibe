-- insight_json 내 Unsplash ktoImageUrl 제거 (MySQL 8+ JSON 함수)
-- Python 스크립트 권장: scripts/clear_placeholder_kto_images.py

UPDATE places
SET insight_json = JSON_SET(
  COALESCE(insight_json, '{}'),
  '$.ktoImageUrl',
  ''
)
WHERE insight_json IS NOT NULL
  AND insight_json LIKE '%images.unsplash.com%';
