// src/routes/admin.routes.js
// PURPOSE: Every administrator endpoint — isolated login, dashboard aggregates,
// user management, chat moderation, map country toggles, and system settings.
// INTENDED OUTPUT LINK: this is the whole admin panel's backend. It is deliberately
// separate from /auth: admins live in their own `admins` table, get their own token
// role, and every mutating action is written to audit_logs.

import { Router } from "express";                            // Express router for the /admin endpoints.
import bcrypt from "bcrypt";                                  // Verifies the admin password against its stored hash.
import jwt from "jsonwebtoken";                               // Issues the admin session token.
import speakeasy from "speakeasy";                            // Verifies the admin's optional TOTP second factor.
import { pool } from "../config/db.js";                       // Shared PostgreSQL pool.
import { requireAdmin, ADMIN_SECRET } from "../middleware/admin.js"; // Guard + the secret admin tokens are signed with.
import { toCsv } from "../utils/csv.js";                      // Safe CSV encoder for the user export.
import { sendTestEmail } from "../services/mailer.js";        // Lets an admin verify SMTP settings.
import crypto from "crypto";                                  // CHANGE (this patch): generates the temporary password for the reset-password button.
import { refreshFromSource, expirePast } from "../services/scheduler.js"; // Manual trigger for the scholarship refresh.
import { emitToUser } from "../realtime.js";                   // CHANGE (this patch): pushes an admin intervention note live to both participants.

const router = Router();                                      // Create the router.

// Helper: record a mutating admin action in the audit log. Called by every write
// endpoint below so there is always a trail of who changed what, and from where.
async function audit(req, action, target, extra = {}) {       // action = short verb; target = affected row id.
  await pool.query(
    "INSERT INTO audit_logs (actor, action, ip, detail) VALUES ($1,$2,$3,$4)",
    [
      req.admin?.sub || "unknown",                            // Which admin did it (their id from the verified token).
      action,                                                 // What they did, e.g. 'user_deactivate'.
      req.ip,                                                 // Where from, for anomaly detection.
      JSON.stringify({ target, ...extra }),                   // Structured details (JSONB column).
    ]
  );
}

// ===========================================================================
// LOGIN (isolated from the user login at /auth/login)
// ===========================================================================
router.post("/login", async (req, res) => {                   // POST /admin/login.
  const { email, password, totp } = req.body;                 // Admin credentials + optional 2FA code.

  try {
    const { rows } = await pool.query(                        // Look the admin up in the SEPARATE admins table.
      "SELECT * FROM admins WHERE email = $1",                // Note: this never touches the users table.
      [email?.toLowerCase()]                                  // Lowercase for consistent matching.
    );
    const admin = rows[0];                                    // The admin row, or undefined.

    // Same generic message for "no such admin" and "wrong password" so the
    // endpoint can't be used to discover which admin emails exist.
    if (!admin || !(await bcrypt.compare(password || "", admin.password_hash))) {
      await pool.query(                                       // Log the failed attempt for monitoring.
        "INSERT INTO audit_logs (actor, action, ip) VALUES ($1,$2,$3)",
        [email || null, "admin_login_fail", req.ip]
      );
      return res.status(401).json({ error: "Invalid credentials" }); // Deny.
    }

    if (admin.totp_secret) {                                  // If this admin has 2FA configured...
      const ok = speakeasy.totp.verify({                      // ...verify the submitted 6-digit code.
        secret: admin.totp_secret,                            // Their stored base32 secret.
        encoding: "base32",                                   // Encoding of that secret.
        token: totp || "",                                    // The code they typed ("" if omitted -> fails).
        window: 1,                                            // Allow ±30s for clock drift.
      });
      if (!ok) return res.status(401).json({ error: "Invalid 2FA code" }); // Wrong code -> deny.
    }

    const token = jwt.sign(                                   // Issue the admin session token.
      { sub: admin.id, role: "admin" },                       // role:"admin" is what requireAdmin checks for.
      ADMIN_SECRET,                                           // Signed with the admin secret (separate when configured).
      { expiresIn: "1h" }                                     // Short 1h life: admin sessions are higher-risk than user ones.
    );
    await pool.query(                                         // Log the successful login.
      "INSERT INTO audit_logs (actor, action, ip) VALUES ($1,$2,$3)",
      [admin.id, "admin_login_success", req.ip]
    );
    res.json({ token });                                      // Return only the token; never the hash or TOTP secret.
  } catch (e) {
    res.status(500).json({ error: "Login failed" });           // Generic failure.
  }
});

