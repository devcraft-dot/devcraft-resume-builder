-- Allow full salary blurbs scraped from job boards (Greenhouse, etc.).
-- Idempotent: safe to run multiple times.

ALTER TABLE generations
    ALTER COLUMN salary_range TYPE VARCHAR(2000);
