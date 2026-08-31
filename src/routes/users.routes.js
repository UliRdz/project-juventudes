// src/routes/users.routes.js
// PURPOSE: Two endpoints. (1) GET / lists other users in a given country to fill
// the RIGHT panel of the dual popup. (2) PATCH /me lets a logged-in user set their
// location/profile fields.
// INTENDED OUTPUT LINK: PATCH /me is what makes the map useful at all — Day 2's
// registration only collects email/password/name, so without a way to set
// current_country every country panel would be permanently empty. GET / then reads
// that same column to build the user cards (photo, name, city, email, Chat button).

import { Router } from "express";                     // Express router for the /users endpoints.
import { pool } from "../config/db.js";               // Shared PostgreSQL connection pool.
import { requireAuth } from "../middleware/auth.js";  // Login gate applied to both routes below.

const router = Router();                              // Create the router.

// Whitelist of columns a user is allowed to change about themselves. Anything not
// in this list (id, email, password_hash, totp_secret, is_active) is IGNORED, so a
// crafted request can't escalate privileges or overwrite security fields.
const EDITABLE = [
  "first_name",        // Display name on the user card.
  "last_name",         // Display name on the user card.
  "city_origin",       // Hometown (profile detail).
  "state_origin",      // Home state (profile detail).
  "current_country",   // KEY FIELD: decides which country panel this user appears in.
  "current_city",      // Shown under the name on the card.
  "status",            // 'working' | 'studying' (DB CHECK constraint enforces valid values).
  "institution_company",// Where they study/work.
  "phone_number",      // Private contact info (never returned by GET / below).
  "phone_country_code",// Private dialing code.
];

// ---------------------------------------------------------------------------
// PATCH /users/me  -> update the logged-in user's own profile.
// ---------------------------------------------------------------------------
router.patch("/me", requireAuth, async (req, res) => {          // requireAuth guarantees req.user is the verified caller.
  const updates = Object.keys(req.body)                          // Look at the fields the client sent...
    .filter((k) => EDITABLE.includes(k));                        // ...and keep ONLY the whitelisted ones (drops id/email/etc.).

  if (updates.length === 0) {                                    // Nothing valid to change...
    return res.status(400).json({ error: "No editable fields provided" }); // ...tell the client instead of running an empty UPDATE.
  }

  // Build "col1 = $1, col2 = $2, ..." dynamically from the whitelisted keys.
  // Column NAMES come from our own constant (never from user input), so this is
  // safe; the VALUES are still passed as parameters to prevent SQL injection.
  const setClause = updates.map((k, i) => `${k} = $${i + 1}`).join(", "); // e.g. "current_country = $1, current_city = $2".
  const values = updates.map((k) => req.body[k]);                // The matching values, in the same order as the placeholders.
  values.push(req.user.sub);                                     // Append the caller's id as the LAST parameter (for WHERE).

  try {
    const { rows } = await pool.query(                           // Run the UPDATE limited to the caller's own row.
      `UPDATE users SET ${setClause}
       WHERE id = $${values.length}                              -- WHERE id = the logged-in user: you can only edit yourself.
       RETURNING id, first_name, last_name, current_country, current_city,
                 city_origin, state_origin, status, institution_company,
                 profile_photo_url`,                             // RETURNING gives the client the updated profile without a 2nd query.
      values
    );
    res.json(rows[0]);                                           // Send back the fresh profile so the UI can re-render.
  } catch (e) {
    if (e.code === "23514") {                                    // Postgres 23514 = check_violation (e.g. status not working/studying)...
      return res.status(400).json({ error: "Invalid field value" }); // ...so return 400 rather than a confusing 500.
    }
    res.status(500).json({ error: "Could not update profile" }); // Generic failure message.
  }
});                                                              // End PATCH /users/me.

// ---------------------------------------------------------------------------
// GET /users?country=Mexico&limit=50&offset=0  -> people in that country.
// ---------------------------------------------------------------------------
router.get("/", requireAuth, async (req, res) => {               // Protected: no browsing users without logging in.
  const { country } = req.query;                                 // The country the user clicked on the map.
  if (!country) {                                                // The panel is always country-scoped...
    return res.status(400).json({ error: "country is required" });// ...so refuse an unscoped request (avoids dumping all users).
  }

  // Pagination keeps the payload small if a country has thousands of students.
  const limit = Math.min(Number(req.query.limit) || 50, 100);    // Default 50 per page, hard ceiling 100 even if the client asks for more.
  const offset = Math.max(Number(req.query.offset) || 0, 0);     // Where to start; clamped at 0 so a negative value can't break the query.

  try {
    const { rows } = await pool.query(
      // NOTE: this SELECT lists public-safe columns ONLY. password_hash,
      // totp_secret, and phone numbers are deliberately excluded — the panel is
      // visible to every logged-in user, so anything listed here is effectively public.
      `SELECT id, first_name, last_name, current_city, email, profile_photo_url
       FROM users
       WHERE current_country = $1        -- Match the clicked country exactly (see countries.js on name normalization).
         AND is_active = TRUE            -- Hide banned/deactivated accounts.
         AND id <> $2                    -- Exclude the viewer: you don't chat with yourself.
       ORDER BY first_name               -- Alphabetical so the list is predictable.
       LIMIT $3 OFFSET $4`,              // Apply pagination bounds.
      [country, req.user.sub, limit, offset]                     // Parameters in placeholder order.
    );
    res.json(rows);                                              // Array of user cards for the right panel.
  } catch (e) {
    res.status(500).json({ error: "Could not load users" });      // Generic failure message.
  }
});                                                              // End GET /users.

export default router;                                           // Export for mounting in app.js at /users.
