-- Upgrade path: API-token `users` table → username + password_hash (JWT auth in app).
--
-- New databases: use migrations/001_add_auth_and_profiles.sql only (creates users with username +
-- password_hash). Skip this file unless you are migrating an existing DB that still has token_hash.
--
-- You cannot derive passwords from old API token hashes.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OPTION A — Reset users (simplest if you have no data to keep)
-- ═══════════════════════════════════════════════════════════════════════════
-- TRUNCATE users CASCADE;
-- Then redeploy the API with JWT_SECRET_KEY, BOOTSTRAP_ADMIN_USERNAME,
-- BOOTSTRAP_ADMIN_PASSWORD. The app will create the first admin on startup.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- OPTION B — Keep the DB, add new columns (run in order)
-- ═══════════════════════════════════════════════════════════════════════════

-- Step B1 — Add new columns (safe to run anytime)
ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(100);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);

-- Step B2 — MUST populate every row before dropping token_hash or enforcing NOT NULL.
-- Example after generating a hash with: python samples/generate_admin_password_hash.py "YourPassword"
--   UPDATE users SET username = 'admin', password_hash = '$2b$12$...' WHERE id = 1;
-- Or delete all users: DELETE FROM users;
-- If any row still has NULL username or NULL password_hash, GET /api/admin/users will return 503.

-- Step B3 — Remove legacy column (only after every row has username + password_hash)
DROP INDEX IF EXISTS ix_users_token_hash;
ALTER TABLE users DROP COLUMN IF EXISTS token_hash;

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);

-- Step B4 — If the table was created without NOT NULL on the new columns, optional:
-- ALTER TABLE users ALTER COLUMN username SET NOT NULL;
-- ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;
