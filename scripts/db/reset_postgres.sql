-- Resume Builder — PostgreSQL: drop all app tables and recreate current schema.
-- WARNING: Deletes ALL rows in these tables. Run only on the intended database.
--
-- After DROP: either run the CREATE section below, or redeploy/restart the API
-- (ensure_schema() calls Base.metadata.create_all + client_username patches).
--
-- Tables (current): users, generations, application_screenshots, registered_profiles

BEGIN;

-- ─── 1. Remove everything (child tables first) ───────────────────────────────
DROP TABLE IF EXISTS generations CASCADE;
DROP TABLE IF EXISTS application_screenshots CASCADE;
DROP TABLE IF EXISTS registered_profiles CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Optional: wipe entire public schema (Neon/dev only — affects non-app objects too)
-- DROP SCHEMA public CASCADE;
-- CREATE SCHEMA public;
-- GRANT ALL ON SCHEMA public TO public;

-- ─── 2. Recreate schema (matches app/models/*.py as of auth work) ────────────

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    email           VARCHAR(320) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    is_admin        BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX ix_users_email ON users (email);

CREATE TABLE registered_profiles (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    name            VARCHAR(200) NOT NULL UNIQUE,
    profile_text    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX ix_registered_profiles_name ON registered_profiles (name);

CREATE TABLE generations (
    id                  SERIAL PRIMARY KEY,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id             INTEGER REFERENCES users (id) ON DELETE SET NULL,
    profile_name        VARCHAR(200) NOT NULL,
    stage               VARCHAR(50) NOT NULL DEFAULT 'generated',
    title               VARCHAR(500) NOT NULL,
    company_name        VARCHAR(500) NOT NULL DEFAULT '',
    salary_range        VARCHAR(200) NOT NULL DEFAULT '',
    note                VARCHAR(2000) NOT NULL DEFAULT '',
    url                 VARCHAR(2000) NOT NULL,
    resume_drive_url    VARCHAR(2000) NOT NULL DEFAULT '',
    questions_drive_url VARCHAR(2000) NOT NULL DEFAULT '',
    jd_drive_url        VARCHAR(2000) NOT NULL DEFAULT '',
    model_name          VARCHAR(100) NOT NULL DEFAULT '',
    client_username     VARCHAR(200)
);

CREATE INDEX ix_generations_user_id ON generations (user_id);
CREATE INDEX ix_generations_url ON generations (url);
CREATE INDEX ix_generations_client_username ON generations (client_username);
CREATE INDEX ix_generations_created_at ON generations (created_at);
CREATE INDEX ix_generations_stage_created_at ON generations (stage, created_at);
CREATE INDEX ix_generations_profile_name ON generations (profile_name);
CREATE INDEX ix_generations_model_name ON generations (model_name);

CREATE TABLE application_screenshots (
    id              SERIAL PRIMARY KEY,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    user_id         INTEGER REFERENCES users (id) ON DELETE SET NULL,
    drive_url       VARCHAR(2000) NOT NULL,
    filename        VARCHAR(500) NOT NULL,
    job_title       VARCHAR(500) NOT NULL DEFAULT '',
    company_name    VARCHAR(500) NOT NULL DEFAULT '',
    file_mime       VARCHAR(80) NOT NULL DEFAULT '',
    client_username VARCHAR(200)
);

CREATE INDEX ix_application_screenshots_user_id ON application_screenshots (user_id);
CREATE INDEX ix_application_screenshots_client_username ON application_screenshots (client_username);
CREATE INDEX ix_application_screenshots_created_at ON application_screenshots (created_at);

COMMIT;