// ===========================================================================
// DASHBOARD
// ===========================================================================
router.get("/dashboard", requireAdmin, async (_req, res) => { // GET /admin/dashboard — the widget counts.
  try {
    // NOTE: Postgres COUNT() returns bigint, which the pg driver hands back as a
    // STRING to avoid precision loss. Casting ::int here means the JSON contains
    // real numbers (5) rather than strings ("5"), so the UI can do arithmetic.
    const [users, scholarships, countries, pending, last, tickets] = await Promise.all([ // Run all six queries in parallel.
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE is_active = TRUE"),          // Active registered students.
      pool.query("SELECT COUNT(*)::int AS c FROM scholarships WHERE status = 'active'"),  // Currently visible scholarships.
      pool.query("SELECT COUNT(DISTINCT current_country)::int AS c FROM users WHERE current_country IS NOT NULL"), // Countries with users.
      pool.query("SELECT COUNT(*)::int AS c FROM chats WHERE read_at IS NULL"),           // Unread ("pending") messages.
      pool.query("SELECT MAX(updated_at) AS last FROM scholarships"),                     // When scholarships last changed.
      // CHANGE (this patch): ticket KPIs for the "Resumen" dashboard. One grouped
      // query rather than three counts — it returns at most three rows, so a single
      // round trip is cheaper and can never disagree with itself between queries.
      //
      // The .catch() is deliberate DEPLOY-ORDER INSURANCE. If the backend ships
      // before migration 004 runs, `tickets` does not exist yet and this query
      // throws. Inside Promise.all that single rejection would fail the WHOLE
      // dashboard, taking down the admin panel's landing screen over a feature
      // nobody is using yet. Swallowing it to an empty result means the four
      // original widgets keep working and only the ticket counts read 0.
      pool.query("SELECT status, COUNT(*)::int AS c FROM tickets GROUP BY status")         // Support tickets by lifecycle state.
        .catch(() => ({ rows: [] })),                                                      // Missing table -> no rows -> all three KPIs show 0.
    ]);

    // Turn the grouped rows into a lookup so a status with ZERO tickets still
    // reports 0 rather than undefined (Postgres omits empty groups entirely).
    const byStatus = { open: 0, in_progress: 0, closed: 0 };  // Start every state at zero.
    for (const row of tickets.rows) {                         // Overwrite with whatever the query actually found.
      byStatus[row.status] = row.c;                           // e.g. byStatus.open = 4.
    }

    res.json({                                                // Shape consumed by the dashboard widgets.
      users: users.rows[0].c,                                 // Total users widget.
      scholarships: scholarships.rows[0].c,                   // Active scholarships widget.
      countries: countries.rows[0].c,                         // Countries with users widget.
      pending_chats: pending.rows[0].c,                       // Pending chats widget.
      last_api_update: last.rows[0].last,                     // Last API update widget.
      tickets_open: byStatus.open,                            // NEW widget: tickets nobody has picked up yet.
      tickets_in_progress: byStatus.in_progress,              // NEW widget: tickets being worked on.
      tickets_closed: byStatus.closed,                        // NEW widget: resolved tickets (the throughput number).
    });
  } catch (e) {
    res.status(500).json({ error: "Could not load dashboard" }); // Generic failure.
  }
});

// ===========================================================================
// USER MANAGEMENT
// ===========================================================================

// List/search users. Supports a text search across name, email, country, institution.
router.get("/users", requireAdmin, async (req, res) => {      // GET /admin/users?q=&limit=&offset=
  const q = req.query.q ? `%${req.query.q}%` : null;          // Wrap the search term for a LIKE match; null = no filter.
  const limit = Math.min(Number(req.query.limit) || 50, 200); // Page size, capped at 200.
  const offset = Math.max(Number(req.query.offset) || 0, 0);  // Page start, never negative.

  try {
    const { rows } = await pool.query(
      // CHANGE (photo release): the projection now also carries city_origin,
      // state_origin, status, profile_photo_url and the PRIVATE phone pair. The
      // admin edit form in AdminPanel.jsx pre-fills from exactly these fields, so
      // anything missing here would silently blank out when an admin saves.
      // password_hash and totp_secret remain excluded — admins never see secrets.
      `SELECT id, email, first_name, last_name, current_country, current_city,
              city_origin, state_origin, status, institution_company,
              phone_country_code, phone_number, profile_photo_url,
              is_active, chat_disabled, totp_enabled, created_at
       FROM users
       WHERE ($1::text IS NULL                              -- No search term -> return everyone...
              OR first_name ILIKE $1                        -- ...otherwise match any of these fields.
              OR last_name ILIKE $1                         -- ILIKE = case-insensitive LIKE.
              OR email ILIKE $1
              OR current_country ILIKE $1
              OR institution_company ILIKE $1)
       ORDER BY created_at DESC                             -- Newest signups first.
       LIMIT $2 OFFSET $3`,                                  // Pagination.
      [q, limit, offset]
    );
    res.json(rows);                                           // Admin table rows (password_hash/totp_secret excluded).
  } catch (e) {
    res.status(500).json({ error: "Could not load users" });
  }
});

