// src/routes/photos.routes.js
// PURPOSE: Serve a user's profile photo out of the database as a real image
// response, so <img src="..."> works from the GitHub Pages frontend.
// INTENDED OUTPUT LINK: this replaces the old `express.static("uploads")` mount in
// app.js. saveUserPhoto() (services/photos.js) stores "/photos/<userId>?v=<ts>" in
// users.profile_photo_url; mediaUrl() on the frontend prefixes the backend origin;
// this route answers that request. It is the second half of the photo bug fix — the
// migration and the service persist the bytes, this hands them to the browser.

import { Router } from "express";                         // Express router for the /photos endpoint.
import { getUserPhoto } from "../services/photos.js";     // Reads the bytes + MIME type from the users row.

const router = Router();                                  // Create the router.

// ---------------------------------------------------------------------------
// GET /photos/:userId  -> the raw image.
// ---------------------------------------------------------------------------
// DELIBERATELY NOT BEHIND requireAuth. A browser cannot attach an Authorization
// header to an <img src>, so an authenticated image URL would simply never load.
// This matches the security level of the previous /uploads mount, which was also
// unauthenticated. The protection is that the URL contains a v4 UUID: it is not
// enumerable, and it is only ever handed out through /users (login-gated) or
// /admin/users (admin-gated). Deactivated accounts stop serving entirely, which is
// enforced inside getUserPhoto().
router.get("/:userId", async (req, res) => {              // :userId identifies whose avatar to send.
  try {
    const photo = await getUserPhoto(req.params.userId);  // Fetch bytes + type, or null.

    if (!photo) {                                        // No photo, no such user, or the account is deactivated...
      return res.status(404).json({ error: "No photo" }); // ...404 so the frontend's onError fallback shows the placeholder.
    }

    // The URL carries a ?v=<upload timestamp>, so a given URL always maps to the
    // same bytes. That makes it safe to cache hard: a replaced photo gets a NEW
    // URL rather than needing the old one revalidated.
    res.set("Content-Type", photo.mime);                          // Tell the browser it's a JPEG or PNG.
    res.set("Cache-Control", "public, max-age=31536000, immutable"); // One year; safe because the URL changes on every upload.
    res.set("Cross-Origin-Resource-Policy", "cross-origin");      // Explicit: the image is embedded from a DIFFERENT origin (GitHub Pages).

    res.send(photo.buffer);                                       // Write the raw bytes as the response body.
  } catch {
    res.status(500).json({ error: "Could not load photo" });       // Generic failure; the UI falls back to the placeholder.
  }
});                                                                // End GET /photos/:userId.

export default router;                                             // Export for mounting at /photos in app.js.
