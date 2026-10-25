-- Apply once through D1 migrations, after inspecting existing schema/history.
-- Existing accounts intentionally retain unknown expiry until checked again.
ALTER TABLE threads_accounts ADD COLUMN token_expires_at TEXT;
ALTER TABLE threads_accounts ADD COLUMN data_access_expires_at TEXT;
ALTER TABLE threads_accounts ADD COLUMN permissions_checked_at TEXT;
ALTER TABLE threads_accounts ADD COLUMN last_error_code TEXT;
