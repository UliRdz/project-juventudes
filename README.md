# Scholarship Social Network

Spanish-first platform for scholarship students to create verified profiles,
discover scholarships by country on an interactive map, and connect via chat.

## Architecture

- **Frontend:** React (Vite), deployed to GitHub Pages.
- **Backend:** Node.js + Express REST API, deployed to Render/Railway.
- **Database:** PostgreSQL.
- **Auth:** JWT + bcrypt + optional TOTP 2FA (added Day 2).

## Repository structure

- `frontend/` — the static single-page app served by GitHub Pages.
- `backend/` — the Express API and PostgreSQL schema, hosted externally.
- `.env.example` — template of all required environment variables.

## Prerequisites

- **Node.js 18+** (the backend uses the built-in global `fetch`, added in Node 18).
- **PostgreSQL** running locally (or a managed instance for production).

> Note on "requirements / venv": this project's backend is **Node.js**, not
> Python, so there is no `venv` or `requirements.txt`. The equivalent is
> `package.json` + `npm install` (run once in `frontend/` and once in
> `backend/`). If you later switch the backend to Python (Flask), *that* is when
> a `requirements.txt` would appear.

## Local development

1. Copy `.env.example` to `.env` and fill in the values.
2. **Backend:** `cd backend && npm install && npm run dev`
3. **Frontend:** `cd frontend && npm install && npm run dev`
4. **Apply the schema:**
   ```bash
   createdb juventudes_dev
   psql juventudes_dev -f backend/src/db/schema.sql
   # optional demo data:
   psql juventudes_dev -f backend/src/db/seed.sql
   ```
5. Open the frontend (default `http://localhost:5173`). The page should show
   **"Backend health: ok"**, proving the frontend reached the API.

## Dependency reference

Because `package.json` is JSON and cannot contain inline comments, each
dependency is documented here.

### Backend (`backend/package.json`)

| Package | Why it's here |
| --- | --- |
| `express` | HTTP server and routing — the API framework. |
| `cors` | Sends the CORS headers that let the GitHub Pages frontend call the API. |
| `dotenv` | Loads `.env` values into `process.env` during local development. |
| `pg` | PostgreSQL driver used by `src/config/db.js`. |
| `bcrypt` (Day 2) | One-way password hashing. |
| `jsonwebtoken` (Day 2) | Signs/verifies the login JWT. |
| `speakeasy` (Day 2) | TOTP secret + 6-digit code (RFC 6238) for 2FA. |
| `qrcode` (Day 2) | Renders the TOTP secret as a scannable QR. |
| `multer` (Day 2) | Parses multipart profile-photo uploads. |
| `socket.io` (Day 4) | Real-time WebSocket delivery of chat messages. |
| `nodemailer` (Day 4) | Sends the mandatory chat notification email over SMTP. |
| `node-cron` (Day 4) | Schedules the daily 03:00 scholarship refresh. |
| `express-rate-limit` (Day 4) | Caps chat sends (20/min) and login attempts. |
| `helmet` (Day 5) | Protective HTTP headers (HSTS, nosniff, frameguard). |
| `nodemon` (dev) | Auto-restarts the server on file changes while developing. |
| `smtp-server` (dev) | Local SMTP catcher for `scripts/dev-smtp.js`. |

## Auth API (Day 2)

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `POST /auth/register` | none | Create a user (email + 8+ char password). |
| `POST /auth/login` | none | Verify credentials; returns a JWT, or `206 {mfa_required}` if 2FA is on. |
| `POST /auth/totp/setup` | Bearer | Get a QR + secret to enable 2FA. |
| `POST /auth/totp/verify` | Bearer | Confirm a code and switch 2FA on. |
| `POST /auth/me/photo` | Bearer | Upload a JPG/PNG avatar (max 5MB). |

Send the token as `Authorization: Bearer <token>` on protected routes.

