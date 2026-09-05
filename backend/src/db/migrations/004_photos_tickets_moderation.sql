-- src/db/migrations/004_photos_tickets_moderation.sql
-- PURPOSE: One idempotent migration covering the three schema changes this patch
-- needs: (1) profile photos stored IN the database instead of on ephemeral disk,
-- (2) a support-ticket system behind the new "Ayuda" button, (3) conversation-level
-- columns so moderation can work per conversation and an admin can intervene.
--
-- USAGE (from the backend/ folder):
--   psql "$env:PROD_DB" -f src/db/migrations/004_photos_tickets_moderation.sql
--
-- Every statement uses IF NOT EXISTS or is otherwise safe to re-run.

-- ===========================================================================
-- 1) PROFILE PHOTOS MOVE INTO POSTGRES
-- ===========================================================================
-- THE BUG THIS FIXES: photos.js used to write the image to backend/uploads/ and
-- store the path "/uploads/<random>.jpg". Render's filesystem is EPHEMERAL — it is
-- wiped on every redeploy and on every cold start of a sleeping free instance. The
-- database row kept the path, the file no longer existed, so <img> got a 404. That
-- is exactly the reported symptom: the photo shows in "Mi Perfil" (where the UI is
-- rendering the just-uploaded file from the upload RESPONSE) but nowhere else
-- (where the UI is rendering a path whose file is gone).
--
-- Storing the bytes in Postgres fixes it permanently and for free: the managed
-- database persists across deploys, which local disk does not. Avatars are capped
-- at 5 MB by multer, and the platform serves a few hundred users, so the storage
-- cost is negligible. The alternative (S3/Cloudinary) remains the right answer at
-- much larger scale; see Explanation-Patch.md §7.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_photo BYTEA;            -- The raw image bytes. NULL = no photo uploaded.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_photo_mime VARCHAR(64); -- 'image/jpeg' or 'image/png', echoed back as the Content-Type header.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS profile_photo_updated_at TIMESTAMPTZ; -- Used as the cache-busting ?v= value so a new photo appears immediately.

-- Retire the dead paths. Any row still pointing at "/uploads/..." refers to a file
-- that no longer exists on disk, so it can only ever render as a broken image.
-- Setting it to NULL makes the UI fall back to the placeholder cleanly, and users
-- simply re-upload once. Restricted to the '/uploads/%' prefix so that absolute
-- URLs (a future S3 migration) would be left untouched.
UPDATE users
   SET profile_photo_url = NULL
 WHERE profile_photo_url LIKE '/uploads/%';

-- ===========================================================================
-- 2) SUPPORT TICKETS (the "Ayuda" button and the admin "Solicitudes" tab)
-- ===========================================================================
-- A ticket is a small conversation with the administration, separate from
-- user-to-user chat: it has a category, a lifecycle status, and it is answered by
-- an admin rather than by another student.
CREATE TABLE IF NOT EXISTS tickets (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),           -- Ticket id, used in every /tickets URL.
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE, -- Who opened it; CASCADE so deleting a user removes their tickets.
  category   VARCHAR(40) NOT NULL,                                 -- One of the eight menu options (see tickets.routes.js CATEGORIES).
  subject    VARCHAR(200) NOT NULL,                                -- One-line summary shown in both list views.
  status     VARCHAR(20) NOT NULL DEFAULT 'open'                   -- Lifecycle state...
             CHECK (status IN ('open', 'in_progress', 'closed')),   -- ...constrained to the three the admin tab filters on.
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),                   -- When it was opened.
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()                    -- Last activity; the admin list sorts on this so active tickets rise.
);

CREATE INDEX IF NOT EXISTS idx_tickets_status  ON tickets (status, updated_at DESC); -- Backs the admin tab's per-status query.
CREATE INDEX IF NOT EXISTS idx_tickets_user    ON tickets (user_id, updated_at DESC); -- Backs "my tickets" in the Help widget.

-- The messages inside a ticket. Exactly one of the two author columns is set:
-- author_user_id for the student, author_admin_id for the administrator. That is
-- how the UI knows which side to align a bubble on, without a separate flag.
CREATE TABLE IF NOT EXISTS ticket_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),                -- Message id.
  ticket_id       UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,    -- Parent ticket; CASCADE removes the thread with it.
  author_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,              -- Set when the student wrote it; SET NULL keeps the history if the account goes.
  author_admin_id UUID REFERENCES admins(id) ON DELETE SET NULL,             -- Set when an admin wrote it.
  message         TEXT NOT NULL,                                             -- The body.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()                         -- Ordering key for the thread.
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket ON ticket_messages (ticket_id, created_at); -- Fetches one thread in order.

-- ===========================================================================
-- 3) CONVERSATION-LEVEL MODERATION
-- ===========================================================================
-- WHY: moderation used to list individual messages, and there was no way for an
-- admin to intervene inside a conversation. Both need a stable identifier for "the
-- conversation between A and B", which the schema did not have — a thread was only
-- implied by the symmetric (sender, receiver) pair.
--
-- pair_low / pair_high hold the two participant ids SORTED, so both directions of
-- the same conversation share one key. That turns the old two-branch OR query into
-- a single indexed lookup, and it gives an admin message a thread to belong to
-- without pretending to be from either participant.

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS admin_id UUID REFERENCES admins(id) ON DELETE SET NULL; -- Set ONLY on admin intervention notes; NULL for normal student messages.

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS pair_low UUID;   -- LEAST(participant_a, participant_b) — the smaller of the two ids.

ALTER TABLE chats
  ADD COLUMN IF NOT EXISTS pair_high UUID;  -- GREATEST(participant_a, participant_b) — the larger of the two ids.

-- An admin note belongs to a conversation but is authored by neither participant,
-- so sender_id/receiver_id must be allowed to be NULL on those rows.
ALTER TABLE chats ALTER COLUMN sender_id   DROP NOT NULL; -- Safe: application code always sets it for student messages.
ALTER TABLE chats ALTER COLUMN receiver_id DROP NOT NULL; -- Same.

-- Backfill every existing message so history is queryable by the new key.
-- Postgres' uuid type is ordered, so LEAST/GREATEST work directly on it.
UPDATE chats
   SET pair_low  = LEAST(sender_id, receiver_id),
       pair_high = GREATEST(sender_id, receiver_id)
 WHERE pair_low IS NULL
   AND sender_id IS NOT NULL
   AND receiver_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chats_pair ON chats (pair_low, pair_high, created_at); -- One index serves the thread read AND the conversation list.

-- ===========================================================================
-- 4) VERIFICATION (run manually; changes nothing)
-- ===========================================================================
-- Expect 3 photo columns, 2 ticket tables, and 3 new chats columns.
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'users'
--    AND column_name LIKE 'profile_photo%';
--
-- SELECT table_name FROM information_schema.tables
--  WHERE table_name IN ('tickets', 'ticket_messages');
--
-- SELECT column_name FROM information_schema.columns
--  WHERE table_name = 'chats'
--    AND column_name IN ('admin_id', 'pair_low', 'pair_high');
