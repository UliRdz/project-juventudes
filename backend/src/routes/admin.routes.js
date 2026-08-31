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
import { refreshFromSource, expirePast } from "../services/scheduler.js"; // Manual trigger for the scholarship refresh.

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
    const [users, scholarships, countries, pending, last] = await Promise.all([ // Run all five queries in parallel.
      pool.query("SELECT COUNT(*)::int AS c FROM users WHERE is_active = TRUE"),          // Active registered students.
      pool.query("SELECT COUNT(*)::int AS c FROM scholarships WHERE status = 'active'"),  // Currently visible scholarships.
      pool.query("SELECT COUNT(DISTINCT current_country)::int AS c FROM users WHERE current_country IS NOT NULL"), // Countries with users.
      pool.query("SELECT COUNT(*)::int AS c FROM chats WHERE read_at IS NULL"),           // Unread ("pending") messages.
      pool.query("SELECT MAX(updated_at) AS last FROM scholarships"),                     // When scholarships last changed.
    ]);

    res.json({                                                // Shape consumed by the dashboard widgets.
      users: users.rows[0].c,                                 // Total users widget.
      scholarships: scholarships.rows[0].c,                   // Active scholarships widget.
      countries: countries.rows[0].c,                         // Countries with users widget.
      pending_chats: pending.rows[0].c,                       // Pending chats widget.
      last_api_update: last.rows[0].last,                     // Last API update widget.
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
// CHAT MODERATION
// ===========================================================================

// Browse recent messages, with the sender/receiver emails resolved for context.
router.get("/chats", requireAdmin, async (req, res) => {        // GET /admin/chats?limit=
  const limit = Math.min(Number(req.query.limit) || 100, 500);  // Page size, capped at 500.
  try {
    const { rows } = await pool.query(
      `SELECT c.id, c.message, c.created_at, c.read_at,
              s.email AS sender_email,       -- JOIN resolves the sender's id to a readable email...
              r.email AS receiver_email      -- ...and the same for the receiver.
       FROM chats c
       JOIN users s ON s.id = c.sender_id
       JOIN users r ON r.id = c.receiver_id
       ORDER BY c.created_at DESC            -- Most recent first: moderation looks at new content.
       LIMIT $1`,
      [limit]
    );
    res.json(rows);                                             // The moderation log view.
  } catch (e) {
    res.status(500).json({ error: "Could not load chats" });
  }
});

// Delete an abusive message.
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
