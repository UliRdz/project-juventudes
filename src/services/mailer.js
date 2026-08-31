// src/services/mailer.js
// PURPOSE: Send the transactional email that must fire every time a chat message
// is sent, using SMTP via nodemailer.
// INTENDED OUTPUT LINK: the product spec makes this mandatory — "Email notification
// must always trigger on chat". Users may not have the site open, so this email is
// what actually brings them back to reply.

import nodemailer from "nodemailer";   // Library that speaks SMTP and formats the message.
import { pool } from "../config/db.js"; // Used to look up the sender's name and the recipient's address.

// Create ONE reusable transporter at module load. Nodemailer pools connections,
// so we avoid re-negotiating TLS on every single message.
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,                          // Mail server hostname from .env (Mailtrap/MailHog in dev).
  port: Number(process.env.SMTP_PORT || 587),           // Port; 587 (STARTTLS) is the common default.
  secure: Number(process.env.SMTP_PORT) === 465,        // true only for port 465 (implicit TLS); 587 upgrades via STARTTLS instead.
  auth: process.env.SMTP_USER                            // Only attach credentials if a username is configured...
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } // ...normal authenticated relay.
    : undefined,                                         // ...local catchers (MailHog) often accept mail with no auth at all.
  tls: { rejectUnauthorized: false },                    // Accept self-signed certs, which local dev catchers use.
});

// Returns true when SMTP is configured. Lets callers skip mail cleanly in dev
// rather than throwing a connection error on every message.
export function mailerConfigured() {         // Small helper used by the chat route's logging.
  return Boolean(process.env.SMTP_HOST);     // If no host is set, there is nowhere to send.
}

export async function sendChatEmail({ senderId, receiverId, message }) { // Called (fire-and-forget) after a message is stored.
  if (!mailerConfigured()) {                                             // No SMTP host configured (typical local setup)...
    console.warn("SMTP not configured - skipping chat notification email"); // ...warn so the omission is visible in logs...
    return;                                                              // ...and return without throwing.
  }

  // One query fetches both people: s = sender (for the name), r = receiver (for the address).
  const { rows } = await pool.query(
    `SELECT s.first_name AS sender_name,      -- Shown in the subject line and body.
            s.email      AS sender_email,     -- Included so the recipient can reply directly if they prefer.
            r.email      AS receiver_email    -- The destination address for this email.
     FROM users s, users r
     WHERE s.id = $1 AND r.id = $2`,          // Cross-join filtered to exactly these two ids -> one row.
    [senderId, receiverId]
  );

  if (rows.length === 0) return;                    // Either user was deleted between send and email; nothing to do.
  const { sender_name, sender_email, receiver_email } = rows[0]; // Destructure the three values we need.

  await transporter.sendMail({                       // Hand the message to the SMTP server.
    from: process.env.SMTP_FROM,                     // The platform's sender address (e.g. juventudes@gtoxmundo.com).
    to: receiver_email,                              // Deliver to the person who received the chat message.
    replyTo: sender_email,                           // Hitting "Reply" goes to the actual sender, not the no-reply mailbox.
    subject: `Nuevo mensaje de ${sender_name}`,      // Subject required by the spec: "New message from [Sender Name]".
    text:                                            // Plain-text body (renders everywhere, no HTML needed).
      `Has recibido un nuevo mensaje:\n\n` +         // Spanish-first greeting line.
      `De: ${sender_name}\n` +                       // Who sent it.
      `Correo: ${sender_email}\n` +                  // Their email address.
      `Mensaje: ${message}\n` +                      // The message text itself.
      `Hora: ${new Date().toISOString()}\n\n` +      // Timestamp in UTC ISO format.
      `Responde aquí: ${process.env.FRONTEND_ORIGIN}`, // Deep link back to the app to continue the conversation.
  });
}                                                    // End sendChatEmail.

// Used by the Day 5 admin panel's "Test SMTP" button to verify credentials
// without needing a real chat message.
export async function sendTestEmail(to) {                    // to = address the admin wants to test against.
  if (!mailerConfigured()) throw new Error("SMTP not configured"); // Fail loudly here: the admin explicitly asked for a test.
  await transporter.sendMail({                                // Send a minimal message.
    from: process.env.SMTP_FROM,                              // Same platform sender address.
    to,                                                       // The admin-supplied destination.
    subject: "Prueba de configuración SMTP",                  // Clear test subject.
    text: "Si recibes este correo, la configuración SMTP funciona correctamente.", // Confirms delivery end to end.
  });
}                                                             // End sendTestEmail.
