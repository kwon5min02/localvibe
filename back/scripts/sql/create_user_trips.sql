-- 선택: 수동 생성 시 (앱 init_db가 create_all 함)
CREATE TABLE IF NOT EXISTS user_trips (
  trip_id INT NOT NULL AUTO_INCREMENT,
  user_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  created_at DATETIME NULL,
  PRIMARY KEY (trip_id),
  KEY ix_user_trips_user_id (user_id),
  CONSTRAINT fk_user_trips_user FOREIGN KEY (user_id) REFERENCES users (user_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_trip_places (
  entry_id INT NOT NULL AUTO_INCREMENT,
  trip_id INT NOT NULL,
  place_id BIGINT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  added_at DATETIME NULL,
  PRIMARY KEY (entry_id),
  UNIQUE KEY uq_user_trip_places_trip_place (trip_id, place_id),
  KEY ix_user_trip_places_trip_id (trip_id),
  KEY ix_user_trip_places_place_id (place_id),
  CONSTRAINT fk_user_trip_places_trip FOREIGN KEY (trip_id) REFERENCES user_trips (trip_id) ON DELETE CASCADE,
  CONSTRAINT fk_user_trip_places_place FOREIGN KEY (place_id) REFERENCES places (place_id) ON DELETE CASCADE
);
