-- =============================================================================
-- First Secretary account for a new database
-- =============================================================================
--
-- Run once, right after schema.sql. A fresh database has no users, so nobody
-- could log in to create one through the app.
--
-- 1. Change the four values below.
-- 2. SQL Editor -> paste -> Run.
-- 3. Log in with that username and password. The app asks for a new password
--    straight away (must_change_password), so the one typed here is only
--    used once.
--
-- The password is hashed with bcrypt inside Postgres (pgcrypto), the same
-- format the backend's bcrypt.compare() checks. The plain-text password is
-- not stored anywhere, but it does stay in the SQL Editor history, which is
-- one more reason it gets changed on first login.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

INSERT INTO users (name, username, email, password, role, position, must_change_password)
VALUES (
  'SB Secretary',                   -- full name
  'secretary',                      -- username (lowercase)
  'secretary@example.com',          -- email (password-reset links go here)
  extensions.crypt('ChangeMe123', extensions.gen_salt('bf', 10)),  -- temporary password
  'admin',
  'secretary',
  true
)
ON CONFLICT DO NOTHING;
