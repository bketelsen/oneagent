export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS runs (
  id          TEXT PRIMARY KEY,
  issue_key   TEXT NOT NULL,
  provider    TEXT NOT NULL,
  model       TEXT,
  status      TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  completed_at TEXT,
  duration_ms  INTEGER,
  retry_count  INTEGER DEFAULT 0,
  error        TEXT,
  token_usage  TEXT
);

CREATE TABLE IF NOT EXISTS run_events (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id  TEXT NOT NULL REFERENCES runs(id),
  type    TEXT NOT NULL,
  payload TEXT NOT NULL,
  ts      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS planning_sessions (
  id         TEXT PRIMARY KEY,
  issue_key  TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  history    TEXT NOT NULL,
  plan       TEXT,
  status     TEXT DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id      TEXT REFERENCES runs(id),
  provider    TEXT NOT NULL,
  model       TEXT,
  tokens_in   INTEGER,
  tokens_out  INTEGER,
  duration_ms INTEGER,
  ts          TEXT NOT NULL
);
`;
