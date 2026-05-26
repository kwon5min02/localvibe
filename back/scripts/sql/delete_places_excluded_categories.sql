-- 로컬/스테이징 에서 검토 후 실행. 백업 권장.
-- places.crawled_images / crawled_texts 가 ON DELETE CASCADE 이면 자식까지 같이 삭제됨.

SELECT category, COUNT(*) AS cnt FROM places GROUP BY category ORDER BY cnt DESC;

DELETE FROM places
WHERE category IN ('축제/공연', '여행코스');
