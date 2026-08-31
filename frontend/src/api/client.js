// src/api/client.js
// PURPOSE: A single, reusable wrapper around fetch() so every part of the app
// talks to the backend the same way (same base URL, same headers, same error
// handling) instead of repeating fetch boilerplate everywhere.
// INTENDED OUTPUT LINK: every screen that loads or sends data — login, the map's
// scholarships/users, chat, admin — will call this api() function. Centralizing
// it here means the backend URL and auth header are defined in exactly one place.
//
// CHANGE (photo release): this file now also exports API_BASE_URL, mediaUrl() and
// upload(). Those three additions are the "API link orchestration" that makes an
// uploaded avatar actually appear on the map cards and in the chat header — the
// backend stores a RELATIVE path ("/uploads/ab12.jpg"), which a browser on GitHub
// Pages would resolve against github.io and fail to load. mediaUrl() rewrites it
// to the backend origin; upload() is the multipart sibling of api() used by the
// new photo button in Profile.jsx.

export const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000"; // Read the backend URL from Vite env (set per environment); default to local dev. EXPORTED now so mediaUrl()/upload() and any component can reuse the exact same origin.
export const API_BASE_URL = BASE_URL;                     // Alias kept for readability at call sites (e.g. AdminPanel's CSV download reads the backend origin).

export async function api(path, { method = "GET", body, token } = {}) { // Exported helper: path plus optional method/body/token; sensible defaults.
  const res = await fetch(`${BASE_URL}${path}`, {          // Send the HTTP request to BASE_URL + path (e.g. "/health", "/scholarships").
    method,                                                 // GET/POST/PUT/DELETE — defaults to GET when not provided.
    headers: {                                              // Request headers:
      "Content-Type": "application/json",                   // Tell the server we send/expect JSON so req.body parses correctly.
      ...(token ? { Authorization: `Bearer ${token}` } : {}), // If a JWT is passed, attach it so protected routes accept the request (Day 2+).
    },                                                      // End headers.
    body: body ? JSON.stringify(body) : undefined,          // Serialize the JS object to a JSON string; omit the body entirely for GET.
  });                                                       // End fetch options.

  if (!res.ok) {                                            // res.ok is false for 4xx/5xx statuses (errors).
    const err = await res.json().catch(() => ({}));         // Try to read the server's JSON error message; fall back to empty if none.
    throw new Error(err.error || res.statusText);           // Throw so callers can .catch() and show the message (e.g. "Invalid credentials").
  }                                                         // End error handling.

  if (res.status === 204) return null;                      // 204 No Content (admin DELETE routes) has an EMPTY body — res.json() would throw, so return null instead.

  return res.json();                                        // On success, parse and return the JSON payload to the caller.
}                                                           // End api(): callers use `await api("/path", { ... })`.

// ---------------------------------------------------------------------------
// mediaUrl(path) — turn a stored file path into a URL the browser can load.
// ---------------------------------------------------------------------------
// WHY THIS EXISTS: photos.js (backend) saves the avatar and stores the RELATIVE
// path "/uploads/<random>.jpg" in users.profile_photo_url. The frontend is served
// from a DIFFERENT origin (GitHub Pages), so <img src="/uploads/x.jpg"> would ask
// github.io for a file that only exists on Render. This helper prefixes the
// backend origin so the image resolves, while leaving already-absolute URLs alone
// (which is what happens the day storeAndGetUrl() is swapped for S3/Cloudinary).
export function mediaUrl(path, fallback = "") {             // path = whatever the API returned; fallback = image to use when there is no photo.
  if (!path) return fallback;                               // No photo uploaded yet -> caller's placeholder (the brand favicon).
  if (/^https?:\/\//i.test(path)) return path;              // Already an absolute http(s) URL (future S3/Cloudinary) -> use it untouched.
  if (/^data:/i.test(path)) return path;                    // A local data: URL (the instant preview before upload) -> use it untouched.
  return `${BASE_URL}${path.startsWith("/") ? "" : "/"}${path}`; // Otherwise glue the backend origin in front, inserting "/" only if missing.
}                                                           // End mediaUrl.

// ---------------------------------------------------------------------------
// upload(path, file, { token, field }) — multipart sibling of api().
// ---------------------------------------------------------------------------
// WHY A SEPARATE FUNCTION: api() always sets Content-Type: application/json. A
// file upload must be multipart/form-data WITH a boundary string that only the
// browser can generate, so here we deliberately DO NOT set Content-Type and let
// fetch fill it in. Multer on the backend (services/photos.js) parses that body.
export async function upload(path, file, { token, field = "photo" } = {}) { // field must match uploadPhoto.single("photo") in auth.routes.js.
  const form = new FormData();                              // FormData is the browser's multipart body builder.
  form.append(field, file);                                 // Attach the File object under the field name the backend expects.

  const res = await fetch(`${BASE_URL}${path}`, {           // Same origin logic as api(), different body type.
    method: "POST",                                         // Uploads are always POST (POST /auth/me/photo).
    headers: {                                              // Headers:
      ...(token ? { Authorization: `Bearer ${token}` } : {}), // Only the auth header — NO Content-Type (see comment above).
    },                                                      // End headers.
    body: form,                                             // The multipart payload.
  });                                                       // End fetch options.

  if (!res.ok) {                                            // 400 (too big / wrong type), 401 (expired token), 500...
    const err = await res.json().catch(() => ({}));         // Read the backend's JSON error if there is one.
    throw new Error(err.error || res.statusText);           // Surface it so Profile.jsx can display the reason.
  }                                                         // End error handling.

  return res.json();                                        // { profile_photo_url: "/uploads/<file>" } — fed straight into mediaUrl().
}                                                           // End upload.
