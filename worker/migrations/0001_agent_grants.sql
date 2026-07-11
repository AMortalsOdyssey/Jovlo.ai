CREATE TABLE agent_grants (
  grant_hash TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  encrypted_session TEXT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'processing', 'consumed')),
  request_hash TEXT,
  result_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at INTEGER
);

CREATE INDEX agent_grants_expiry_idx ON agent_grants (expires_at);
