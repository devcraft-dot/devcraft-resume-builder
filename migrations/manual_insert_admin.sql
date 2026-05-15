-- Manual admin user: insert a row with bcrypt(password_hash), same format as the app (`app.core.passwords`).
--
-- Step 1 — Generate the hash (from repo root):
--   pip install -r requirements.txt
--   python samples/generate_admin_password_hash.py "your-secure-password"
--
-- Step 2 — Copy the ONE line of output (starts with $2b$ or $2a$). No spaces or quotes.
--
-- Step 3 — Choose a unique username (lowercase recommended). Paste username + hash into INSERT below.

-- Optional: remove existing admins first
-- DELETE FROM users WHERE role = 'admin';

INSERT INTO users (username, display_name, role, password_hash, is_active)
VALUES (
    'admin',
    'Admin',
    'admin',
    '$2b$12$qQtzBXo6aEkBMdWrEWvNIOCBtXsfieR8BgeFhP.HX.y.XgD/LohWm',
    true
);

-- Step 4 — Sign in with the same plaintext password you used in step 1 (not the hash).
-- Replace the placeholder hash above with your generated hash before running.
