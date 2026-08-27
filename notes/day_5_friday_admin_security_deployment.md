# Friday Workday Plan: Admin Panel, Security Hardening and Deployment

## Objective

Close the build: an **isolated admin panel** (separate login, its own dashboard and management tools), a **security hardening pass** across the API, and a **deployment pipeline** that ships the frontend to GitHub Pages and the backend to Render/Railway.

## Concepts to learn today

- Isolating an admin surface from the user auth system.
- Aggregation queries for a dashboard.
- Defense-in-depth: helmet, CORS lockdown, rate limiting, HSTS, audit logging.
- Deploying a **static SPA to GitHub Pages** and a **stateful API to a host**, and how they connect across origins.

## Deliverables covered

- `backend/src/routes/admin.routes.js` (auth + dashboard + management)
- `backend/src/middleware/admin.js` (admin JWT guard)
- `frontend/src/components/admin/ScholarshipForm.jsx` (manual per-country entry)
- Scholarship write routes moved from `requireAuth` to `requireAdmin`
- Security middleware applied in `app.js` (helmet, HSTS, CORS, limits)
- `.github/workflows/deploy-frontend.yml` (Pages deploy)
- Backend deploy config for Render/Railway
- Final launch checklist

## Workday outcome

By the end of Friday, an administrator logs into a route separate from users, sees live counts (users, active scholarships, countries, pending chats, last API update), can moderate content and manage users/map/scholarships, the API is hardened, and both frontend and backend are deployed and talking to each other over HTTPS.

## Step-by-step exercises

### 1. Admin authentication (isolated)

`backend/src/middleware/admin.js`:

```js
import jwt from "jsonwebtoken";

export function requireAdmin(req, res, next) {
  const token = (req.headers.authorization || "").replace("Bearer ", "");
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin") throw new Error();
    req.admin = payload;
    next();
  } catch {
    res.status(403).json({ error: "Admin access required" });
  }
}
```

`backend/src/routes/admin.routes.js` — admin login issues a token with `role: "admin"`:

```js
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import { pool } from "../config/db.js";
import { requireAdmin } from "../middleware/admin.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { email, password, totp } = req.body;
  const { rows } = await pool.query("SELECT * FROM admins WHERE email = $1", [email]);
  const admin = rows[0];
  if (!admin || !(await bcrypt.compare(password, admin.password_hash))) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  if (admin.totp_secret) {
    const ok = speakeasy.totp.verify({ secret: admin.totp_secret, encoding: "base32", token: totp, window: 1 });
    if (!ok) return res.status(401).json({ error: "Invalid 2FA code" });
  }
  const token = jwt.sign({ sub: admin.id, role: "admin" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  res.json({ token });
});

export default router;
```

### 2. Dashboard aggregates

Add to `admin.routes.js`:

```js
router.get("/dashboard", requireAdmin, async (_req, res) => {
  const q = (sql) => pool.query(sql).then((r) => r.rows[0].count);
  const [users, scholarships, countries, pending, lastUpdate] = await Promise.all([
    q("SELECT COUNT(*) FROM users WHERE is_active = TRUE"),
    q("SELECT COUNT(*) FROM scholarships WHERE status = 'active'"),
    q("SELECT COUNT(DISTINCT current_country) FROM users WHERE current_country IS NOT NULL"),
    q("SELECT COUNT(*) FROM chats WHERE read_at IS NULL"),
    pool.query("SELECT MAX(updated_at) AS last FROM scholarships").then((r) => r.rows[0].last),
  ]);
  res.json({ users, scholarships, countries, pending_chats: pending, last_api_update: lastUpdate });
});
```

### 3. User management tools

