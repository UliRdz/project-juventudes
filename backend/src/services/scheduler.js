// src/services/scheduler.js
// PURPOSE: Background job that runs every 24 hours to (1) refresh scholarships
// from the external source and (2) mark past-deadline scholarships inactive.
// INTENDED OUTPUT LINK: the spec requires daily scholarship updates without manual
// work. This keeps the map's left panel current and automatically hides expired
// programs, while NEVER overwriting scholarships an admin typed in by hand.

import cron from "node-cron";           // Scheduler that runs a function on a cron expression.
import { pool } from "../config/db.js"; // Shared PostgreSQL pool for the upsert/expire queries.

// ---------------------------------------------------------------------------
// Pull the latest scholarships from the configured source and upsert them.
// ---------------------------------------------------------------------------
export async function refreshFromSource() {                 // Exported so it can be triggered manually and unit-tested.
  if (!process.env.SCHOLARSHIP_API_URL) {                   // No source configured (normal in local dev)...
    console.warn("SCHOLARSHIP_API_URL not set - skipping refresh"); // ...log it so the skip is visible...
    return { inserted: 0, skipped: true };                  // ...and exit cleanly instead of crashing the job.
  }

  const res = await fetch(process.env.SCHOLARSHIP_API_URL); // Node 18+ has a built-in global fetch (see package.json engines).
  if (!res.ok) throw new Error(`Source responded ${res.status}`); // Non-200 -> abort so we don't parse an error page as data.
  const items = await res.json();                           // Expected: an array of scholarship objects (shape per API.md).

  if (!Array.isArray(items)) throw new Error("Source did not return an array"); // Defensive: bad payload shouldn't corrupt the DB.

  let count = 0;                                            // Tally of rows processed, returned for logging.
  for (const it of items) {                                 // Handle each incoming scholarship.
    await pool.query(
      // Insert as source='api'. The ON CONFLICT target repeats the partial index
      // predicate (WHERE source='api'), so a conflict can ONLY match another API
      // row. A manual entry with the same institution/country/category is invisible
      // to this statement and is therefore never overwritten or deleted.
      `INSERT INTO scholarships
         (institution_name, country, category, areas, start_date, end_date,
          link, description, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','api')
       ON CONFLICT (institution_name, country, category) WHERE source = 'api'
       DO UPDATE SET areas       = EXCLUDED.areas,        -- Refresh the study areas...
                     start_date  = EXCLUDED.start_date,   -- ...the application window...
                     end_date    = EXCLUDED.end_date,
                     link        = EXCLUDED.link,         -- ...the apply link...
                     description = EXCLUDED.description,  -- ...and the description...
                     status      = 'active',              -- ...and re-activate it if it was previously expired.
                     updated_at  = now()`,                // Timestamp feeds the "Last API update" dashboard widget.
      [it.institution_name, it.country, it.category, it.areas,
       it.start_date, it.end_date, it.link, it.description]  // Values in placeholder order.
    );
    count++;                                                 // Count this row as processed.
  }
  return { inserted: count, skipped: false };                // Report back for logging/monitoring.
}

// ---------------------------------------------------------------------------
// Hide scholarships whose application window has closed.
// ---------------------------------------------------------------------------
export async function expirePast() {                        // Exported so it can be run/tested on its own.
  const { rowCount } = await pool.query(                    // rowCount tells us how many were expired this run.
    `UPDATE scholarships
     SET status = 'inactive', updated_at = now()            -- Flip to inactive so the read endpoint stops returning it.
     WHERE end_date < CURRENT_DATE                          -- Deadline has passed...
       AND status = 'active'`,                              // ...and it isn't already inactive (keeps the job idempotent).
  );
  return { expired: rowCount };                             // Number of rows just expired.
}

// ---------------------------------------------------------------------------
// Register the daily job.
// ---------------------------------------------------------------------------
export function startScheduler() {                          // Called from server.js once the server is listening.
  // Cron expression "0 3 * * *" = minute 0, hour 3, every day/month/weekday,
  // i.e. 03:00 server time — a low-traffic hour.
  cron.schedule("0 3 * * *", async () => {                  // Register the recurring task.
    console.log("Scheduler: starting daily scholarship refresh"); // Mark the run start in the logs.
    try {
      const r = await refreshFromSource();                  // Step 1: pull and upsert the latest data.
      const e = await expirePast();                         // Step 2: expire anything past its end_date.
      console.log(`Scheduler: refreshed ${r.inserted}, expired ${e.expired}`); // Summary for monitoring.
    } catch (err) {                                         // Never let a failure kill the process...
      console.error("Scheduler error:", err.message);       // ...just log it; tomorrow's run will try again.
    }
  });
  console.log("Scheduler registered: daily at 03:00");      // Confirm at boot that the job is scheduled.
}

// NOTE (deployment): node-cron only fires while this process is alive. On hosts
// that sleep idle instances, move the schedule to an external trigger (GitHub
// Actions cron calling a protected refresh endpoint) as noted in the Day 5 plan.
