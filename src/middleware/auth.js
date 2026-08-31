// src/middleware/auth.js
// PURPOSE: A reusable "gatekeeper" that any route can put in front of itself to
// require a valid login token (JWT). It reads the Authorization header, verifies
// the token's signature, and either lets the request through or rejects it.
// INTENDED OUTPUT LINK: this is what makes "protected" endpoints protected — the
// TOTP setup, photo upload, and every later feature that needs to know WHO is
// calling relies on this middleware to attach the verified user to req.user.

import jwt from "jsonwebtoken"; // Library to verify the signed login token created at /auth/login.

export function requireAuth(req, res, next) {                 // Express middleware: (request, response, next-in-chain).
  const header = req.headers.authorization || "";             // Read the "Authorization" header; default to "" if it's absent.
  const token = header.startsWith("Bearer ")                  // The standard format is "Bearer <token>"...
    ? header.slice(7)                                         // ...so strip the 7-char "Bearer " prefix to get the raw token.
    : null;                                                   // If it isn't a Bearer header, treat the token as missing.

  if (!token) {                                               // No token supplied...
    return res.status(401).json({ error: "Missing token" });  // ...reject with 401 Unauthorized and stop (don't call next()).
  }

  try {                                                       // Verifying can throw (expired/tampered token), so wrap it.
    req.user = jwt.verify(token, process.env.JWT_SECRET);     // Verify signature+expiry using the secret; on success attach the payload (sub, email) to req.user.
    next();                                                   // Token is valid -> hand control to the actual route handler.
  } catch {                                                   // Any failure (bad signature, expired, malformed)...
    res.status(401).json({ error: "Invalid or expired token" }); // ...respond 401 so the frontend knows to send the user back to login.
  }
}                                                             // End requireAuth: used as router.post("/path", requireAuth, handler).
