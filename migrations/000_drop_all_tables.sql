-- Destructive: removes all resume-builder application tables and data (including generations).
-- Run only when you intend a full reset. Then run 001_add_auth_and_profiles.sql to recreate
-- users, profiles, assignments, generations, and application_screenshots (JWT users, admin_checked,
-- application_screenshots.generation_id, etc.).
-- On a clean DB after 001, you do not need 002 or 003 unless you maintain a separate incremental
-- pipeline; those files upgrade older schemas in place.
-- Run as normal SQL; do not wrap in EXPLAIN.

DROP TABLE IF EXISTS user_profile_assignments CASCADE;
DROP TABLE IF EXISTS generations CASCADE;
DROP TABLE IF EXISTS application_screenshots CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS registered_profiles CASCADE;