## Map & discovery API (Day 3)

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `GET /scholarships?country=` | Bearer | Active scholarships, optionally filtered by country (left panel). |
| `GET /users?country=&limit=&offset=` | Bearer | Other active users in a country (right panel). `limit` caps at 100. |
| `PATCH /users/me` | Bearer | Update your own profile — **including `current_country`**. |

### Country names must match exactly

`users.current_country` and `scholarships.country` are matched with `=` against the
name a map click produces (`properties.name` in `public/geo/world.geojson`). A
mismatch returns an empty panel **with no error**, which is very hard to debug.

To prevent that, `frontend/src/data/countries.js` is **generated from the GeoJSON**
and drives the profile country dropdown. Regenerate it whenever the map data
changes:

```bash
cd frontend && node scripts/generate-countries.js
```

Note the file uses `"United States of America"`, not `"United States"`.

> **Registration does not collect a country.** A new user is invisible on the map
> until they set one via `PATCH /users/me` (the "Mi perfil" panel in the UI).

## Chat & CMS API (Day 4)

| Method + path | Auth | Purpose |
| --- | --- | --- |
| `GET /chat/unread` | Bearer | Count of unread messages for the caller. |
| `GET /chat/:otherId` | Bearer | Full conversation with one person (marks it read). |
| `POST /chat` | Bearer | Send a message: stores it, pushes it live, emails the recipient. Max 20/min. |
| `POST /scholarships` | Bearer* | Create a **manual** entry (`source='manual'`). |
| `PUT /scholarships/:id` | Bearer* | Edit an entry. |
| `DELETE /scholarships/:id` | Bearer* | Remove an entry. |

\* Guarded with `requireAuth` as a placeholder; Day 5 switches these to `requireAdmin`.

### Real-time chat

Messages are sent over **REST** (`POST /chat`) and pushed to the recipient over
**Socket.io** by the *server*, after the row is stored. The client never emits chat
events — that keeps the sender un-spoofable (it comes from the verified JWT) and
guarantees anything broadcast is already in the database. The widget falls back to
polling every 5 seconds when the socket can't connect.

The WebSocket handshake is authenticated with the same JWT; connections without a
valid token are rejected.

### Testing chat emails locally

Never send real mail from a dev machine. A local catcher is included:

```bash
cd backend
node scripts/dev-smtp.js          # terminal 1 — prints any email it receives
```

Then set in `.env`: `SMTP_HOST=127.0.0.1`, `SMTP_PORT=2525` (leave `SMTP_USER`
blank) and send a chat message. Mailtrap or MailHog work the same way. If
`SMTP_HOST` is unset, the app logs a warning and skips the email rather than
failing the message send.

### Scholarship refresh job

`node-cron` runs daily at **03:00 server time**: it upserts from
`SCHOLARSHIP_API_URL` and flips past-`end_date` rows to `inactive`. The upsert
targets the partial index `uq_scholarship_api`, so **manual entries are never
overwritten** even when they share an institution/country/category with an API row.
The job only runs while the process is alive — on hosts that sleep idle instances,
trigger it externally (GitHub Actions cron) instead.

> **Demo accounts** (after running `seed.sql`): `admin@example.com` and
> `demo@example.com`, both with password `demo1234`. Change these before production.

### Frontend (`frontend/package.json`)

| Package | Why it's here |
| --- | --- |
| `react`, `react-dom` | The UI library and its browser renderer. |
| `leaflet` | Map rendering engine (used by the Day 3 map). |
| `react-leaflet` | React bindings for Leaflet (v4.x pairs with React 18). |
| `socket.io-client` (Day 4) | Receives live chat messages; must match socket.io's major version. |
| `vite` (dev) | Dev server and static build tool. |
| `@vitejs/plugin-react` (dev) | Enables JSX and hot-reload in Vite. |

## Scripts

- Backend: `npm run dev` (auto-reload) / `npm start` (production run).
- Frontend: `npm run dev` (local) / `npm run build` (static output in `dist/`) /
  `npm run preview` (serve the built bundle locally).