```js
// Ban / deactivate
router.patch("/users/:id/deactivate", requireAdmin, async (req, res) => {
  await pool.query("UPDATE users SET is_active = FALSE WHERE id = $1", [req.params.id]);
  await audit(req, "user_deactivate", req.params.id);
  res.json({ ok: true });
});

// Reset 2FA
router.patch("/users/:id/reset-2fa", requireAdmin, async (req, res) => {
  await pool.query("UPDATE users SET totp_enabled = FALSE, totp_secret = NULL WHERE id = $1", [req.params.id]);
  await audit(req, "user_reset_2fa", req.params.id);
  res.json({ ok: true });
});

// Export CSV
router.get("/users/export", requireAdmin, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT email, first_name, last_name, current_country, institution_company, created_at FROM users"
  );
  const header = "email,first_name,last_name,current_country,institution,created_at\n";
  const body = rows.map((u) =>
    [u.email, u.first_name, u.last_name, u.current_country, u.institution_company, u.created_at].join(",")
  ).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=users.csv");
  res.send(header + body);
});

async function audit(req, action, target) {
  await pool.query(
    "INSERT INTO audit_logs (actor, action, ip, detail) VALUES ($1,$2,$3,$4)",
    [req.admin?.sub, action, req.ip, JSON.stringify({ target })]
  );
}
```

### 4. Manual scholarship entry per country (CMS form)

The write endpoints from Day 4 exist but are placeholder-guarded with `requireAuth`. Move them behind `requireAdmin` and give admins a form to type in scholarships the API doesn't cover — internal programs, or country-specific entries with missing fields — that survive the 24h refresh and can be removed later.

**Backend change** — swap the guard on the scholarship write routes (from Day 4):

```js
// scholarships.routes.js — writes are admin-only in production.
import { requireAdmin } from "../middleware/admin.js";

router.post("/",    requireAdmin, /* ...create with source='manual', created_by... */);
router.put("/:id",  requireAdmin, /* ...edit... */);
router.delete("/:id", requireAdmin, /* ...remove internal scholarship... */);
```

Reads (`GET /scholarships`) stay on `requireAuth` so any logged-in user still sees them in the map popup — no change needed there, and manual entries appear automatically.

**Frontend** — `frontend/src/components/admin/ScholarshipForm.jsx`. The country field is a dropdown fed by the **same controlled country list the map uses**, so a manual entry can never drift from the GeoJSON names (the normalization gotcha from Day 3):

```jsx
import { useState } from "react";
import { api } from "../../api/client";
import { COUNTRIES } from "../../data/countries"; // single source of truth

export default function ScholarshipForm({ onSaved }) {
  const [f, setF] = useState({ category: "university", country: "", status: "active" });
  const [error, setError] = useState("");
  const token = localStorage.getItem("admin_token");
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function save() {
    try {
      const saved = await api("/scholarships", {
        method: "POST", token,
        body: { ...f, areas: (f.areas || "").split(",").map((s) => s.trim()).filter(Boolean) },
      });
      onSaved?.(saved);
      setF({ category: "university", country: "", status: "active" });
    } catch (e) { setError(e.message); }
  }

  return (
    <div className="card">
      <h3>Agregar beca (entrada manual)</h3>
      <input placeholder="Institución" onChange={set("institution_name")} />
      <select value={f.country} onChange={set("country")}>
        <option value="" disabled>País…</option>
        {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={f.category} onChange={set("category")}>
        <option value="high_school">Preparatoria</option>
        <option value="university">Universidad</option>
      </select>
      <input placeholder="Áreas (separadas por coma)" onChange={set("areas")} />
      <input type="date" onChange={set("start_date")} />
      <input type="date" onChange={set("end_date")} />
      <input placeholder="Enlace (opcional)" onChange={set("link")} />
      <textarea placeholder="Descripción" onChange={set("description")} />
      <button className="btn btn-primary" onClick={save}>Guardar beca</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
```

Because every manual entry is stamped `source='manual'`, the admin scholarship list can show a "Manual" badge and a delete button so internal scholarships are easy to spot and remove when they end. Filtering the admin table by `source` lets an admin manage only the hand-curated set.

### 5. Chat moderation, map and system settings

Add admin endpoints for the remaining panels:

- **Chat moderation**: `GET /admin/chats` (logs), `DELETE /admin/chats/:id` (remove abusive message), `PATCH /admin/users/:id/mute` (disable chat for a user).
- **Map management**: `POST /admin/map/geojson` (upload new world file to storage), a `countries_enabled` config table to toggle countries.
- **System settings**: a `settings` table holding `api_refresh_hours` (default 24), `upload_limit_mb` (5), `allowed_formats`, `logging_level`, `maintenance_mode`, and SMTP credentials. Guard a `POST /admin/smtp/test` endpoint that sends a test email.

Keep every mutating admin action writing to `audit_logs`.

### 6. Security hardening pass

```bash
cd backend
npm install helmet
```

