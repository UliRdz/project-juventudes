-- src/db/schema.sql
-- PURPOSE: The single source of truth for the database structure. Applying this
-- file to an empty PostgreSQL database creates every table the platform needs.
-- INTENDED OUTPUT LINK: each table below directly backs a visible feature —
-- users -> profiles + map right panel, scholarships -> map left panel,
-- chats -> chat widget + email relay, admins -> admin panel, audit_logs -> security.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- Enable pgcrypto so we can call gen_random_uuid() for primary keys below.

-- ============================ USERS ==========================================
-- Backs registration/login (Day 2) and the "users in this country" list (Day 3).
CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Stable unique id; used as sender/receiver in chats and in JWT tokens.
  email             VARCHAR(255) UNIQUE NOT NULL,               -- Login identifier; UNIQUE prevents two accounts sharing an email.
  password_hash     TEXT NOT NULL,                             -- bcrypt hash only (never the raw password) — set in Day 2 registration.
  totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE,            -- Whether the user turned on 2FA; controls the second login step (Day 2).
  totp_secret       TEXT,                                      -- The shared TOTP secret (encrypted in prod); NULL until 2FA is set up.
  profile_photo_url TEXT,                                      -- URL of the uploaded avatar shown on the user's map card (Day 3).
  first_name        VARCHAR(80) NOT NULL,                      -- Shown on profile and user cards.
  last_name         VARCHAR(80) NOT NULL,                      -- Shown on profile and user cards.
  city_origin       VARCHAR(120),                              -- Hometown city (profile info; optional).
  state_origin      VARCHAR(120),                              -- Home state/region (profile info; optional).
  current_country   VARCHAR(120),                              -- KEY FIELD: the map filters users by this to fill a country's right panel (Day 3).
  current_city      VARCHAR(120),                              -- Displayed on the user card under their name.
  status            VARCHAR(20) CHECK (status IN ('working','studying')), -- Constrained to two values so the UI can render a reliable badge.
  institution_company VARCHAR(160),                            -- Where they study/work; searchable by admins (Day 5).
  phone_number      VARCHAR(30),                               -- Contact number (kept private; never returned in the public country list).
  phone_country_code VARCHAR(8),                               -- Dialing code stored separately for clean formatting/validation.
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,             -- Soft-delete/ban flag; admins flip this off instead of deleting rows (Day 5).
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()         -- Signup timestamp; feeds the "Total users" dashboard widget (Day 5).
);
CREATE INDEX idx_users_country ON users (current_country); -- Speeds up the frequent "WHERE current_country = ?" map query (Day 3).

-- ============================ ADMINS =========================================
-- Defined BEFORE scholarships because scholarships.created_by references it.
-- Backs the isolated admin login, separate from the user table (Day 5).
CREATE TABLE admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Admin id; recorded as created_by on manually entered scholarships.
  email         VARCHAR(255) UNIQUE NOT NULL,               -- Admin login email; UNIQUE so each admin is distinct.
  password_hash TEXT NOT NULL,                              -- bcrypt hash of the admin password (Day 5 admin login).
  totp_secret   TEXT                                        -- Optional admin 2FA secret; NULL if the admin hasn't enabled it.
);

-- ========================= SCHOLARSHIPS ======================================
-- Backs the map's LEFT panel and the CMS. Rows come from the 24h API import
-- (Day 4) OR from admins typing them in manually (Day 5).
CREATE TABLE scholarships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),          -- Unique id used by edit/delete endpoints.
  institution_name VARCHAR(200) NOT NULL,                             -- Shown as the scholarship card title.
  country         VARCHAR(120) NOT NULL,                              -- KEY FIELD: filters scholarships to the clicked country (Day 3).
  category        VARCHAR(20) CHECK (category IN ('high_school','university')), -- Splits the left panel into Preparatoria vs Universidad.
  areas           TEXT[],                                             -- Array of study areas; rendered as a comma-joined list on the card.
  start_date      DATE,                                               -- Application window start, shown on the card.
  end_date        DATE,                                               -- Application window end; the cron marks rows inactive once this passes (Day 4).
  link            TEXT,                                               -- External "Apply" URL opened from the card.
  description     TEXT,                                               -- Longer details for the scholarship.
  status          VARCHAR(20) NOT NULL DEFAULT 'active'               -- Active/inactive visibility flag...
                  CHECK (status IN ('active','inactive')),            -- ...constrained so the read query can safely filter status='active'.
  source          VARCHAR(20) NOT NULL DEFAULT 'manual'               -- Provenance: 'manual' (admin-typed) or 'api' (imported)...
                  CHECK (source IN ('manual','api')),                 -- ...so the nightly import can update API rows without touching manual ones.
  created_by      UUID REFERENCES admins(id),                         -- Which admin added a manual entry; NULL for API rows (Day 5 audit trail).
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()                  -- Last change time; feeds the "Last API update" dashboard widget (Day 5).
);
CREATE INDEX idx_scholarships_country ON scholarships (country); -- Speeds up the per-country left-panel query (Day 3).

-- Dedupe ONLY automated imports. Manual entries (internal scholarships, API
-- gaps) are intentionally left unconstrained so an admin can add several
-- programs for the same institution/country/category and remove them later.
CREATE UNIQUE INDEX uq_scholarship_api
  ON scholarships (institution_name, country, category) -- Uniqueness key for imported programs...
  WHERE source = 'api';                                 -- ...applied ONLY to API rows (this is what the Day 4 upsert's ON CONFLICT targets).

-- ============================ CHATS ==========================================
-- Backs the chat widget history and the email relay (Day 4).
CREATE TABLE chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),                 -- Unique message id (also usable by admin moderation delete, Day 5).
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,       -- Who sent it; CASCADE removes their messages if the user is deleted.
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,       -- Who receives it; also the address used to send the notification email.
  message     TEXT NOT NULL,                                             -- The message body shown in the widget and emailed to the recipient.
  read_at     TIMESTAMPTZ,                                               -- When it was read; NULL = unread, feeding the "Pending chats" widget (Day 5).
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()                         -- Sent timestamp; used to order the conversation chronologically.
);
CREATE INDEX idx_chats_pair ON chats (sender_id, receiver_id, created_at); -- Speeds up loading one conversation in time order (Day 4).

-- ========================== AUDIT LOGS =======================================
-- Security requirement: record login attempts and admin actions (Days 2 & 5).
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(), -- Unique log id.
  actor      VARCHAR(255),                               -- Who did it (email or admin id); nullable for anonymous attempts.
  action     VARCHAR(120) NOT NULL,                      -- What happened, e.g. 'login_success', 'user_deactivate'.
  ip         VARCHAR(64),                                -- Source IP, for anomaly/abuse detection.
  detail     JSONB,                                      -- Free-form structured extra data (e.g. the target user id).
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()          -- When it happened, for chronological security review.
);
