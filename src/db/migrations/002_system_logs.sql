-- Persistent system logs (lifecycle/connection events). Rows older than 30
-- days are pruned automatically by the app.
CREATE TABLE IF NOT EXISTS system_logs (
  id          BIGINT AUTO_INCREMENT PRIMARY KEY,
  level       VARCHAR(10) NOT NULL DEFAULT 'INFO',
  message     TEXT NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_logs_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
