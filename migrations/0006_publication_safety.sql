-- Explicit resume after connection failures; preserve queued jobs and history.
ALTER TABLE threads_accounts ADD COLUMN queue_paused INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads_accounts ADD COLUMN last_error_kind TEXT;
ALTER TABLE threads_posts ADD COLUMN error_kind TEXT;
ALTER TABLE threads_posts ADD COLUMN next_attempt_at TEXT;
ALTER TABLE threads_posts ADD COLUMN status_check_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads_posts ADD COLUMN shares INTEGER;
CREATE INDEX threads_posts_pending_account ON threads_posts(account_id, status, scheduled_at);