// ---------------------------------------------------------------------------
// EDIT a user's profile (NEW in the photo release).
// ---------------------------------------------------------------------------
// The spec asks for "front-end controls to edit user profile information"; this is
// the endpoint behind the Edit form in AdminPanel.jsx > Usuarios. It mirrors the
// self-service PATCH /users/me but with a wider whitelist: an administrator may
// also correct the login email. Security columns (password_hash, totp_secret,
// is_active, chat_disabled) are deliberately NOT here — they have their own
// dedicated, individually audited endpoints above and below.
const ADMIN_EDITABLE = [
  "first_name",          // Display name on the user card.
  "last_name",           // Display name on the user card.
  "email",               // Login identifier; admin-only because it changes how the person signs in.
  "city_origin",         // Hometown city.
  "state_origin",        // Home state.
  "current_country",     // KEY FIELD: decides which country panel this user appears in (must match a GeoJSON name).
  "current_city",        // Shown under the name on the card.
  "status",              // 'working' | 'studying' (DB CHECK constraint enforces valid values).
  "institution_company", // Where they study/work.
  "phone_country_code",  // PRIVATE: dialing code, visible only to the owner and to admins.
  "phone_number",        // PRIVATE: phone digits, same visibility rule.
];

router.patch("/users/:id", requireAdmin, async (req, res) => {  // PATCH /admin/users/:id — edit one profile.
  const updates = Object.keys(req.body)                         // Look at the fields the admin form sent...
    .filter((k) => ADMIN_EDITABLE.includes(k));                 // ...and keep ONLY whitelisted ones (drops id/password_hash/is_active).

  if (updates.length === 0) {                                   // Nothing valid to change...
    return res.status(400).json({ error: "No editable fields provided" }); // ...refuse instead of running an empty UPDATE.
  }

  // Column NAMES come from our own constant (never from the request), so building
  // the SET clause by concatenation is safe; the VALUES stay parameterized.
  const setClause = updates.map((k, i) => `${k} = $${i + 1}`).join(", "); // e.g. "first_name = $1, phone_number = $2".
  const values = updates.map((k) =>                             // The matching values, in placeholder order...
    req.body[k] === "" ? null : req.body[k]                     // ...with empty strings normalized to NULL (an empty DATE/status would violate the CHECK).
  );
  values.push(req.params.id);                                   // Append the target user's id as the LAST parameter (for WHERE).

  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${setClause}
       WHERE id = $${values.length}
       RETURNING id, email, first_name, last_name, current_country, current_city,
                 city_origin, state_origin, status, institution_company,
                 phone_country_code, phone_number, profile_photo_url,
                 is_active, chat_disabled, totp_enabled, created_at`,
      values
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" }); // No row matched that id.
    await audit(req, "user_edit", req.params.id, { fields: updates }); // Log WHICH fields changed (values stay out of the log: they are personal data).
    res.json(rows[0]);                                          // Return the fresh row so the admin table re-renders with the saved values.
  } catch (e) {
    if (e.code === "23505") {                                   // 23505 = unique_violation: the new email is already taken...
      return res.status(409).json({ error: "Email already registered" }); // ...tell the admin precisely why the save failed.
    }
    if (e.code === "23514") {                                   // 23514 = check_violation: status was not 'working'/'studying'...
      return res.status(400).json({ error: "Invalid field value" }); // ...return 400 rather than a confusing 500.
    }
    res.status(500).json({ error: "Could not update user" });   // Generic failure.
  }
});

// ---------------------------------------------------------------------------
// DELETE a user permanently (NEW in the photo release).
// ---------------------------------------------------------------------------
// Distinct from "Desactivar" above: deactivate is reversible and keeps the row,
// this erases it. chats.sender_id / chats.receiver_id are declared ON DELETE
// CASCADE in schema.sql, so the person's messages disappear with them and no
// foreign key is left dangling. Used for right-to-erasure requests.
router.delete("/users/:id", requireAdmin, async (req, res) => { // DELETE /admin/users/:id.
  try {
    const { rows } = await pool.query(                          // Read the email BEFORE deleting...
      "SELECT email FROM users WHERE id = $1",                  // ...because after the DELETE there is nothing left to identify the row in the log.
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "User not found" }); // Nothing to delete.

    await pool.query("DELETE FROM users WHERE id = $1", [req.params.id]); // Remove the row (chats cascade away with it).
    await audit(req, "user_delete", req.params.id, { email: rows[0].email }); // Irreversible action: always logged, with the email for traceability.
    res.status(204).end();                                      // 204 No Content: deleted, nothing to return.
  } catch (e) {
    res.status(500).json({ error: "Could not delete user" });   // Generic failure.
  }
});

// Deactivate (ban) a user: they can no longer log in or appear on the map.
router.patch("/users/:id/deactivate", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(                    // Soft delete: flip the flag, keep the data.
      "UPDATE users SET is_active = FALSE WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "User not found" }); // Nothing matched that id.
    await audit(req, "user_deactivate", req.params.id);       // Record the action.
    res.json({ ok: true });                                   // Confirm.
  } catch (e) {
    res.status(500).json({ error: "Could not deactivate user" });
  }
});

// Reactivate a previously banned user (the inverse of the above).
router.patch("/users/:id/activate", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE users SET is_active = TRUE WHERE id = $1",       // Restore access.
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "User not found" });
    await audit(req, "user_activate", req.params.id);          // Record it.
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not activate user" });
  }
});

// Mute / unmute a user's chat. Softer than a ban: they keep browsing but can't send.
router.patch("/users/:id/mute", requireAdmin, async (req, res) => {
  const disabled = req.body.chat_disabled !== false;           // Default to muting; pass false to un-mute.
  try {
    const { rowCount } = await pool.query(
      "UPDATE users SET chat_disabled = $1 WHERE id = $2",      // The chat route checks this flag before accepting a send.
      [disabled, req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "User not found" });
    await audit(req, disabled ? "user_mute" : "user_unmute", req.params.id); // Distinct actions in the log.
    res.json({ ok: true, chat_disabled: disabled });
  } catch (e) {
    res.status(500).json({ error: "Could not update chat status" });
  }
});

// Reset a user's 2FA, e.g. when they lose their phone and are locked out.
router.patch("/users/:id/reset-2fa", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query(
      "UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1", // Clear both flag and secret.
      [req.params.id]
    );
    if (rowCount === 0) return res.status(404).json({ error: "User not found" });
    await audit(req, "user_reset_2fa", req.params.id);          // High-sensitivity action: always logged.
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "Could not reset 2FA" });
  }
});

// ---------------------------------------------------------------------------
// Reset a user's password (NEW in this patch).
// ---------------------------------------------------------------------------
// Backs the "Reiniciar contraseña" button on every row of the Usuarios tab. The
// admin never chooses the password and never sees the old one: a random temporary
// password is generated, hashed, stored, and returned to the admin EXACTLY ONCE so
// they can pass it to the user through whatever channel they already trust.
//
// Design decisions worth noting:
//   - crypto.randomBytes, not Math.random — this is a credential.
//   - base64url, so the string is safe to paste into any field or URL.
//   - 2FA is deliberately NOT cleared here. Resetting a forgotten password and
//     unlocking a lost phone are different problems with different risk profiles,
//     and they keep separate buttons and separate audit entries.
router.post("/users/:id/reset-password", requireAdmin, async (req, res) => {
  try {
    const { rows: found } = await pool.query(                   // Confirm the account exists first...
      "SELECT email, first_name FROM users WHERE id = $1",       // ...and read the email for the audit trail.
      [req.params.id]
    );
    if (found.length === 0) return res.status(404).json({ error: "User not found" });

    const temp = crypto.randomBytes(12).toString("base64url");  // 12 bytes -> 16 chars, well above the 8-char minimum enforced at registration.
    const hash = await bcrypt.hash(temp, 12);                   // Same cost factor as registration, so verification behaves identically.

    await pool.query(                                           // Store ONLY the hash; the plaintext exists just in this response.
      "UPDATE users SET password_hash = $1 WHERE id = $2",
      [hash, req.params.id]
    );

    // The audit entry records the email but NEVER the temporary password — an audit
    // log is long-lived and widely readable, so a credential must not enter it.
    await audit(req, "user_reset_password", req.params.id, { email: found[0].email });

    res.json({
      ok: true,
      temporary_password: temp,                                 // Shown once in the admin UI, then gone forever.
      email: found[0].email,                                    // So the admin can see who it belongs to without re-reading the row.
    });
  } catch (e) {
    res.status(500).json({ error: "Could not reset password" });
  }
});

// Export the user list as a CSV download.
router.get("/users/export", requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(
      // CHANGE (photo release): the export carries the private phone pair too, so
      // an administrator can contact students offline. This is personal data — the
      // audit() call below already records every export, and the CSV encoder in
      // utils/csv.js neutralizes spreadsheet formula injection.
      `SELECT email, first_name, last_name, current_country, current_city,
              institution_company, status, phone_country_code, phone_number,
              is_active, created_at
       FROM users ORDER BY created_at DESC`                     // Full list, newest first.
    );

    // Column definitions: `key` matches the SQL alias, `label` is the header text.
    const columns = [
      { key: "email", label: "email" },
      { key: "first_name", label: "first_name" },
      { key: "last_name", label: "last_name" },
      { key: "current_country", label: "current_country" },
      { key: "current_city", label: "current_city" },
      { key: "institution_company", label: "institution" },
      { key: "status", label: "status" },
      { key: "phone_country_code", label: "phone_country_code" }, // NEW column: must match the SQL alias above or the cell exports blank.
      { key: "phone_number", label: "phone_number" },             // NEW column: the private number, admin-only by design.
      { key: "is_active", label: "is_active" },
      { key: "created_at", label: "created_at" },
    ];

    const csv = toCsv(columns, rows);                           // Encode with proper escaping + formula-injection defence.
    await audit(req, "users_export", null, { count: rows.length }); // Exporting personal data is itself auditable.

    res.setHeader("Content-Type", "text/csv; charset=utf-8");   // Tell the browser it's CSV text.
    res.setHeader("Content-Disposition", "attachment; filename=users.csv"); // Trigger a download rather than display.
    res.send(csv);                                              // Send the document.
  } catch (e) {
    res.status(500).json({ error: "Could not export users" });
  }
});

// ===========================================================================
// CHAT MODERATION  — CONVERSATION-BASED (rewritten in this patch)
// ===========================================================================
// BEFORE: GET /admin/chats returned the newest N messages, flat. An admin saw
// individual lines torn out of context, could delete one message, and had no way
// to read or intervene in a thread.
// NOW: the unit of moderation is the CONVERSATION. The endpoints below list
// conversations, open one in full, let an admin post a visible intervention note
// inside it, and delete the whole thread.
//
// This is what the migration's pair_low/pair_high columns are for: they give every
// conversation one stable key, so grouping and deleting are single indexed
// operations rather than symmetric OR gymnastics.

// ---------------------------------------------------------------------------
// GET /admin/chats/conversations  -> one row per conversation.
// ---------------------------------------------------------------------------
// Declared BEFORE "/chats/:id" so Express does not capture the literal word
// "conversations" as an :id parameter.
router.get("/chats/conversations", requireAdmin, async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 50, 200);   // Page size, capped so one admin request can't scan the whole table.
  try {
    const { rows } = await pool.query(
      // The subquery collapses the messages table down to one row per conversation
      // FIRST, then joins the two user rows once per conversation instead of once
      // per message. On a large chats table that difference is the whole cost.
      `SELECT c.pair_low, c.pair_high,
              c.message_count, c.last_at, c.unread_count, c.admin_notes,
              a.first_name AS a_first, a.last_name AS a_last, a.email AS a_email,
              a.profile_photo_url AS a_photo,
              b.first_name AS b_first, b.last_name AS b_last, b.email AS b_email,
              b.profile_photo_url AS b_photo,
              lm.message AS last_message
         FROM (
           SELECT pair_low, pair_high,
                  COUNT(*)::int AS message_count,                        -- How long the exchange is.
                  MAX(created_at) AS last_at,                            -- Sort key: most recent activity first.
                  COUNT(*) FILTER (WHERE read_at IS NULL
                                     AND admin_id IS NULL)::int AS unread_count, -- Unread student messages only.
                  COUNT(*) FILTER (WHERE admin_id IS NOT NULL)::int AS admin_notes -- Has this thread already been moderated?
             FROM chats
            WHERE pair_low IS NOT NULL                                   -- Skip any legacy row the backfill could not key.
            GROUP BY pair_low, pair_high
         ) c
         JOIN users a ON a.id = c.pair_low                               -- Participant A (the lower id).
         JOIN users b ON b.id = c.pair_high                              -- Participant B (the higher id).
         LEFT JOIN LATERAL (
           SELECT message FROM chats m
            WHERE m.pair_low = c.pair_low AND m.pair_high = c.pair_high
            ORDER BY m.created_at DESC LIMIT 1                            -- LATERAL lets this subquery reference c: the newest line of each thread.
         ) lm ON TRUE
        ORDER BY c.last_at DESC                                          -- Active conversations at the top, where moderation is needed.
        LIMIT $1`,
      [limit]
    );
    res.json(rows);                                              // The conversation list for the Moderación tab.
  } catch (e) {
    res.status(500).json({ error: "Could not load conversations" });
  }
});

// ---------------------------------------------------------------------------
// GET /admin/chats/conversation?a=<id>&b=<id>  -> the full thread.
// ---------------------------------------------------------------------------
// Backs the "Revisar" button, which opens the conversation review page.
router.get("/chats/conversation", requireAdmin, async (req, res) => {
  const { a, b } = req.query;                                    // The two participant ids, in any order.
  if (!a || !b) return res.status(400).json({ error: "a and b are required" }); // Both halves of the key are mandatory.

  try {
    const { rows: participants } = await pool.query(              // Header data: who is in this conversation.
      `SELECT id, first_name, last_name, email, current_country, current_city,
              profile_photo_url, chat_disabled, is_active
         FROM users WHERE id = ANY($1::uuid[])`,                  // ANY(array) fetches both users in one query.
      [[a, b]]
    );
    if (participants.length < 2) {                                // One of the accounts has been deleted...
      return res.status(404).json({ error: "Conversation participants not found" }); // ...so there is nothing coherent to review.
    }

    const { rows: messages } = await pool.query(
      `SELECT id, sender_id, receiver_id, admin_id, message, read_at, created_at
         FROM chats
        WHERE pair_low = LEAST($1::uuid, $2::uuid)                -- Same sorted key the writer used...
          AND pair_high = GREATEST($1::uuid, $2::uuid)            -- ...so both directions and any admin notes come back together.
        ORDER BY created_at ASC`,                                 // Chronological: a moderator needs to read it as it happened.
      [a, b]
    );

    // Reading a conversation is itself sensitive — an admin is looking at private
    // messages between two people — so it is logged like any mutation would be.
    await audit(req, "conversation_review", null, { a, b, messages: messages.length });

    res.json({ participants, messages });                         // Header + thread in one payload.
  } catch (e) {
    res.status(500).json({ error: "Could not load conversation" });
  }
});

// ---------------------------------------------------------------------------
// POST /admin/chats/conversation/message  -> admin intervention.
// ---------------------------------------------------------------------------
// Posts a note that BOTH participants see, attributed to the administration rather
// than to either of them. That is why the migration made sender_id/receiver_id
// nullable and added admin_id: this row belongs to the conversation but to neither
// side of it. ChatWidget.jsx renders these as a centred system notice.
router.post("/chats/conversation/message", requireAdmin, async (req, res) => {
  const { a, b, message } = req.body;                            // The two participants and the note text.
  if (!a || !b) return res.status(400).json({ error: "a and b are required" });
  if (!message?.trim()) return res.status(400).json({ error: "Empty message" }); // A blank intervention says nothing.

  try {
    const { rows } = await pool.query(
      `INSERT INTO chats (sender_id, receiver_id, admin_id, message, pair_low, pair_high)
       VALUES (NULL, NULL, $1, $2,                                -- No sender and no receiver: this is not from a participant.
               LEAST($3::uuid, $4::uuid),                         -- ...but it IS in their conversation.
               GREATEST($3::uuid, $4::uuid))
       RETURNING *`,
      [req.admin.sub, message.trim(), a, b]                       // admin_id comes from the verified admin token.
    );
    const saved = rows[0];                                        // The stored note.

    // Push to BOTH participants, unlike a normal message which goes only to the
    // recipient. An intervention is addressed to the conversation, not one person.
    emitToUser(a, "dm", saved);                                   // Participant A's open tabs.
    emitToUser(b, "dm", saved);                                   // Participant B's open tabs.

    await audit(req, "conversation_intervene", null, { a, b });    // Who intervened, where, and when.
    res.status(201).json(saved);                                   // 201 Created + the note.
  } catch (e) {
    res.status(500).json({ error: "Could not send intervention" });
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/chats/conversation?a=<id>&b=<id>  -> delete the whole thread.
// ---------------------------------------------------------------------------
router.delete("/chats/conversation", requireAdmin, async (req, res) => {
  const { a, b } = req.query;                                     // The conversation to erase.
  if (!a || !b) return res.status(400).json({ error: "a and b are required" });

  try {
    const { rowCount } = await pool.query(
      `DELETE FROM chats
        WHERE pair_low = LEAST($1::uuid, $2::uuid)                -- One indexed delete removes every message...
          AND pair_high = GREATEST($1::uuid, $2::uuid)`,          // ...in both directions, plus any admin notes.
      [a, b]
    );
    if (rowCount === 0) return res.status(404).json({ error: "Conversation not found" });
    await audit(req, "conversation_delete", null, { a, b, deleted: rowCount }); // Irreversible: log the count too.
    res.status(204).end();                                        // 204 No Content.
  } catch (e) {
    res.status(500).json({ error: "Could not delete conversation" });
  }
});

// Delete ONE message. Kept from the previous version: sometimes a single abusive
// line needs removing without destroying the whole exchange, which would also
// erase the innocent participant's side of it.
router.delete("/chats/:id", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM chats WHERE id = $1", [req.params.id]); // Remove the row.
    if (rowCount === 0) return res.status(404).json({ error: "Message not found" });
    await audit(req, "chat_delete", req.params.id);              // Deletion is irreversible, so log it.
    res.status(204).end();                                       // 204 No Content.
  } catch (e) {
    res.status(500).json({ error: "Could not delete message" });
  }
});

// ===========================================================================
// SCHOLARSHIP LISTING FOR ADMINS (NEW in this patch)
// ===========================================================================
// THE BUG THIS FIXES: the Becas tab showed an empty list. It was calling
// GET /scholarships, which is guarded by requireAuth and therefore verifies the
// token against JWT_SECRET. The admin panel holds an ADMIN token, signed with
// ADMIN_JWT_SECRET — and render.yaml generates those two secrets independently, so
// in production they differ. The admin token failed the student signature check,
// the request came back 401, and the tab rendered nothing.
//
// A second, quieter bug was stacked on top: GET /scholarships filters
// `status = 'active'`, which is correct for students but wrong for a CMS — an
// administrator must be able to see and re-activate the rows they hid.
//
// This endpoint fixes both: it sits behind requireAdmin (so the admin token is the
// RIGHT token) and returns EVERY row regardless of status.
router.get("/scholarships", requireAdmin, async (req, res) => {   // GET /admin/scholarships?q=&country=
  const q = (req.query.q || "").trim();                           // Optional free-text search.
  const country = (req.query.country || "").trim();               // Optional country filter.

  try {
    const { rows } = await pool.query(
      `SELECT s.id, s.institution_name, s.country, s.category, s.areas,
              s.start_date, s.end_date, s.link, s.description,
              s.status, s.source, s.created_by, s.updated_at,
              a.email AS created_by_email        -- Resolves the admin id to a readable email for the detail view.
         FROM scholarships s
         LEFT JOIN admins a ON a.id = s.created_by   -- LEFT: imported ('api') rows have no author.
        WHERE ($1 = '' OR s.institution_name ILIKE '%' || $1 || '%'
                       OR s.country ILIKE '%' || $1 || '%')        -- ILIKE = case-insensitive contains.
          AND ($2 = '' OR s.country = $2)                          -- Exact country match when the filter is used.
        ORDER BY s.updated_at DESC`,                               // Most recently edited first: what an admin just touched is what they want to see.
      [q, country]
    );
    res.json(rows);                                                // Full catalogue, active AND inactive.
  } catch (e) {
    res.status(500).json({ error: "Could not load scholarships" });
  }
});

// ===========================================================================
// SUPPORT TICKETS — the "Solicitudes" tab (NEW in this patch)
// ===========================================================================
// The admin half of the tables created in migration 004. The student half is in
// routes/tickets.routes.js. Statuses are open -> in_progress -> closed, which is
// exactly what the three dashboard KPIs count.

// List tickets, optionally filtered to one status (the tab's three sub-filters).
router.get("/tickets", requireAdmin, async (req, res) => {         // GET /admin/tickets?status=open&limit=
  const status = (req.query.status || "").trim();                  // '' means "all statuses".
  const limit = Math.min(Number(req.query.limit) || 100, 300);     // Page size, capped.

  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at,
              u.id AS user_id, u.first_name, u.last_name, u.email,
              u.current_country, u.profile_photo_url,
              COUNT(m.id)::int AS message_count,                                    -- Thread length.
              MAX(m.created_at) FILTER (WHERE m.author_admin_id IS NOT NULL) AS last_admin_reply -- NULL = nobody has answered yet.
         FROM tickets t
         JOIN users u ON u.id = t.user_id                                           -- Who opened it.
         LEFT JOIN ticket_messages m ON m.ticket_id = t.id                          -- LEFT so a ticket always appears.
        WHERE ($1 = '' OR t.status = $1)                                            -- Apply the status filter when given.
        GROUP BY t.id, u.id
        ORDER BY t.updated_at DESC                                                  -- Most recent activity first.
        LIMIT $2`,
      [status, limit]
    );
    res.json(rows);                                                                  // The ticket list for the tab.
  } catch (e) {
    res.status(500).json({ error: "Could not load tickets" });
  }
});

