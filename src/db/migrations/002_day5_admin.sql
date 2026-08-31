-- src/db/migrations/002_day5_admin.sql
-- PURPOSE: Schema additions the Day 5 admin panel needs but that don't exist in
-- the Day 1 schema. Run this AFTER schema.sql on an existing database.
-- INTENDED OUTPUT LINK: without these, three advertised admin features cannot
-- work at all — muting a user (no flag to set), system settings (nowhere to store
-- them), and toggling countries on the map (no per-country switch).
--
-- USAGE:  psql "$DATABASE_URL" -f src/db/migrations/002_day5_admin.sql
-- NOTE: every statement uses IF NOT EXISTS so re-running it is harmless.

-- ---------------------------------------------------------------------------
-- 1) Per-user chat mute (admin moderation).
-- ---------------------------------------------------------------------------
-- is_active already exists and bans the account entirely. chat_disabled is the
-- softer moderation step required by the spec: the user can still log in and
-- browse the map, but cannot SEND messages.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS chat_disabled BOOLEAN NOT NULL DEFAULT FALSE; -- FALSE = chat allowed (the normal state).

-- ---------------------------------------------------------------------------
-- 2) System settings (key/value so new options need no further migrations).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
  key        VARCHAR(64) PRIMARY KEY,                 -- Setting name, e.g. 'maintenance_mode'.
  value      TEXT,                                    -- Value stored as text; the app casts it as needed.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()       -- When it last changed (useful in the audit trail).
);

-- Seed the defaults described in the spec. ON CONFLICT DO NOTHING means existing
-- values are preserved if this migration is run again.
INSERT INTO settings (key, value) VALUES
  ('api_refresh_hours', '24'),      -- How often the scholarship refresh should run.
  ('upload_limit_mb',   '5'),       -- Profile photo size cap (mirrors the multer limit).
  ('allowed_formats',   'jpg,png'), -- Permitted image types.
  ('logging_level',     'info'),    -- Verbosity of server logs.
  ('maintenance_mode',  'false')    -- When 'true', the API returns 503 to normal users.
ON CONFLICT (key) DO NOTHING;       -- Never overwrite an admin's configured value.

-- ---------------------------------------------------------------------------
-- 3) Country toggles for the map.
-- ---------------------------------------------------------------------------
-- Lets an admin hide a country from the map without editing the GeoJSON file.
-- A country absent from this table is treated as ENABLED by default, so the map
-- keeps working before any toggles are configured.
CREATE TABLE IF NOT EXISTS countries_enabled (
  country  VARCHAR(120) PRIMARY KEY,                  -- Must match the GeoJSON properties.name exactly (see countries.js).
  enabled  BOOLEAN NOT NULL DEFAULT TRUE              -- FALSE hides the country from the map UI.
);

-- ---------------------------------------------------------------------------
-- 4) Helpful index for the moderation log view.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC); -- Newest-first listing in the admin panel.