Update `app.js` (order matters — security middleware first):

```js
import helmet from "helmet";
import rateLimit from "express-rate-limit";

app.use(helmet({
  hsts: { maxAge: 31536000, includeSubDomains: true }, // force HTTPS
}));

// Lock CORS to the deployed frontend origin only.
app.use(cors({ origin: process.env.FRONTEND_ORIGIN.split(","), credentials: true }));

// Global login limiter (brute-force protection).
app.use("/auth/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 10 }));
app.use("/admin/login", rateLimit({ windowMs: 15 * 60 * 1000, max: 5 }));
```

Security review to run before deploy:

- Passwords hashed (bcrypt, ≥12 rounds); no plaintext anywhere.
- JWT secret is long, random, and set only via environment variable.
- TOTP secrets encrypted at rest.
- File upload capped at 5MB, JPG/PNG only.
- Rate limits on `/auth/login`, `/admin/login`, and `/chat`.
- Admin routes require `role: "admin"` — never reachable with a user token.
- HTTPS/TLS enforced end to end; HSTS header present.
- Audit log captures logins and every admin mutation.

### 7. Deploy the frontend to GitHub Pages

Build with the correct base path (set on Day 1) and deploy via GitHub Actions. Create `.github/workflows/deploy-frontend.yml`:

```yaml
name: Deploy frontend to Pages
on:
  push:
    branches: [main]
    paths: ["frontend/**"]
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  build-deploy:
    runs-on: ubuntu-latest
    environment: github-pages
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - name: Build
        working-directory: frontend
        env:
          VITE_API_URL: ${{ secrets.VITE_API_URL }}   # your deployed backend URL
        run: |
          npm ci
          npm run build
      - uses: actions/upload-pages-artifact@v3
        with: { path: frontend/dist }
      - uses: actions/deploy-pages@v4
```

Then enable Pages in the repo settings (Source: GitHub Actions). Add `VITE_API_URL` as a repository secret pointing to the deployed backend.

### 8. Deploy the backend to Render/Railway

- Create a new **Web Service** from the repo, root directory `backend`.
- Build command: `npm ci`; start command: `npm start`.
- Provision a **PostgreSQL** instance and set `DATABASE_URL` + `DATABASE_SSL=true`.
- Set all environment variables from `.env.example` (JWT secret, SMTP, `SCHOLARSHIP_API_URL`).
- Set `FRONTEND_ORIGIN` to your GitHub Pages URL (e.g. `https://<user>.github.io`) so CORS and Socket.io accept it.
- Apply the schema once: run `psql "$DATABASE_URL" -f src/db/schema.sql` against the managed database.

> The 24h scheduler runs inside the always-on backend process via `node-cron`. If your host sleeps idle instances, move the schedule to a **GitHub Actions cron** that calls a protected refresh endpoint instead.

### 9. End-to-end smoke test in production

Register a user, log in, open the map, click a country, send a chat message (confirm the email arrives), create a scholarship as admin, and confirm the dashboard counts update.

## Validation checklist

- [ ] Admin login is separate from user login and requires `role: "admin"`.
- [ ] The dashboard returns live counts and last API update time.
- [ ] Admin can add a scholarship manually per country; it is stamped `source='manual'` and appears in the map popup.
- [ ] Scholarship write routes reject a normal user token (admin-only).
- [ ] Admin can deactivate a user, reset their 2FA, and export CSV.
- [ ] Abusive messages can be deleted and a user's chat can be disabled.
- [ ] helmet, HSTS, locked CORS, and login rate limits are active.
- [ ] Frontend builds and deploys to GitHub Pages at the correct base path.
- [ ] Backend is live on Render/Railway with PostgreSQL and all env vars set.
- [ ] Production smoke test passes: register → map → chat + email → admin CRUD.

## Security and reproducibility notes

- The admin system must be **fully isolated** (its own credentials, its own token role); a leaked user token must never reach admin routes.
- Ship production CORS locked to your exact Pages origin — never `origin: "*"`.
- Store every secret (JWT, SMTP, DB URL) in the host's environment/secret manager, never in the repo.
- Keep `schema.sql` and the GitHub Actions workflow in version control so the whole deployment is reproducible from a clean clone.
- Turn on `maintenance_mode` during migrations so users see a controlled page rather than errors.
