-- BTranslate initial schema (MySQL / InnoDB / utf8mb4)

CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(64) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  role           ENUM('admin','user') NOT NULL DEFAULT 'user',
  created_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sessions (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  event_code       VARCHAR(32) NOT NULL UNIQUE,
  title            VARCHAR(255) NOT NULL DEFAULT 'Live Event',
  source_language  VARCHAR(8) NOT NULL DEFAULT 'tr',
  target_language  VARCHAR(8) NOT NULL DEFAULT 'en',
  status           ENUM('live','ended') NOT NULL DEFAULT 'live',
  started_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at         DATETIME NULL,
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Only FINAL (concluded) segments are stored. Tentative text is never persisted.
CREATE TABLE IF NOT EXISTS transcript_segments (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  session_id       INT NOT NULL,
  source_text      TEXT NOT NULL,
  translated_text  TEXT NOT NULL,
  source_language  VARCHAR(8) NOT NULL,
  target_language  VARCHAR(8) NOT NULL,
  started_at       DATETIME NULL,
  ended_at         DATETIME NULL,
  created_at       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_segment_session FOREIGN KEY (session_id)
    REFERENCES sessions(id) ON DELETE CASCADE,
  INDEX idx_session (session_id),
  INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
