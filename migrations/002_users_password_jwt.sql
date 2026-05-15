-- Upgrade path: API-token `users` table → username + password_hash (JWT auth in app).
-- Run after 001 if your database still has `token_hash`.
--
-- You cannot derive passwords from old API token hashes. Typical path:
--   1) TRUNCATE users CASCADE;  (or delete rows manually)
--   2) Redeploy API with JWT_SECRET_KEY, BOOTSTRAP_ADMIN_USERNAME, BOOTSTRAP_ADMIN_PASSWORD
--   3) First login creates admin via bootstrap, or use manual_insert_admin.sql
--
-- If you already added username/password_hash and populated them, drop the legacy column:

ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

DROP INDEX IF EXISTS ix_users_token_hash;
ALTER TABLE users DROP COLUMN IF EXISTS token_hash;

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);
