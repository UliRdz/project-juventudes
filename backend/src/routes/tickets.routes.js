// src/routes/tickets.routes.js
// PURPOSE: The student side of the support-ticket system: open a ticket, list your
// own, read one thread, and reply to it.
// INTENDED OUTPUT LINK: this backs the new "Ayuda" button in App.jsx and the
// HelpWidget it opens. The admin side of the same tables lives in admin.routes.js
// under /admin/tickets and is surfaced by the "Solicitudes" tab of AdminPanel.jsx.
//
// WHY A TICKET SYSTEM AND NOT JUST AN EMAIL LINK: the categories below mirror the
// administrator's actual capabilities (password reset, profile edit, scholarship
// CMS, chat moderation, account deletion). A ticket therefore routes to a function
// an admin can genuinely perform, and its lifecycle (open -> in_progress -> closed)
// is measurable — which is what feeds the new dashboard KPI.

import { Router } from "express";                     // Express router for the /tickets endpoints.
import { pool } from "../config/db.js";               // Shared PostgreSQL pool.
import { requireAuth } from "../middleware/auth.js";  // Login gate: a ticket always belongs to a known user.

const router = Router();                              // Create the router.

// The option menu shown in the Help widget. Each key maps to something an
// administrator can actually DO in the admin panel, which is what keeps the
// categories useful rather than decorative.
export const CATEGORIES = {
  access:      "Acceso, contraseña o 2FA",              // -> admin reset-password / reset-2FA buttons.
  profile:     "Mi perfil o mi foto",                   // -> admin user edit form.
  scholarship: "Becas y convocatorias",                 // -> admin scholarship CMS.
  chat:        "Mensajes y contacto con otras personas",// -> admin chat moderation / mute.
  privacy:     "Privacidad y datos personales",         // -> admin phone fields, account deletion.
  report:      "Reportar contenido o conducta",         // -> admin moderation, conversation review.
  technical:   "Problema técnico del sitio",            // -> admin system settings / maintenance mode.
  other:       "Otro asunto",                           // Catch-all so nobody is blocked by the menu.
};

const VALID_CATEGORIES = Object.keys(CATEGORIES);      // Just the keys, for validation below.

// ---------------------------------------------------------------------------
// GET /tickets/categories  -> the option menu.
// ---------------------------------------------------------------------------
// Declared BEFORE "/:id" because Express matches in order: otherwise the literal
// word "categories" would be captured as an :id UUID and the query would fail.
// Serving the menu from the server means the UI can never drift from the values
// the API will accept.
router.get("/categories", requireAuth, (_req, res) => { // Login-gated like everything else here.
  res.json(CATEGORIES);                                 // { access: "Acceso, contraseña o 2FA", ... }
});

// ---------------------------------------------------------------------------
// GET /tickets  -> the caller's own tickets, newest activity first.
// ---------------------------------------------------------------------------
router.get("/", requireAuth, async (req, res) => {      // Protected: you only ever see your own.
  try {
    const { rows } = await pool.query(
      `SELECT t.id, t.category, t.subject, t.status, t.created_at, t.updated_at,
              COUNT(m.id)::int AS message_count       -- ::int so the JSON holds a number, not a string.
         FROM tickets t
         LEFT JOIN ticket_messages m ON m.ticket_id = t.id  -- LEFT so a ticket with no replies still appears.
        WHERE t.user_id = $1                          -- Scoped to the caller, taken from the verified token.
        GROUP BY t.id
        ORDER BY t.updated_at DESC`,                  // Most recently active at the top.
      [req.user.sub]
    );
    res.json(rows);                                    // Array of ticket summaries for the Help widget list.
  } catch {
    res.status(500).json({ error: "Could not load tickets" }); // Generic failure.
  }
});

