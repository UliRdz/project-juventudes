// src/routes/scholarships.routes.js
// PURPOSE: Read endpoint that returns active scholarships, optionally filtered to
// one country. (Admin create/edit/delete arrives on Day 4/5.)
// INTENDED OUTPUT LINK: this fills the LEFT panel of the dual popup — the user
// clicks a country on the map and this query supplies the cards, which the client
// splits into "Preparatoria" (high_school) and "Universidad" (university).

import { Router } from "express";                     // Express mini-app for grouping the /scholarships routes.
import { pool } from "../config/db.js";               // Shared PostgreSQL pool used for the query below.
import { requireAuth } from "../middleware/auth.js";  // Login gate for READS: no country data without login.
import { requireAdmin } from "../middleware/admin.js"; // Day 5: WRITES are administrator-only.

const router = Router();                              // Create the router to attach handlers to.

// GET /scholarships?country=Mexico
// Returns only ACTIVE scholarships so expired/hidden ones never reach the UI.
router.get("/", requireAuth, async (req, res) => {    // requireAuth enforces the "must be logged in" rule ON THE SERVER.
  const { country } = req.query;                      // Optional ?country= filter taken from the query string.
  try {                                               // Wrap the DB call so a failure returns JSON, not an HTML crash page.
    const { rows } = await pool.query(                // Run the parameterized query (parameterized = safe from SQL injection).
      `SELECT id, institution_name, country, category, areas,
              start_date, end_date, link, description, status, source
       FROM scholarships
       WHERE status = 'active'                       -- Hide inactive/expired rows from users entirely.
         AND ($1::text IS NULL OR country = $1)      -- If no country is given, return all; otherwise filter to it.
       ORDER BY category, institution_name`,          // Stable ordering so the panel doesn't shuffle between loads.
      [country || null]                               // Pass NULL when ?country= is absent, which triggers the "all" branch.
    );
    res.json(rows);                                   // Send the array; the client groups it by category.
  } catch (e) {                                       // Any DB/connection error...
    res.status(500).json({ error: "Could not load scholarships" }); // ...return a generic 500 (don't leak internals).
  }
});                                                   // End GET /scholarships.

// ===========================================================================
// WRITE OPERATIONS (Scholarship CMS) - ADMINISTRATOR ONLY
// Day 4 guarded these with requireAuth as a placeholder; Day 5 switches them to
// requireAdmin. A normal logged-in user token now receives 403 here, while READS
// above stay on requireAuth so every student still sees scholarships on the map.
// ===========================================================================

// Server-side validation. A human is typing these now (not a trusted feed), so
// bad input must be caught here rather than becoming a confusing database error.
function validateScholarship(f) {                                    // Returns an error string, or null when valid.
  if (!f.institution_name?.trim()) return "institution_name is required"; // Card title cannot be blank.
  if (!f.country?.trim()) return "country is required";              // Without a country it can never appear on the map.
  if (!["high_school", "university"].includes(f.category)) {         // Must be one of the two panel sections...
    return "invalid category";                                       // ...otherwise it would render in neither.
  }
  if (f.start_date && f.end_date && f.start_date > f.end_date) {     // Catch reversed application windows...
    return "start_date must be before end_date";                     // ...which would otherwise expire immediately.
  }
  return null;                                                        // All checks passed.
}

// POST /scholarships -> create a MANUAL entry (internal scholarships, API gaps).
router.post("/", requireAdmin, async (req, res) => {                 // Admin-only: create a manual entry.
  const f = req.body;                                                 // The submitted form fields.
  const err = validateScholarship(f);                                 // Validate before touching the database.
  if (err) return res.status(400).json({ error: err });               // Reject with the specific reason.

  try {
    const { rows } = await pool.query(
      // source='manual' is hard-coded here (never taken from the request), so a
      // manual entry can't masquerade as an API row. created_by records which
      // admin added it. Together these let the 24h refresh skip this row entirely.
      `INSERT INTO scholarships
         (institution_name, country, category, areas, start_date, end_date,
          link, description, status, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'active'),'manual',$10)
       RETURNING *`,                                                  // COALESCE defaults status to 'active' when omitted.
      [f.institution_name, f.country, f.category, f.areas, f.start_date,
       f.end_date, f.link, f.description, f.status, req.admin?.sub ?? null] // req.admin exists once Day 5's guard is in place.
    );
    res.status(201).json(rows[0]);                                    // 201 Created + the stored row.
  } catch (e) {
    res.status(500).json({ error: "Could not create scholarship" });   // Generic failure.
  }
});

// PUT /scholarships/:id -> edit an existing entry.
router.put("/:id", requireAdmin, async (req, res) => {                // Admin-only: edit an entry.
  const f = req.body;                                                  // Updated field values.
  const err = validateScholarship(f);                                  // Same validation as create.
  if (err) return res.status(400).json({ error: err });                // Reject invalid edits.

  try {
    const { rows } = await pool.query(
      `UPDATE scholarships SET
         institution_name = $1, country = $2, category = $3, areas = $4,
         start_date = $5, end_date = $6, link = $7, description = $8,
         status = $9, updated_at = now()                              -- Touch updated_at so the change is auditable.
       WHERE id = $10
       RETURNING *`,                                                   // NOTE: 'source' is intentionally NOT editable here.
      [f.institution_name, f.country, f.category, f.areas, f.start_date,
       f.end_date, f.link, f.description, f.status, req.params.id]
    );
    if (rows.length === 0) {                                           // No row matched that id...
      return res.status(404).json({ error: "Scholarship not found" }); // ...report 404 instead of returning null.
    }
    res.json(rows[0]);                                                 // Return the updated row.
  } catch (e) {
    res.status(500).json({ error: "Could not update scholarship" });    // Generic failure.
  }
});

// DELETE /scholarships/:id -> remove an entry (e.g. an internal scholarship that ended).
router.delete("/:id", requireAdmin, async (req, res) => {             // Admin-only: remove an entry.
  try {
    const { rowCount } = await pool.query(                            // rowCount tells us whether anything was actually deleted.
      "DELETE FROM scholarships WHERE id = $1",
      [req.params.id]
    );
    if (rowCount === 0) {                                              // Nothing matched that id...
      return res.status(404).json({ error: "Scholarship not found" }); // ...so say so rather than pretending success.
    }
    res.status(204).end();                                             // 204 No Content: deleted, nothing to return.
  } catch (e) {
    res.status(500).json({ error: "Could not delete scholarship" });    // Generic failure.
  }
});

export default router;                                // Export so app.js can mount it at /scholarships.
