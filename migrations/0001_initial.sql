CREATE TABLE IF NOT EXISTS threads_accounts (
  id TEXT PRIMARY KEY, username TEXT NOT NULL, token_cipher TEXT,
  status TEXT NOT NULL DEFAULT 'connected', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS threads_posts (
  id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES threads_accounts(id),
  text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', scheduled_at TEXT,
  container_id TEXT, published_id TEXT, error_code TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS threads_posts_schedule ON threads_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS threads_posts_account ON threads_posts(account_id, created_at);
