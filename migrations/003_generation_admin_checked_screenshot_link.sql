-- Per-generation admin review flag + link application screenshots to a generation row.
-- Idempotent (safe to run multiple times). Current 001_add_auth_and_profiles.sql already defines
-- these columns and the index for greenfield installs; use this file to patch older databases that
-- were created from an earlier 001 before admin_checked / generation_id existed.

ALTER TABLE generations ADD COLUMN IF NOT EXISTS admin_checked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE application_screenshots ADD COLUMN IF NOT EXISTS generation_id INTEGER REFERENCES generations (id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS ix_application_screenshots_generation_id ON application_screenshots (generation_id);
