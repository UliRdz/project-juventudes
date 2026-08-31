// scripts/create-admin.js
// PURPOSE: Create (or update the password of) an administrator account from the
// command line.
// INTENDED OUTPUT LINK: there is deliberately NO admin signup endpoint — exposing
// one would let anyone grant themselves admin rights. That leaves a bootstrap
// problem: a fresh database has no admin, so nobody can log into the panel. This
// script is the intended way in, run by someone who already has server/database
// access.
//
// USAGE:
//   node scripts/create-admin.js admin@example.com "a-strong-password"
//
// Re-running it for an existing email RESETS that admin's password, which is also
// how you recover from a lost admin credential.

import bcrypt from "bcrypt";              // Hash the password before storing it (never store plaintext).
import dotenv from "dotenv";              // Load DATABASE_URL from .env when run locally.
import { pool } from "../src/config/db.js"; // Reuse the app's PostgreSQL pool.

dotenv.config();                          // Populate process.env before the pool connects.

const SALT_ROUNDS = 12;                   // Same cost factor as user passwords (see auth.routes.js).

const [email, password] = process.argv.slice(2); // Read the two CLI arguments (argv[0]=node, argv[1]=script path).

if (!email || !password) {                                                   // Missing arguments...
  console.error('Usage: node scripts/create-admin.js <email> "<password>"'); // ...print usage...
  process.exit(1);                                                           // ...and exit with a failure code.
}

if (password.length < 12) {                                                  // Admin credentials protect everything...
  console.error("Password must be at least 12 characters for an admin account."); // ...so demand a longer one than users get.
  process.exit(1);
}

const hash = await bcrypt.hash(password, SALT_ROUNDS); // Produce the bcrypt hash to store.

try {
  const { rows } = await pool.query(
    `INSERT INTO admins (email, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash -- Existing admin -> reset the password.
     RETURNING id, email`,                                                    // Return enough to confirm what happened.
    [email.toLowerCase(), hash]                                               // Lowercase to match the login lookup.
  );
  console.log(`Admin ready: ${rows[0].email} (id ${rows[0].id})`);            // Confirm success.
  console.log("Log in at the frontend URL with #admin appended.");            // Remind where the panel lives.
} catch (e) {
  console.error("Failed to create admin:", e.message);                        // Report the real reason (e.g. table missing).
  process.exitCode = 1;                                                       // Non-zero exit so scripts/CI notice.
} finally {
  await pool.end();                                                           // Close the pool so the process exits cleanly.
}