// Open one ticket with its full thread.
router.get("/tickets/:id", requireAdmin, async (req, res) => {
  try {
    const { rows: t } = await pool.query(
      `SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at,
              u.id AS user_id, u.first_name, u.last_name, u.email,
              u.current_country, u.current_city, u.institution_company,
              u.phone_country_code, u.phone_number,   -- Private contact details: admin-only surface, useful for resolving access tickets.
              u.profile_photo_url, u.is_active, u.chat_disabled, u.totp_enabled
         FROM tickets t
         JOIN users u ON u.id = t.user_id
        WHERE t.id = $1`,
      [req.params.id]
    );
    if (t.length === 0) return res.status(404).json({ error: "Ticket not found" });

    const { rows: messages } = await pool.query(
      `SELECT id, author_user_id, author_admin_id, message, created_at
         FROM ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC`,                    // Chronological thread.
      [req.params.id]
    );

    res.json({ ...t[0], messages });                  // Ticket + requester context + thread in one payload.
  } catch (e) {
    res.status(500).json({ error: "Could not load ticket" });
  }
});

// Change a ticket's status (the open / in_progress / closed lifecycle).
router.patch("/tickets/:id", requireAdmin, async (req, res) => {
  const { status } = req.body;                                     // The new state.
  if (!["open", "in_progress", "closed"].includes(status)) {       // Validate before hitting the CHECK constraint...
    return res.status(400).json({ error: "Invalid status" });       // ...so the client gets a clear message, not a 500.
  }

  try {
    const { rows } = await pool.query(
      `UPDATE tickets SET status = $1, updated_at = now()          -- Touch updated_at so the list re-sorts.
        WHERE id = $2
        RETURNING id, category, subject, status, created_at, updated_at`,
      [status, req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: "Ticket not found" });
    await audit(req, "ticket_status", req.params.id, { status });   // Who moved it, and to what.
    res.json(rows[0]);                                             // The updated ticket.
  } catch (e) {
    res.status(500).json({ error: "Could not update ticket" });
  }
});

