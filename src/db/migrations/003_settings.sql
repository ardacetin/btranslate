-- Key/value application settings (managed from the admin panel).
CREATE TABLE IF NOT EXISTS settings (
  `key`      VARCHAR(64) PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
