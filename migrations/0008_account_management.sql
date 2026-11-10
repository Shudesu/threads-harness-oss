-- account-mgmt/v1: additive only. Every write path (legacy API, token check,
-- failure recording, resume, delete+recreate) moves mgmt_revision via triggers.
ALTER TABLE threads_accounts ADD COLUMN mgmt_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE threads_accounts ADD COLUMN display_name TEXT;
ALTER TABLE threads_accounts ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS account_mgmt_sequence (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  value INTEGER NOT NULL
);
INSERT OR IGNORE INTO account_mgmt_sequence (id, value) VALUES (1, 0);
CREATE TABLE IF NOT EXISTS account_mgmt_receipts (
  operation_id TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  action TEXT NOT NULL,
  account_id TEXT,
  result_revision INTEGER,
  created_at TEXT NOT NULL
);
-- Existing rows receive distinct non-zero revisions before the triggers exist.
UPDATE threads_accounts SET mgmt_revision = (SELECT value FROM account_mgmt_sequence WHERE id = 1) + (SELECT COUNT(*) FROM threads_accounts t WHERE t.rowid <= threads_accounts.rowid);
UPDATE account_mgmt_sequence SET value = MAX(value, (SELECT COALESCE(MAX(mgmt_revision), 0) FROM threads_accounts)) WHERE id = 1;
CREATE TRIGGER IF NOT EXISTS threads_accounts_mgmt_revision_insert AFTER INSERT ON threads_accounts
BEGIN
  UPDATE account_mgmt_sequence SET value = value + 1 WHERE id = 1;
  UPDATE threads_accounts SET mgmt_revision = (SELECT value FROM account_mgmt_sequence WHERE id = 1) WHERE id = NEW.id;
END;
CREATE TRIGGER IF NOT EXISTS threads_accounts_mgmt_revision_update AFTER UPDATE ON threads_accounts
WHEN NEW.mgmt_revision IS OLD.mgmt_revision
BEGIN
  UPDATE account_mgmt_sequence SET value = value + 1 WHERE id = 1;
  UPDATE threads_accounts SET mgmt_revision = (SELECT value FROM account_mgmt_sequence WHERE id = 1) WHERE id = NEW.id;
END;