// ---------------------------------------------------------------------------
// POST /tickets  -> open a new ticket with its first message.
// ---------------------------------------------------------------------------
// The ticket and its opening message are created together inside a transaction:
// a ticket with no message would show as an empty thread in the admin tab.
router.post("/", requireAuth, async (req, res) => {
  const { category, subject, message } = req.body;     // The three fields the Help widget collects.

  if (!VALID_CATEGORIES.includes(category)) {          // Reject anything outside the menu...
    return res.status(400).json({ error: "Invalid category" }); // ...so the admin filter can rely on the values.
  }
  if (!subject?.trim()) {                              // A subject is what the admin sees in the list.
    return res.status(400).json({ error: "Subject is required" });
  }
  if (!message?.trim()) {                              // An empty ticket gives the admin nothing to act on.
    return res.status(400).json({ error: "Message is required" });
  }

  const client = await pool.connect();                 // A dedicated connection, required for a transaction.
  try {
    await client.query("BEGIN");                       // Start the transaction.

    const { rows } = await client.query(               // Create the ticket header.
      `INSERT INTO tickets (user_id, category, subject)
       VALUES ($1, $2, $3)
       RETURNING id, category, subject, status, created_at, updated_at`,
      [req.user.sub, category, subject.trim().slice(0, 200)] // slice guards the VARCHAR(200) column.
    );
    const ticket = rows[0];                            // The created row.

    await client.query(                                // Store the opening message, authored by the student.
      `INSERT INTO ticket_messages (ticket_id, author_user_id, message)
       VALUES ($1, $2, $3)`,
      [ticket.id, req.user.sub, message.trim()]        // author_admin_id stays NULL — that's how the UI aligns the bubble.
    );

    await client.query("COMMIT");                      // Both rows land, or neither does.
    res.status(201).json(ticket);                      // 201 Created + the ticket so the widget can open it.
  } catch {
    await client.query("ROLLBACK").catch(() => {});    // Undo on any failure; swallow rollback errors.
    res.status(500).json({ error: "Could not create ticket" });
  } finally {
    client.release();                                  // ALWAYS return the connection to the pool.
  }
});

// ---------------------------------------------------------------------------
// GET /tickets/:id  -> one ticket with its full message thread.
// ---------------------------------------------------------------------------
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const { rows: t } = await pool.query(
      `SELECT id, category, subject, status, created_at, updated_at
         FROM tickets
        WHERE id = $1
          AND user_id = $2`,                           // The ownership check IS the authorization: you cannot read someone else's ticket.
      [req.params.id, req.user.sub]
    );
    if (t.length === 0) return res.status(404).json({ error: "Ticket not found" }); // Also the answer for "not yours".

    const { rows: messages } = await pool.query(
      `SELECT id, author_user_id, author_admin_id, message, created_at
         FROM ticket_messages
        WHERE ticket_id = $1
        ORDER BY created_at ASC`,                      // Oldest first so the thread reads top-to-bottom.
      [req.params.id]
    );

    res.json({ ...t[0], messages });                   // Header + thread in one payload, so the widget needs one request.
  } catch {
    res.status(500).json({ error: "Could not load ticket" });
  }
});

// ---------------------------------------------------------------------------
// POST /tickets/:id/messages  -> the student replies.
// ---------------------------------------------------------------------------
router.post("/:id/messages", requireAuth, async (req, res) => {
  const { message } = req.body;                        // The reply text.
  if (!message?.trim()) {                              // Blank replies are rejected.
    return res.status(400).json({ error: "Message is required" });
  }

  try {
    const { rows: t } = await pool.query(
      "SELECT id, status FROM tickets WHERE id = $1 AND user_id = $2", // Ownership check again.
      [req.params.id, req.user.sub]
    );
    if (t.length === 0) return res.status(404).json({ error: "Ticket not found" });

    const { rows } = await pool.query(                 // Store the reply.
      `INSERT INTO ticket_messages (ticket_id, author_user_id, message)
       VALUES ($1, $2, $3)
       RETURNING id, author_user_id, author_admin_id, message, created_at`,
      [req.params.id, req.user.sub, message.trim()]
    );

    // Replying to a CLOSED ticket reopens it. Without this a user could write into
    // a closed thread and no admin would ever see it, because the admin tab filters
    // by status. Touching updated_at also floats the ticket to the top of the list.
    await pool.query(
      `UPDATE tickets
          SET updated_at = now(),
              status = CASE WHEN status = 'closed' THEN 'open' ELSE status END  -- Reopen only if it was closed; leave 'in_progress' alone.
        WHERE id = $1`,
      [req.params.id]
    );

    res.status(201).json(rows[0]);                     // The stored message, appended by the widget.
  } catch {
    res.status(500).json({ error: "Could not send message" });
  }
});

export default router;                                  // Export for mounting at /tickets in app.js.
