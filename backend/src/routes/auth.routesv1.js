// src/routes/auth.routes.js
// PURPOSE: All authentication endpoints in one router: register, login (with
// optional 2FA), TOTP setup/verify, and profile-photo upload.
// INTENDED OUTPUT LINK: this is the gate to the whole app. Registration fills the
// users table; login returns the JWT that unlocks the map, chat, and profile;
// TOTP adds the optional second factor; the photo endpoint sets the avatar shown
// on user cards. Every login attempt is also written to audit_logs (security).

import { Router } from "express";                 // Express's mini-app for grouping related routes under /auth.
import bcrypt from "bcrypt";                       // One-way password hashing (never store or "decrypt" raw passwords).
import jwt from "jsonwebtoken";                    // Create/verify the signed session token returned on login.
import speakeasy from "speakeasy";                 // Generate/verify TOTP secrets and 6-digit codes (RFC 6238).
import QRCode from "qrcode";                       // Turn the TOTP otpauth:// URI into a scannable QR image.
import { pool } from "../config/db.js";            // Shared PostgreSQL connection pool for all queries below.
import { requireAuth } from "../middleware/auth.js"; // Gatekeeper so TOTP/photo endpoints require a logged-in user.
import { uploadPhoto, storeAndGetUrl } from "../services/photos.js"; // Multer validator + disk-storage helper.

const router = Router();       // Create the router we'll attach handlers to and export.
const SALT_ROUNDS = 12;        // bcrypt cost factor (>=12 per security notes): higher = slower to brute-force.

