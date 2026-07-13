CREATE TABLE IF NOT EXISTS auth_email_rate_limits (
  throttle_key TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS auth_email_rate_limits_window_idx
  ON auth_email_rate_limits(window_started_at);