// Reply to a ticket as the administration.
router.post("/tickets/:id/messages", requireAdmin, async (req, res) => {
  const { message } = req.body;                                    // The reply text.
  if (!message?.trim()) return res.status(400).json({ error: "Message is required" });

  try {
    const { rows: t } = await pool.query("SELECT id FROM tickets WHERE id = $1", [req.params.id]);
    if (t.length === 0) return res.status(404).json({ error: "Ticket not found" });

    const { rows } = await pool.query(
      `INSERT INTO ticket_messages (ticket_id, author_admin_id, message)
       VALUES ($1, $2, $3)                                          -- author_admin_id set, author_user_id NULL: that is how the UI attributes the bubble.
       RETURNING id, author_user_id, author_admin_id, message, created_at`,
      [req.params.id, req.admin.sub, message.trim()]                // Author comes from the verified admin token.
    );

    // Answering a ticket implicitly means work has started, so an 'open' ticket
    // moves to 'in_progress' automatically. Without this an admin would have to
    // remember two clicks, and the KPI would understate how much is being handled.
    await pool.query(
      `UPDATE tickets
          SET updated_at = now(),
              status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END -- Never downgrade a closed ticket.
        WHERE id = $1`,
      [req.params.id]
    );

    await audit(req, "ticket_reply", req.params.id);                 // Log the response for traceability.
    res.status(201).json(rows[0]);                                  // The stored reply.
  } catch (e) {
    res.status(500).json({ error: "Could not reply" });
  }
});

