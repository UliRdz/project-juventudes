// src/services/photos.js
// PURPOSE: Handle profile-photo uploads safely: enforce a 5MB size cap and
// JPG/PNG-only rule (per the product spec), and persist the image so it survives
// a redeploy.
// INTENDED OUTPUT LINK: the URL this produces is written to users.profile_photo_url,
// which is what renders as the circular avatar on the map's user cards, in the chat
// header, in the app header, and in the admin user list.
//
// CHANGE (this patch) — THE PHOTO BUG FIX:
// The previous version wrote the file to backend/uploads/ and returned the path
// "/uploads/<random>.jpg". That works locally and FAILS in production, because
// Render's filesystem is ephemeral: it is wiped on every redeploy and on every
// cold start of a sleeping free instance. The database kept the path; the file was
// gone; <img> received a 404. That is precisely the reported symptom — the photo
// appeared in "Mi Perfil" (rendered from the upload RESPONSE, still in memory) but
// nowhere else (rendered from a stored path whose file had vanished).
//
// The bytes now go into Postgres, which persists across deploys. multer's
// validation is unchanged, and the returned value is still a relative path, so
// mediaUrl() on the frontend needs no modification at all.

import multer from "multer";      // Middleware that parses multipart/form-data (how browsers send file uploads).
import { pool } from "../config/db.js"; // Shared PostgreSQL pool — the photo now lives here instead of on disk.

const ALLOWED = ["image/jpeg", "image/png"]; // Whitelist of accepted MIME types; anything else is rejected.

export const uploadPhoto = multer({          // Configure the multer instance used as route middleware.
  limits: { fileSize: 5 * 1024 * 1024 },     // Hard cap at 5MB (5 * 1024 * 1024 bytes); larger files are rejected before hitting the handler.
  fileFilter: (_req, file, cb) => {          // Runs per file to accept/reject based on type.
    if (!ALLOWED.includes(file.mimetype)) {  // If the uploaded file's MIME type isn't JPG/PNG...
      return cb(new Error("Only JPG/PNG allowed")); // ...reject it with a clear error (surfaced by the route's error handler).
    }
    cb(null, true);                          // Otherwise accept the file (null error, true = keep it).
  },
  storage: multer.memoryStorage(),           // Keep the file in memory (req.file.buffer) so we control exactly how/where it's saved.
});                                           // End multer config.

// ---------------------------------------------------------------------------
// saveUserPhoto(userId, file) — persist the bytes and return the URL to store.
// ---------------------------------------------------------------------------
// Replaces the old storeAndGetUrl(). It writes the image and its MIME type onto
// the user's own row in one statement, then returns the path the frontend should
// keep in profile_photo_url.
export async function saveUserPhoto(userId, file) {              // userId = the owner; file = req.file from multer.
  const { rows } = await pool.query(                             // Single UPDATE: bytes, type, and a fresh timestamp together.
    `UPDATE users
        SET profile_photo            = $1,
            profile_photo_mime       = $2,
            profile_photo_updated_at = now()
      WHERE id = $3
      RETURNING profile_photo_updated_at`,                       // RETURNING gives us the exact timestamp to build the cache-busting URL.
    [file.buffer, file.mimetype, userId]                         // The raw bytes go straight into the BYTEA column.
  );

  if (rows.length === 0) {                                       // No row matched — the account was deleted mid-request.
    throw new Error("User not found");                           // Surfaced as a 400 by the route's error handler.
  }

  // The ?v= suffix is what makes a REPLACED photo appear immediately. Browsers
  // cache images aggressively by URL; without a changing query string, uploading a
  // new picture would leave the old one on screen until a hard refresh.
  const version = new Date(rows[0].profile_photo_updated_at).getTime(); // Milliseconds since epoch — changes on every upload.
  return `/photos/${userId}?v=${version}`;                       // Relative path, exactly like before, so mediaUrl() is unchanged.
}                                                                // End saveUserPhoto.

// ---------------------------------------------------------------------------
// getUserPhoto(userId) — read the bytes back out, for GET /photos/:userId.
// ---------------------------------------------------------------------------
export async function getUserPhoto(userId) {                     // Returns { buffer, mime } or null when there is no photo.
  const { rows } = await pool.query(
    `SELECT profile_photo, profile_photo_mime
       FROM users
      WHERE id = $1
        AND is_active = TRUE`,                                   // Deactivated accounts stop serving their avatar too.
    [userId]
  );

  if (rows.length === 0 || !rows[0].profile_photo) return null;   // No such user, or the user has no photo.

  return {
    buffer: rows[0].profile_photo,                                // A Node Buffer, ready to write to the response.
    mime: rows[0].profile_photo_mime || "image/jpeg",             // Fall back to JPEG if the type was somehow never recorded.
  };
}                                                                 // End getUserPhoto.
