-- Reconnect resumes future reservations only: overdue queued reservations are
-- held (paused per post) until an explicitly confirmed resume. Daily token
-- expiry checks store the latest per-account connection health snapshot.
ALTER TABLE threads_posts ADD COLUMN paused_hold INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS threads_health_checks (
  account_id TEXT PRIMARY KEY,
  checked_at TEXT NOT NULL,
  overall TEXT NOT NULL,
  checks_json TEXT NOT NULL
);