// Delete a ticket entirely (spam, duplicates, or an erasure request).
router.delete("/tickets/:id", requireAdmin, async (req, res) => {
  try {
    const { rowCount } = await pool.query("DELETE FROM tickets WHERE id = $1", [req.params.id]); // ticket_messages cascade away.
    if (rowCount === 0) return res.status(404).json({ error: "Ticket not found" });
    await audit(req, "ticket_delete", req.params.id);                // Irreversible: logged.
    res.status(204).end();                                           // 204 No Content.
  } catch (e) {
    res.status(500).json({ error: "Could not delete ticket" });
  }
});

// ===========================================================================
// MAP MANAGEMENT (country toggles)
// ===========================================================================

// List every country that has been explicitly toggled.
router.get("/countries", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT country, enabled FROM countries_enabled ORDER BY country" // Only rows an admin has touched.
    );
    res.json(rows);                                              // Countries NOT listed here are enabled by default.
  } catch (e) {
    res.status(500).json({ error: "Could not load countries" });
  }
});

// Enable/disable a country on the map.
router.put("/countries/:country", requireAdmin, async (req, res) => {
  const enabled = req.body.enabled !== false;                    // Default true; pass false to hide the country.
  try {
    await pool.query(
      `INSERT INTO countries_enabled (country, enabled)
       VALUES ($1, $2)
       ON CONFLICT (country) DO UPDATE SET enabled = EXCLUDED.enabled`, // Upsert: insert or flip the existing row.
      [req.params.country, enabled]
    );
    await audit(req, "country_toggle", req.params.country, { enabled }); // Record the change.
    res.json({ country: req.params.country, enabled });
  } catch (e) {
    res.status(500).json({ error: "Could not toggle country" });
  }
});

