// src/api/client.js
// PURPOSE: A single, reusable wrapper around fetch() so every part of the app
// talks to the backend the same way (same base URL, same headers, same error
// handling) instead of repeating fetch boilerplate everywhere.
// INTENDED OUTPUT LINK: every screen that loads or sends data — login, the map's
// scholarships/users, chat, admin — will call this api() function. Centralizing
// it here means the backend URL and auth header are defined in exactly one place.

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000"; // Read the backend URL from Vite env (set per environment); default to local dev.

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

  return res.json();                                        // On success, parse and return the JSON payload to the caller.
}                                                           // End api(): callers use `await api("/path", { ... })`.