## Security notes

- Never commit `.env`, credentials, or the real `JWT_SECRET`.
- `vite.config.js` `base` **must** equal the GitHub repo name, or the deployed
  SPA will 404 on its assets.
- Lock CORS to your GitHub Pages origin before production (do not ship `origin: "*"`).


## Admin panel (Day 5)

The admin system is **fully isolated** from the student app: its own `admins`
table, its own token role, its own secret, and its own localStorage key.

Open it at **`<site-url>/#admin`** (hash routing — GitHub Pages has no server-side
rewrites, so a `/admin` path would 404 on refresh).

### Creating the first admin

There is deliberately **no admin signup endpoint**. Bootstrap from the CLI:

```bash
cd backend
node scripts/create-admin.js admin@example.com "a-strong-password-12+"
```

Re-running it for an existing email resets that admin's password (lockout recovery).

### Admin API

| Method + path | Purpose |
| --- | --- |
| `POST /admin/login` | Isolated login; returns a `role:"admin"` token (1h). |
| `GET /admin/dashboard` | Users, active scholarships, countries, pending chats, last update. |
| `GET /admin/users?q=` | Search users. |
| `PATCH /admin/users/:id/deactivate` \| `/activate` | Ban / unban. |
| `PATCH /admin/users/:id/mute` | Block or restore a user's ability to send chat. |
| `PATCH /admin/users/:id/reset-2fa` | Clear a locked-out user's TOTP. |
| `GET /admin/users/export` | CSV download of the user list. |
| `GET /admin/chats` \| `DELETE /admin/chats/:id` | Moderation log and message removal. |
| `GET/PUT /admin/countries/:country` | Show or hide a country on the map. |
| `GET/PUT /admin/settings/:key` | System configuration. |
| `POST /admin/smtp/test` | Send a test email to verify SMTP. |
| `POST /admin/scholarships/refresh` | Run the scholarship refresh on demand. |
| `GET /admin/logs` | Audit trail of every admin action. |

Scholarship **writes** (`POST/PUT/DELETE /scholarships`) now require an admin
token; **reads** stay on the normal user token so students still see the map.

## Security posture

- Passwords: bcrypt, cost 12. TOTP 2FA optional for users, supported for admins.
- `helmet` sets HSTS (1 year), `nosniff`, frameguard, and `no-referrer`.
- CORS locked to `FRONTEND_ORIGIN`; a missing value logs a warning instead of crashing.
- Rate limits: login 10/15min, chat 20/min. `trust proxy` is set so limits key on the real client IP.
- Every admin mutation writes to `audit_logs` (actor, action, IP, details).
- CSV export escapes fields per RFC 4180 and neutralises spreadsheet formula injection.
- `maintenance_mode` returns 503 to users while leaving `/admin` and `/health` reachable.

**Still open before production:** encrypt `totp_secret` at rest (KMS/envelope
encryption) and move profile-photo storage off local disk to object storage —
ephemeral hosts wipe the `uploads/` folder on redeploy.

## Deployment

- **Frontend** → GitHub Pages via `.github/workflows/deploy-frontend.yml`.
  Set the `VITE_API_URL` repo secret and Pages Source to "GitHub Actions".
  `vite.config.js` `base` must equal the repo name (`/project-juventudes/`).
- **Backend** → Render via `render.yaml` (web service + PostgreSQL).
  After the first deploy, apply `schema.sql` then `migrations/002_day5_admin.sql`,
  and create the first admin with the CLI script.
- On hosts that sleep idle instances, replace the in-process cron with a GitHub
  Actions schedule calling `POST /admin/scholarships/refresh`.

## Database migrations

`schema.sql` builds a fresh database. Existing databases also need:

```bash
psql "$DATABASE_URL" -f backend/src/db/migrations/002_day5_admin.sql
```

It adds `users.chat_disabled` (mute), the `settings` table, and
`countries_enabled` (map toggles). It is idempotent — safe to re-run.
