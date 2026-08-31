// src/middleware/admin.js
// PURPOSE: The gate in front of every /admin route. It verifies an admin token and
// refuses anything that isn't one.
// INTENDED OUTPUT LINK: the spec requires the admin system to be "fully isolated".
// This middleware is that isolation in code — a leaked or stolen USER token can
// never reach a dashboard, user-management, or moderation endpoint.

import jwt from "jsonwebtoken"; // Verifies the signed admin token issued by POST /admin/login.

// Which secret signs/verifies admin tokens.
//
// The Day 5 plan reuses JWT_SECRET for both audiences. That works because we
// never sign a USER token containing role:"admin" — but it means one leaked
// secret compromises both systems at once. Setting ADMIN_JWT_SECRET to a
// different random value gives real cryptographic separation: a user token then
// fails the admin signature check outright, before the role is even inspected.
// We fall back to JWT_SECRET so existing setups keep working unchanged.
export const ADMIN_SECRET = process.env.ADMIN_JWT_SECRET || process.env.JWT_SECRET; // Prefer the dedicated secret when present.

export function requireAdmin(req, res, next) {                 // Express middleware: (request, response, next).
  const header = req.headers.authorization || "";              // Read the Authorization header ("" if missing).
  const token = header.startsWith("Bearer ")                   // Expect the standard "Bearer <token>" format...
    ? header.slice(7)                                          // ...strip the 7-character prefix to get the token.
    : null;                                                    // Anything else counts as no token.

  if (!token) {                                                // Nothing supplied...
    return res.status(403).json({ error: "Admin access required" }); // ...refuse without revealing whether the route exists.
  }

  try {
    const payload = jwt.verify(token, ADMIN_SECRET);           // Verify signature + expiry against the ADMIN secret.
    if (payload.role !== "admin") {                            // Second check: the token must explicitly claim the admin role...
      throw new Error("not an admin");                         // ...so a user token signed with a shared secret is still rejected.
    }
    req.admin = payload;                                       // Attach the admin identity (sub = admins.id) for handlers/audit logs.
    next();                                                    // Allow the request through to the route handler.
  } catch {
    // One generic 403 for every failure (missing/expired/forged/wrong role) so an
    // attacker learns nothing about WHY their token was refused.
    res.status(403).json({ error: "Admin access required" });  // Deny.
  }
}                                                              // End requireAdmin.
