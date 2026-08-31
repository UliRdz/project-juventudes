// src/services/photos.js
// PURPOSE: Handle profile-photo uploads safely: enforce a 5MB size cap and
// JPG/PNG-only rule (per the product spec), and provide a helper that saves the
// file and returns a URL to store on the user's row.
// INTENDED OUTPUT LINK: the URL this produces is written to users.profile_photo_url,
// which is what renders as the circular avatar on the map's user cards (Day 3).

import multer from "multer";      // Middleware that parses multipart/form-data (how browsers send file uploads).
import fs from "fs";             // Node's filesystem module: used to create the folder and write the image bytes.
import path from "path";         // Helps build safe, OS-correct file paths.
import crypto from "crypto";     // Generates a random unique filename so uploads never collide/overwrite.

const ALLOWED = ["image/jpeg", "image/png"]; // Whitelist of accepted MIME types; anything else is rejected.

// For local development we save images to backend/uploads/ and serve them
// statically (see app.js). NOTE: on ephemeral hosts (Render/Railway) local disk
// is wiped on redeploy, so production should swap storeAndGetUrl() for object
// storage (S3, Cloudinary, etc.). The multer validation below stays identical.
const UPLOAD_DIR = path.resolve("uploads"); // Absolute path to the uploads folder at the backend root.

if (!fs.existsSync(UPLOAD_DIR)) {           // If the uploads folder doesn't exist yet...
  fs.mkdirSync(UPLOAD_DIR, { recursive: true }); // ...create it (recursive avoids errors if parents are missing).
}

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

// Save the in-memory file to disk and return the public URL path to store in the DB.
export function storeAndGetUrl(file) {                          // file = req.file provided by multer.
  const ext = file.mimetype === "image/png" ? ".png" : ".jpg"; // Pick the extension from the validated MIME type.
  const name = crypto.randomBytes(16).toString("hex") + ext;   // Random 32-char filename + ext -> unique, unguessable, no collisions.
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);  // Write the raw image bytes to backend/uploads/<name>.
  return `/uploads/${name}`;                                   // Return the URL path; app.js serves /uploads statically so the browser can load it.
}                                                              // End storeAndGetUrl.
