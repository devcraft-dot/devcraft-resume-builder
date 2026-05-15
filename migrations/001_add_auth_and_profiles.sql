-- Resume-builder: Postgres schema aligned with SQLAlchemy models (JWT auth, profiles, generations, snips).
--
-- Greenfield: run 000_drop_all_tables.sql (optional), then this file. Do not wrap the whole script in EXPLAIN.
--
-- Existing DB on an older schema: this file’s CREATE IF NOT EXISTS + ALTER ADD IF NOT EXISTS sections
-- catch up most drift; also run 002_users_password_jwt.sql if users still use token_hash, and
-- 003_generation_admin_checked_screenshot_link.sql if you never merged those columns into 001.
--
-- Code source of truth:
--   app/models/user.py, registered_profile.py, user_profile_assignment.py
--   app/models/generation.py, application_screenshot.py

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    display_name VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username ON users (username);
CREATE INDEX IF NOT EXISTS ix_users_role ON users (role);

-- ---------------------------------------------------------------------------
-- registered_profiles
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS registered_profiles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(200) NOT NULL,
    model VARCHAR(100) NOT NULL,
    profile_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_registered_profiles_name ON registered_profiles (name);

-- ---------------------------------------------------------------------------
-- user_profile_assignments
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_profile_assignments (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    profile_id INTEGER NOT NULL REFERENCES registered_profiles (id) ON DELETE CASCADE,
    CONSTRAINT uq_user_profile UNIQUE (user_id, profile_id)
);

CREATE INDEX IF NOT EXISTS ix_user_profile_assignments_user_id ON user_profile_assignments (user_id);
CREATE INDEX IF NOT EXISTS ix_user_profile_assignments_profile_id ON user_profile_assignments (profile_id);

-- ---------------------------------------------------------------------------
-- generations (resume rows — API + extensions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS generations (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    profile_name VARCHAR(200) NOT NULL,
    stage VARCHAR(50) NOT NULL DEFAULT 'generated',
    title VARCHAR(500) NOT NULL,
    company_name VARCHAR(500) NOT NULL DEFAULT '',
    salary_range VARCHAR(200) NOT NULL DEFAULT '',
    note VARCHAR(2000) NOT NULL DEFAULT '',
    url VARCHAR(2000) NOT NULL,
    resume_drive_url VARCHAR(2000) NOT NULL DEFAULT '',
    questions_drive_url VARCHAR(2000) NOT NULL DEFAULT '',
    jd_drive_url VARCHAR(2000) NOT NULL DEFAULT '',
    model_name VARCHAR(100) NOT NULL DEFAULT '',
    admin_checked BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS ix_generations_created_at ON generations (created_at);
CREATE INDEX IF NOT EXISTS ix_generations_stage_created_at ON generations (stage, created_at);
CREATE INDEX IF NOT EXISTS ix_generations_profile_name ON generations (profile_name);
CREATE INDEX IF NOT EXISTS ix_generations_model_name ON generations (model_name);
CREATE INDEX IF NOT EXISTS ix_generations_url ON generations (url);

-- Legacy DBs: generations existed before user_id
ALTER TABLE generations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_generations_user_id ON generations (user_id);
CREATE INDEX IF NOT EXISTS ix_generations_user_created_at ON generations (user_id, created_at);

-- Dedup per user (Postgres allows multiple NULL user_id with same url/profile for legacy rows)
CREATE UNIQUE INDEX IF NOT EXISTS ix_generations_user_url_profile ON generations (user_id, url, profile_name);

-- ---------------------------------------------------------------------------
-- application_screenshots (Manual JD snips; optional link to a generation row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_screenshots (
    id SERIAL PRIMARY KEY,
    generation_id INTEGER REFERENCES generations (id) ON DELETE SET NULL,
    user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    drive_url VARCHAR(2000) NOT NULL,
    filename VARCHAR(500) NOT NULL,
    job_title VARCHAR(500) NOT NULL DEFAULT '',
    company_name VARCHAR(500) NOT NULL DEFAULT '',
    file_mime VARCHAR(80) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_application_screenshots_created_at ON application_screenshots (created_at);
CREATE INDEX IF NOT EXISTS ix_application_screenshots_generation_id ON application_screenshots (generation_id);

ALTER TABLE application_screenshots ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;
ALTER TABLE application_screenshots ADD COLUMN IF NOT EXISTS generation_id INTEGER REFERENCES generations (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_application_screenshots_user_id ON application_screenshots (user_id);

-- ---------------------------------------------------------------------------
-- Idempotent catch-up (older generations rows without admin_checked)
-- ---------------------------------------------------------------------------
ALTER TABLE generations ADD COLUMN IF NOT EXISTS admin_checked BOOLEAN NOT NULL DEFAULT FALSE;
