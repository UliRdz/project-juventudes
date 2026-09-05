// src/app.js
// PURPOSE: Build and configure the Express application: security headers, CORS,
// body parsing, rate limits, and the route mounts for every feature.
// INTENDED OUTPUT LINK: this is the "spine" of the API and, after Day 5, its main
// security boundary. The middleware ORDER below matters — protections must run
// before the handlers they protect.

import express from "express";  // Web framework: turns HTTP requests into route handlers and responses.
import cors from "cors";        // Adds the CORS headers a browser needs to allow cross-origin calls.
import helmet from "helmet";    // Day 5: sets a bundle of protective HTTP response headers.
import dotenv from "dotenv";    // Loads variables from a local .env file into process.env.
import { pool } from "./config/db.js"; // Used by the maintenance-mode check below.
import { loginLimiter } from "./middleware/rateLimit.js"; // Brute-force protection for the login endpoints.
import authRoutes from "./routes/auth.routes.js";                 // Day 2: register, login, TOTP, photo.
import usersRoutes from "./routes/users.routes.js";               // Day 3: users-by-country + profile update.
import scholarshipRoutes from "./routes/scholarships.routes.js";  // Day 3/4: read by country + admin CRUD.
import chatRoutes from "./routes/chat.routes.js";                 // Day 4: chat history + send.
import adminRoutes from "./routes/admin.routes.js";               // Day 5: isolated admin panel.
import photoRoutes from "./routes/photos.routes.js";              // CHANGE (this patch): serves avatars from the DB (replaces the /uploads static mount).
import ticketRoutes from "./routes/tickets.routes.js";            // CHANGE (this patch): the "Ayuda" support-ticket endpoints.

dotenv.config(); // Read .env NOW, before anything below uses process.env.

const app = express(); // Create the Express application instance we configure and export.

// Trust the first proxy hop. Hosts like Render/Railway put a load balancer in
// front of the app, so without this every request appears to come from the
// proxy's IP - which would make the rate limiters lump ALL users into one shared
// bucket and lock everyone out together.
app.set("trust proxy", 1); // 1 = trust exactly one proxy hop (the platform's load balancer).