// ===========================================================================
// SYSTEM SETTINGS
// ===========================================================================

// Read all settings as a flat object, e.g. { maintenance_mode: "false", ... }.
router.get("/settings", requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT key, value FROM settings ORDER BY key"); // Key/value pairs.
    const obj = Object.fromEntries(rows.map((r) => [r.key, r.value]));                 // Reshape into one object for the UI.
    res.json(obj);
  } catch (e) {
    res.status(500).json({ error: "Could not load settings" });
  }
});

// Update one setting.
router.put("/settings/:key", requireAdmin, async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO settings (key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`, // Upsert the value.
      [req.params.key, String(req.body.value)]                   // Everything is stored as text.
    );
    await audit(req, "setting_update", req.params.key, { value: req.body.value }); // Config changes are auditable.
    res.json({ key: req.params.key, value: String(req.body.value) });
  } catch (e) {
    res.status(500).json({ error: "Could not update setting" });
  }
});

// Send a test email to confirm the SMTP configuration works.
router.post("/smtp/test", requireAdmin, async (req, res) => {
  try {
    await sendTestEmail(req.body.to);                            // Throws if SMTP isn't configured or delivery fails.
    await audit(req, "smtp_test", req.body.to);                  // Log who tested and where it was sent.
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });                  // Surface the real reason so the admin can fix it.
  }
});

// ===========================================================================
// MANUAL SCHOLARSHIP REFRESH
// ===========================================================================
// Runs the same job as the 03:00 cron, on demand. Also the endpoint an external
// GitHub Actions cron would call on hosts that sleep idle instances.
router.post("/scholarships/refresh", requireAdmin, async (req, res) => {
  try {
    const r = await refreshFromSource();                         // Pull + upsert from SCHOLARSHIP_API_URL.
    const e = await expirePast();                                // Flip past-deadline rows to inactive.
    await audit(req, "scholarship_refresh", null, { ...r, ...e });// Log the outcome counts.
    res.json({ ...r, ...e });                                    // e.g. { inserted: 12, skipped: false, expired: 3 }
  } catch (err) {
    res.status(500).json({ error: err.message });                // Report why the refresh failed.
  }
});

// ===========================================================================
// AUDIT LOG VIEWER
// ===========================================================================
router.get("/logs", requireAdmin, async (req, res) => {          // GET /admin/logs?limit=
  const limit = Math.min(Number(req.query.limit) || 100, 500);   // Page size, capped.
  try {
    const { rows } = await pool.query(
      "SELECT actor, action, ip, detail, created_at FROM audit_logs ORDER BY created_at DESC LIMIT $1", // Newest first.
      [limit]
    );
    res.json(rows);                                              // The system log view in the admin panel.
  } catch (e) {
    res.status(500).json({ error: "Could not load logs" });
  }
});

export default router;                                           // Export for mounting at /admin in app.js.
