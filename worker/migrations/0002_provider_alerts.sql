CREATE TABLE IF NOT EXISTS provider_alerts (
  alert_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code TEXT NOT NULL,
  last_message TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_sent_at INTEGER,
  occurrence_count INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS provider_alerts_last_seen_idx
  ON provider_alerts(last_seen_at DESC);
