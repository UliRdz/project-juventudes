// src/routes/chat.routes.js
// PURPOSE: Chat persistence endpoints — load the conversation history with one
// person, and send a new message (which stores it, pushes it live, and emails the
// recipient).
// INTENDED OUTPUT LINK: this backs the chat widget opened by the "Chat" button on
// a user card in the Day 3 dual popup. Every send writes to the chats table AND
// triggers the mandatory email notification.

import { Router } from "express";                        // Express router for the /chat endpoints.
import { pool } from "../config/db.js";                  // Shared PostgreSQL pool.
import { requireAuth } from "../middleware/auth.js";     // Login gate: chat is never public.
import { chatLimiter } from "../middleware/rateLimit.js";// Caps sends per minute (anti-spam / anti-email-flood).
import { sendChatEmail } from "../services/mailer.js";   // The SMTP notification.
import { emitToUser } from "../realtime.js";             // Server-side Socket.io push to the recipient.

const router = Router();                                 // Create the router.

// ---------------------------------------------------------------------------
// GET /chat/unread  -> how many messages the caller hasn't read.
// Declared BEFORE "/:otherId" because Express matches routes in order: otherwise
// the literal word "unread" would be captured as an :otherId UUID and fail.
// ---------------------------------------------------------------------------
router.get("/unread", requireAuth, async (req, res) => {   // Protected: counts only the caller's own unread messages.
  try {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count      -- ::int casts Postgres' bigint to a JS-friendly number.
       FROM chats
       WHERE receiver_id = $1             -- Messages addressed to me...
         AND read_at IS NULL`,            // ...that I haven't opened yet (feeds the Day 5 "Pending chats" widget).
      [req.user.sub]
    );
    res.json(rows[0]);                                    // e.g. { count: 3 }
  } catch {
    res.status(500).json({ error: "Could not load unread count" }); // Generic failure.
  }
});

// ---------------------------------------------------------------------------
// GET /chat/:otherId  -> full conversation between me and one other user.
// ---------------------------------------------------------------------------
router.get("/:otherId", requireAuth, async (req, res) => {  // :otherId = the person whose thread we're opening.
  const me = req.user.sub;                                   // My id, taken from the verified JWT (never from the client body).
  try {
    const { rows } = await pool.query(
      // A conversation is symmetric: messages I sent to them, plus messages they
      // sent to me. The OR pair below collects both directions.
      `SELECT id, sender_id, receiver_id, message, read_at, created_at
       FROM chats
       WHERE (sender_id = $1 AND receiver_id = $2)   -- my messages to them
          OR (sender_id = $2 AND receiver_id = $1)   -- their messages to me
       ORDER BY created_at ASC`,                     // Oldest first so the widget reads top-to-bottom.
      [me, req.params.otherId]
    );

    // Opening the thread marks their messages to me as read. This only touches
    // rows where I am the RECEIVER, so it can never mark my own sent messages read.
    await pool.query(
      `UPDATE chats SET read_at = now()
       WHERE receiver_id = $1 AND sender_id = $2 AND read_at IS NULL`, // Only unread ones, so timestamps aren't overwritten.
      [me, req.params.otherId]
    );

    res.json(rows);                                          // Return the thread (pre-update state, which is what the UI renders).
  } catch {
    res.status(500).json({ error: "Could not load conversation" }); // Generic failure.
  }
});

// ---------------------------------------------------------------------------
// POST /chat  -> send a message.
// Order of operations matters: validate -> store -> push live -> email.
// ---------------------------------------------------------------------------
router.post("/", requireAuth, chatLimiter, async (req, res) => { // chatLimiter runs before the handler (20/min).
  const { receiver_id, message } = req.body;                     // Who it's for and what it says.

  if (!message || !message.trim()) {                             // Reject blank/whitespace-only sends...
    return res.status(400).json({ error: "Empty message" });     // ...so empty rows never reach the database.
  }
  if (!receiver_id) {                                            // A message needs a destination.
    return res.status(400).json({ error: "receiver_id is required" });
  }
  if (receiver_id === req.user.sub) {                            // Guard against messaging yourself...
    return res.status(400).json({ error: "Cannot message yourself" }); // ...which would also email the sender pointlessly.
  }

  try {
    // Day 5 moderation: a muted user keeps their account and can still browse the
    // map, but may not SEND messages. Checked here (not just in the UI) so muting
    // cannot be bypassed with a direct API call.
    const { rows: me } = await pool.query(
      "SELECT chat_disabled FROM users WHERE id = $1",            // Look up the SENDER's mute flag.
      [req.user.sub]
    );
    if (me[0]?.chat_disabled) {                                   // The admin has muted this account...
      return res.status(403).json({ error: "Chat disabled for this account" }); // ...refuse the send.
    }

    // Confirm the recipient exists and is active. Without this, a bad id would
    // hit a foreign-key error (500); this gives a clear 404 and avoids emailing
    // a deactivated account.
    const { rows: target } = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND is_active = TRUE",  // Must be a real, active user.
      [receiver_id]
    );
    if (target.length === 0) {                                    // No such active user...
      return res.status(404).json({ error: "Recipient not found" }); // ...tell the client clearly.
    }

    const { rows } = await pool.query(                            // STEP 1: persist the message (the source of truth).
      `INSERT INTO chats (sender_id, receiver_id, message)
       VALUES ($1, $2, $3) RETURNING *`,                          // RETURNING gives us the id/created_at to send back.
      [req.user.sub, receiver_id, message.trim()]                 // sender_id comes from the TOKEN, so it can't be spoofed.
    );
    const saved = rows[0];                                        // The stored row we'll return and broadcast.

    // STEP 2: push it live to the recipient's open browser, if any. Emitting
    // here (server-side, after storage) is what makes the chat real-time — the
    // client never emits chat events itself.
    emitToUser(receiver_id, "dm", saved);                         // Only the recipient's room; the sender already has it locally.

    // STEP 3: email the recipient. Deliberately NOT awaited: SMTP can be slow or
    // down, and the spec requires the message itself to send regardless. Failures
    // are logged, never surfaced as a failed send.
    sendChatEmail({ senderId: req.user.sub, receiverId: receiver_id, message: message.trim() })
      .catch((e) => console.error("SMTP relay failed:", e.message)); // Log-and-continue.

    res.status(201).json(saved);                                  // 201 Created + the stored message.
  } catch (e) {
    res.status(500).json({ error: "Could not send message" });     // Generic failure.
  }
});                                                                // End POST /chat.

export default router;                                             // Export for mounting at /chat in app.js.
