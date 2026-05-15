-- Resume-builder: API token auth, registered profiles, per-user generations.
-- Run once against your Postgres (e.g. Neon) if the DB already existed before this feature.
-- Fresh installs can rely on SQLAlchemy create_all instead.
--
-- Run as normal SQL only. Do not wrap the whole script in EXPLAIN (use Run / execute).
--
-- Includes core tables `generations` and `application_screenshots` (resume pipeline + uploads).
-- Source of truth in code: app/models/generation.py, app/models/application_screenshot.py

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    display_name VARCHAR(200) NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'user',
    token_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ix_users_token_hash ON users (token_hash);
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
-- generations (resume generation rows — API /extensions write here)
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
    model_name VARCHAR(100) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_generations_created_at ON generations (created_at);
CREATE INDEX IF NOT EXISTS ix_generations_stage_created_at ON generations (stage, created_at);
CREATE INDEX IF NOT EXISTS ix_generations_profile_name ON generations (profile_name);
CREATE INDEX IF NOT EXISTS ix_generations_model_name ON generations (model_name);
CREATE INDEX IF NOT EXISTS ix_generations_url ON generations (url);

-- Legacy DBs: table existed before user_id column
ALTER TABLE generations ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_generations_user_id ON generations (user_id);
CREATE INDEX IF NOT EXISTS ix_generations_user_created_at ON generations (user_id, created_at);

-- Dedup scope per authenticated user (NULL user_id rows remain allowed for legacy data)
CREATE UNIQUE INDEX IF NOT EXISTS ix_generations_user_url_profile ON generations (user_id, url, profile_name);

-- ---------------------------------------------------------------------------
-- application_screenshots (Manual JD extension uploads)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS application_screenshots (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users (id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    drive_url VARCHAR(2000) NOT NULL,
    filename VARCHAR(500) NOT NULL,
    job_title VARCHAR(500) NOT NULL DEFAULT '',
    company_name VARCHAR(500) NOT NULL DEFAULT '',
    file_mime VARCHAR(80) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS ix_application_screenshots_created_at ON application_screenshots (created_at);

ALTER TABLE application_screenshots ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_application_screenshots_user_id ON application_screenshots (user_id);