// ---------------------------------------------------------------------------
// 1) SECURITY HEADERS (first, so they apply to every response including errors)
// ---------------------------------------------------------------------------
app.use(
  helmet({
    // HSTS tells browsers to only ever contact this host over HTTPS, which blocks
    // downgrade attacks. maxAge is in seconds; 31536000 = one year.
    hsts: { maxAge: 31536000, includeSubDomains: true },
    // The API returns JSON, not HTML, and the frontend is served from a DIFFERENT
    // origin (GitHub Pages). A restrictive CSP here would have no page to protect,
    // so we disable it rather than ship a misleading policy.
    contentSecurityPolicy: false,
    // Allow the uploaded profile photos served from /uploads to be embedded by the
    // frontend on its own origin. Without this, helmet's default CORP header makes
    // the browser refuse to render avatars cross-origin.
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

// ---------------------------------------------------------------------------
// 2) CORS - locked to the configured frontend origin(s)
// ---------------------------------------------------------------------------
// Parse the allow-list defensively. The naive `process.env.FRONTEND_ORIGIN.split(",")`
// throws "Cannot read properties of undefined" and CRASHES THE SERVER ON BOOT when
// the variable is missing - an easy way to break a deploy. This guards against that
// and fails safe.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "") // Default to "" instead of undefined.
  .split(",")                                              // Support several comma-separated origins.
  .map((o) => o.trim())                                    // Trim stray whitespace around each entry.
  .filter(Boolean);                                        // Drop empty strings.

if (allowedOrigins.length === 0) {                                    // Nothing configured...
  console.warn("FRONTEND_ORIGIN is not set - allowing all origins (DEVELOPMENT ONLY)"); // ...warn loudly...
}                                                                     // ...so this is never silently shipped to production.

app.use(
  cors({
    // With an explicit list, only those origins may read responses. With none, we
    // fall back to "*" for local development - never for production (see warning).
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*",
    credentials: true, // Permit credentialed requests from the allowed origin(s).
  })
);

// ---------------------------------------------------------------------------
// 3) BODY PARSING
// ---------------------------------------------------------------------------
app.use(express.json({ limit: "1mb" })); // Parse JSON bodies into req.body; 1MB cap rejects oversized payloads early.

// ---------------------------------------------------------------------------
// 4) RATE LIMITS on the authentication endpoints
// ---------------------------------------------------------------------------
// Mounted BEFORE the routers so the limiter runs first. /admin/login gets the same
// limiter; admin credentials are the highest-value target on the system.
app.use("/auth/login", loginLimiter);   // 10 attempts / 15 min.
app.use("/admin/login", loginLimiter);  // Same protection for the admin door.

// ---------------------------------------------------------------------------
// 5) MAINTENANCE MODE
// ---------------------------------------------------------------------------
// When the 'maintenance_mode' setting is 'true', normal API traffic gets a clean
// 503 instead of half-broken behaviour during a migration. /admin and /health stay
// reachable so an administrator can still log in and switch it back off.
app.use(async (req, res, next) => {
  if (req.path.startsWith("/admin") || req.path === "/health") return next(); // Always-open paths.
  try {
    const { rows } = await pool.query("SELECT value FROM settings WHERE key = 'maintenance_mode'"); // Read the flag.
    if (rows[0]?.value === "true") {                                   // Maintenance is ON...
      return res.status(503).json({ error: "En mantenimiento. Vuelve pronto." }); // ...tell users in Spanish.
    }
  } catch {
    // If the settings table doesn't exist yet (migration not run), fail OPEN so a
    // missing table can never take the whole API down.
  }
  next(); // Not in maintenance -> continue to the routes.
});

// ---------------------------------------------------------------------------
// 6) STATIC FILES
// ---------------------------------------------------------------------------
app.get("/health", (_req, res) => {          // Lightweight health check (no auth, no DB).
  res.json({ status: "ok" });                // Used by uptime monitors and the frontend's connectivity indicator.
});

// CHANGE (this patch): the /uploads static mount is GONE. Profile photos are now
// stored in Postgres and served by GET /photos/:userId (see routes/photos.routes.js).
// Render's filesystem is ephemeral — it is wiped on every redeploy and cold start —
// so anything written to backend/uploads/ disappeared while the database kept
// pointing at it. That mismatch was the "photo shows in Mi Perfil but nowhere else"
// bug. Nothing writes to disk any more, so there is nothing to serve statically.

// ---------------------------------------------------------------------------
// 7) ROUTES
// ---------------------------------------------------------------------------
app.use("/auth", authRoutes);                    // Register, login, TOTP 2FA, photo upload.
app.use("/users", usersRoutes);                  // Users by country (map right panel) + PATCH /me profile.
app.use("/scholarships", scholarshipRoutes);     // Read by country (left panel) + admin-only CRUD.
app.use("/chat", chatRoutes);                    // Conversation history, unread count, send.
app.use("/admin", adminRoutes);                  // Day 5 ACTIVE: isolated admin dashboard and management.
app.use("/photos", photoRoutes);                 // NEW: GET /photos/:userId streams the avatar out of the database.
app.use("/tickets", ticketRoutes);               // NEW: student-facing support tickets behind the "Ayuda" button.

// ---------------------------------------------------------------------------
// 8) FALLBACKS
// ---------------------------------------------------------------------------
app.use((req, res) => {                                    // Any path that matched no route above.
  res.status(404).json({ error: "Not found" });            // Return JSON (not Express's default HTML page).
});

app.use((err, _req, res, _next) => {                       // Central error handler (4 args marks it as such).
  console.error("Unhandled error:", err.message);          // Log the real error server-side for debugging...
  res.status(500).json({ error: "Internal server error" });// ...but never leak stack traces to the client.
});

export default app; // Export the configured app so server.js can start it.
