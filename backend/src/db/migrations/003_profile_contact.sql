-- src/db/migrations/003_profile_contact.sql
-- PURPOSE: Guarantee that the three profile columns this release depends on exist
-- on an ALREADY-DEPLOYED database, without recreating anything.
-- INTENDED OUTPUT LINK: without these columns three new features fail at runtime —
-- the "Cambiar foto" button in Profile.jsx (profile_photo_url), and the private
-- contact pair shown in Register.jsx, Profile.jsx and the admin edit form
-- (phone_country_code, phone_number).
--
-- WHY THIS FILE EXISTS AT ALL: all three columns are already declared in
-- schema.sql, so a database created from scratch today needs nothing. But a
-- database created from an earlier revision of schema.sql may be missing them, and
-- a missing column surfaces as a confusing 500 ("column does not exist") rather
-- than a clear error. Running this makes both cases identical.
--
-- USAGE:  psql "$DATABASE_URL" -f src/db/migrations/003_profile_contact.sql
-- NOTE: every statement uses IF NOT EXISTS, so re-running it is harmless and it is
-- safe to include in a deploy script that runs on every release.

-- ---------------------------------------------------------------------------
-- 1) Avatar path written by POST /auth/me/photo.
-- ---------------------------------------------------------------------------
-- TEXT (not VARCHAR(n)) because the value is a relative path today ("/uploads/ab12.jpg")
-- but becomes a long absolute URL the day storeAndGetUrl() moves to S3/Cloudinary.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_photo_url TEXT; -- NULL = no photo yet; the UI then shows the brand mark as a placeholder.

-- ---------------------------------------------------------------------------
-- 2) Private contact pair collected at registration and editable in "Mi perfil".
-- ---------------------------------------------------------------------------
-- Kept as two columns rather than one free-text field so the dialing code can be
-- validated and formatted independently of the number.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_country_code VARCHAR(8);  -- e.g. '+52'. Width mirrored by maxLength={8} in the React inputs and by the guard in auth.routes.js.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS phone_number VARCHAR(30);       -- The digits. NEVER selected by GET /users, which is what keeps it invisible to other students.

-- ---------------------------------------------------------------------------
-- 3) Verification query (run manually; it changes nothing).
-- ---------------------------------------------------------------------------
-- Expect exactly three rows back. If any is missing, the ALTERs above did not run
-- against the database your API is actually connected to (check DATABASE_URL).
-- SELECT column_name, data_type
--   FROM information_schema.columns
--  WHERE table_name = 'users'
--    AND column_name IN ('profile_photo_url', 'phone_country_code', 'phone_number');
