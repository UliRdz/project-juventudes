// src/config/db.js
// PURPOSE: Create a single, shared PostgreSQL connection pool that every route
// and service imports to run SQL queries.
// INTENDED OUTPUT LINK: users, scholarships, chats, and audit logs all live in
// PostgreSQL. This pool is the one door through which all that data is read and
// written, so every feature that shows or stores data depends on it.

import pg from "pg";           // The node-postgres driver: lets Node talk to a PostgreSQL database.
import dotenv from "dotenv";   // Loads DATABASE_URL and related settings from .env during local development.

dotenv.config(); // Populate process.env before we read DATABASE_URL below.

export const pool = new pg.Pool({                     // A Pool reuses a set of connections instead of opening one per query (faster, safer under load).
  connectionString: process.env.DATABASE_URL,         // Full connection string (host, port, user, password, db name) supplied via environment.
  ssl:                                                 // Configure TLS for the DB connection:
    process.env.DATABASE_SSL === "true"                // Managed hosts (Render/Railway) require SSL, so we enable it when DATABASE_SSL=true...
      ? { rejectUnauthorized: false }                  // ...accepting the provider's certificate (fine for these managed services).
      : false,                                          // Locally, SSL is off so `psql`/local Postgres connect without certificates.
}); // INTENDED OUTPUT LINK: import { pool } anywhere to query the DB, e.g. pool.query("SELECT ...").
