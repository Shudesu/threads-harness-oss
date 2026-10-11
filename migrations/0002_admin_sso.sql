CREATE TABLE IF NOT EXISTS admin_sso_jti (
  jti TEXT PRIMARY KEY,
  seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sso_jti_seen_at ON admin_sso_jti(seen_at);
