// src/app.js
// PURPOSE: Build and configure the Express application: JSON parsing, CORS, a
// health-check route, and the mount points where each day's routes will attach.
// INTENDED OUTPUT LINK: this is the "spine" of the API. Every feature (auth on
// Day 2, users/scholarships on Day 3-4, chat on Day 4, admin on Day 5) plugs in
// here, and CORS configured here is what lets the GitHub Pages frontend call it.

import express from "express"; // Web framework: turns HTTP requests into route handlers and responses.
import cors from "cors";       // Middleware that adds the CORS headers a browser needs to allow cross-origin calls.
import dotenv from "dotenv";   // Loads variables from a local .env file into process.env for local development.

dotenv.config(); // Read .env NOW, before anything below uses process.env (e.g. FRONTEND_ORIGIN).

const app = express(); // Create the Express application instance we will configure and export.

app.use(express.json({ limit: "1mb" })); // Parse incoming JSON bodies into req.body; cap at 1MB so oversized payloads are rejected early.

app.use(                                         // Register CORS as global middleware (runs on every request).
  cors({                                         // Configure which origins may call this API from a browser.
    origin: process.env.FRONTEND_ORIGIN?.split(",") || "*", // Allow the frontend origin(s) from .env (comma-separated); fall back to "*" only in dev.
  })                                             // NOTE: replace "*" with your exact GitHub Pages origin before production (see security notes).
); // End CORS setup: without this, the browser would block the Pages frontend from reading API responses.

app.get("/health", (_req, res) => {          // Define a lightweight health-check endpoint (no auth, no DB).
  res.json({ status: "ok" });                // Respond with a small JSON object so uptime checks / smoke tests can verify the API is alive.
}); // INTENDED OUTPUT LINK: this is the first thing you curl to confirm the backend runs (Day 1 validation checklist).

// ---- Route mount points (each is implemented on the day noted) -------------
// Kept as comments so the app boots cleanly today with only /health active.
// app.use("/auth", authRoutes);                 // Day 2: register, login, TOTP 2FA.
// app.use("/users", usersRoutes);               // Day 3: list users by country for the map's right panel.
// app.use("/scholarships", scholarshipRoutes);  // Day 4: read + admin CRUD for the map's left panel.
// app.use("/chat", chatRoutes);                 // Day 4: chat history + send (also triggers email).
// app.use("/admin", adminRoutes);               // Day 5: isolated admin dashboard and management.

export default app; // Export the configured app so server.js can start it (keeps startup separate from configuration).