// ============================ REGISTER =======================================
// Creates a new user with a hashed password. Backs the Register.jsx form.
router.post("/register", async (req, res) => {                 // Handle POST /auth/register.
  const { email, password, first_name, last_name } = req.body; // Pull the fields the form sends.
  if (!email || !password || password.length < 8) {           // Basic validation: email present + password at least 8 chars.
    return res.status(400).json({ error: "Email and 8+ char password required" }); // Reject weak/missing input with 400.
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);       // Hash the password; only this hash is ever stored.
  try {                                                        // INSERT can fail on a duplicate email, so guard it.
    const { rows } = await pool.query(                         // Insert the new user and return only safe columns.
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name`,            // RETURNING avoids a second SELECT and never returns the hash.
      [email.toLowerCase(), hash, first_name, last_name]       // Lowercase email so "A@x.com" and "a@x.com" can't both register.
    );
    res.status(201).json(rows[0]);                             // 201 Created + the new user's public fields.
  } catch (e) {                                                // Handle DB errors.
    if (e.code === "23505") {                                 // Postgres 23505 = unique_violation (email already exists)...
      return res.status(409).json({ error: "Email already registered" }); // ...so return 409 Conflict, not a 500.
    }
    res.status(500).json({ error: "Registration failed" });    // Any other DB error -> generic 500 (don't leak internals).
  }
});                                                            // End /register.

// ============================== LOGIN ========================================
// Verifies credentials, enforces 2FA if enabled, and issues a JWT. Backs Login.jsx.
router.post("/login", async (req, res) => {                    // Handle POST /auth/login.
  const { email, password, totp } = req.body;                  // Credentials + optional 6-digit 2FA code.
  const { rows } = await pool.query(                           // Look up the active user by email.
    "SELECT * FROM users WHERE email = $1 AND is_active = TRUE",// is_active filter means banned/deactivated users can't log in.
    [email?.toLowerCase()]                                     // Lowercase to match how we stored it at registration.
  );
  const user = rows[0];                                        // Either the user row or undefined if not found.

  // Same generic message whether the email is unknown OR the password is wrong,
  // so an attacker can't tell which emails are registered (user enumeration).
  if (!user || !(await bcrypt.compare(password || "", user.password_hash))) { // bcrypt.compare re-hashes and checks constant-time.
    await logAttempt(req, email, "login_fail");                // Record the failed attempt for security monitoring.
    return res.status(401).json({ error: "Invalid credentials" }); // 401 with a deliberately vague message.
  }

  if (user.totp_enabled) {                                     // If this user turned on 2FA...
    if (!totp) {                                               // ...and didn't include a code yet...
      return res.status(206).json({ mfa_required: true });     // ...tell the frontend to prompt for the 6-digit code (206 = partial).
    }
    const ok = verifyTotp(user.totp_secret, totp);             // Check the submitted code against their secret.
    if (!ok) {                                                 // Wrong/expired code...
      await logAttempt(req, email, "login_fail_2fa");          // ...log it as a 2FA failure...
      return res.status(401).json({ error: "Invalid 2FA code" }); // ...and reject.
    }
  }

  const token = jwt.sign(                                      // Create the session token the client stores and resends.
    { sub: user.id, email: user.email },                      // Payload: subject (user id) + email; readable but signature-protected.
    process.env.JWT_SECRET,                                   // Sign with the server secret so it can't be forged.
    { expiresIn: "2h" }                                       // Token auto-expires in 2 hours, limiting damage if leaked.
  );
  await logAttempt(req, email, "login_success");               // Record the successful login.
  res.json({ token, user: publicUser(user) });                 // Return the token + safe user fields (no hash/secret).
});                                                            // End /login.

// ========================= TOTP (2FA) SETUP ==================================
// Step A: generate a secret + QR for the user to scan in their authenticator app.
router.post("/totp/setup", requireAuth, async (req, res) => {  // Protected: only a logged-in user can set up their own 2FA.
  const secret = speakeasy.generateSecret({                    // Create a fresh random TOTP secret...
    name: `Juventudes (${req.user.email})`,                    // ...labeled so it shows nicely in Google Authenticator.
  });
  // Store the secret now but leave totp_enabled = FALSE until they prove they can
  // generate a valid code (step B). This prevents locking users out on a typo.
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [ // Save the pending secret on the user's row.
    secret.base32,                                             // base32 is the standard encoding authenticator apps expect.
    req.user.sub,                                              // req.user.sub = the logged-in user's id (from the JWT).
  ]);
  const qr = await QRCode.toDataURL(secret.otpauth_url);       // Encode the otpauth:// URI as a data-URL image the browser can show.
  res.json({ qr, manual_key: secret.base32 });                 // Return the QR (for scanning) + the manual key (for typing).
});                                                            // End /totp/setup.

// Step B: confirm the user scanned it by checking one code, then enable 2FA.
router.post("/totp/verify", requireAuth, async (req, res) => { // Protected: same logged-in user confirms their setup.
  const { rows } = await pool.query(                           // Fetch the pending secret we stored in step A.
    "SELECT totp_secret FROM users WHERE id = $1",
    [req.user.sub]
  );
  const ok = verifyTotp(rows[0].totp_secret, req.body.totp);   // Validate the code the user typed from their app.
  if (!ok) {                                                   // If it doesn't match...
    return res.status(400).json({ error: "Code did not match" }); // ...don't enable 2FA; ask them to try again.
  }
  await pool.query("UPDATE users SET totp_enabled = TRUE WHERE id = $1", [req.user.sub]); // Flip the flag ON so future logins require 2FA.
  res.json({ totp_enabled: true });                            // Confirm success to the frontend.
});                                                            // End /totp/verify.

// ========================= PROFILE PHOTO =====================================
// Upload/replace the avatar. uploadPhoto (multer) validates size/type BEFORE this runs.
router.post(
  "/me/photo",                                                 // POST /auth/me/photo.
  requireAuth,                                                 // Must be logged in (we set the photo on THIS user).
  uploadPhoto.single("photo"),                                // Parse a single file from the "photo" form field (5MB, JPG/PNG only).
  async (req, res) => {                                        // Runs only if validation passed and a file is present.
    if (!req.file) {                                           // Defensive: no file attached...
      return res.status(400).json({ error: "No photo uploaded" }); // ...return a clear 400.
    }
    const url = storeAndGetUrl(req.file);                       // Save the bytes and get back the URL to store.
    await pool.query("UPDATE users SET profile_photo_url = $1 WHERE id = $2", [ // Persist the URL on the user's row...
      url,                                                     // ...so it can be shown as their avatar (Day 3 map cards).
      req.user.sub,
    ]);
    res.json({ profile_photo_url: url });                       // Return the new URL to the frontend.
  }
);                                                            // End /me/photo.

// Multer error handler scoped to this router: converts upload errors (too big /
// wrong type) into clean 400s instead of unhandled 500s.
router.use((err, _req, res, _next) => {                        // Express error middleware (4 args) catches errors thrown above.
  if (err) {                                                   // If any handler/multer passed an error...
    return res.status(400).json({ error: err.message });       // ...respond 400 with the message (e.g. "Only JPG/PNG allowed", "File too large").
  }
});                                                            // End error handler.

// ============================ HELPERS ========================================
// verifyTotp is a function DECLARATION, so it's hoisted and usable above in /login.
export function verifyTotp(secret, token) {                    // Reusable TOTP check (also imported by admin login on Day 5).
  return speakeasy.totp.verify({                               // Compare the submitted code against the secret...
    secret,                                                    // ...the user's stored base32 secret...
    encoding: "base32",                                        // ...tell speakeasy the secret is base32-encoded...
    token,                                                     // ...the 6-digit code the user typed...
    window: 1,                                                 // ...allow +/- 1 time-step (30s) for clock drift between phone and server.
  });
}                                                             // End verifyTotp.

function publicUser(u) {                                       // Strip secrets before returning a user to the client.
  const { password_hash, totp_secret, ...safe } = u;          // Destructure out the sensitive fields; keep the rest in `safe`.
  return safe;                                                 // Return only the non-sensitive columns.
}                                                             // End publicUser.

async function logAttempt(req, email, action) {                // Write one row to audit_logs for each login attempt.
  await pool.query(                                            // Insert actor (email), what happened, and the caller's IP.
    "INSERT INTO audit_logs (actor, action, ip) VALUES ($1, $2, $3)",
    [email || null, action, req.ip]                            // req.ip is the client IP (used for anomaly detection).
  );
}                                                             // End logAttempt.

export default router;                                         // Export the assembled router so app.js can mount it at /auth.
