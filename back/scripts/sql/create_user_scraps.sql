-- 선택: Alembic 없이 수동 생성 시 (앱 init_db가 동일 스키마를 create_all 함)
CREATE TABLE IF NOT EXISTS user_scraps (
  scrap_id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  place_id BIGINT NOT NULL,
  created_at DATETIME NULL,
  PRIMARY KEY (scrap_id),
  UNIQUE KEY uq_user_scraps_user_place (user_id, place_id),
  KEY ix_user_scraps_user_id (user_id),
  KEY ix_user_scraps_place_id (place_id),
  CONSTRAINT fk_user_scraps_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_scraps_place FOREIGN KEY (place_id) REFERENCES places (place_id) ON DELETE CASCADE
);
