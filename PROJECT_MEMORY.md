# PROJECT_MEMORY.md — project-juventudes

Complete memory of the project: its purpose, the framework it is built on, the
development history of this collaboration, and the function of every file in
the repository.

---

## 1. Purpose

**project-juventudes** is a Spanish-first social networking platform for
scholarship students (primarily Mexican students abroad). It lets students:

- register and maintain a verified profile (with photo and optional TOTP 2FA),
- discover active scholarships by country on an interactive world map,
- see and connect with other students currently in each country,
- chat in real time, with a **mandatory email notification on every message**,
- while administrators manage scholarships (including manual/internal entries),
  users, moderation, map visibility, and system settings from a fully isolated
  admin panel.

Hard product constraints from the original specification: no country
interaction without login; scholarships refreshed automatically every 24 hours;
email must always trigger on chat; admin system fully isolated; Spanish-first UI
with an optional Google Translate widget for English.

---

## 2. Framework and architecture

```text
┌────────────────────────────┐        HTTPS + WebSocket        ┌─────────────────────────────┐
│  FRONTEND — GitHub Pages   │ ──────────────────────────────► │  BACKEND — Render           │
│  React 18 + Vite 5 (SPA)   │   fetch() JSON  ·  Socket.io    │  Node.js 20 + Express 4     │
│  Leaflet map · one page    │ ◄────────────────────────────── │  PostgreSQL · node-cron     │
│  https://<u>.github.io/    │                                 │  nodemailer (SMTP) · JWT    │
│  project-juventudes/       │                                 │  https://<app>.onrender.com │
└────────────────────────────┘                                 └─────────────────────────────┘
```

**Frontend = Single-Page Application.** There is exactly **one HTML file**
(`frontend/index.html`) and **one CSS file** (`frontend/src/styles/tokens.css`).
All "pages" (login, map, popups, chat, admin) are React components written in
**JSX** — HTML embedded in JavaScript. Browsers cannot run JSX, so `vite build`
compiles the 11 `.jsx` files into one plain `.js` bundle plus the CSS, emitted
into `dist/`. **GitHub Pages serves only that built output** (published by the
CI workflow; `dist/` itself is never committed). Routing uses a URL **hash**
(`#admin`) because Pages has no server-side rewrites — a path route would 404 on
refresh.

**Backend = stateful API.** GitHub Pages cannot run code, so everything with
state lives on Render: Express routes, the PostgreSQL database, the Socket.io
real-time layer (same port as HTTP), the SMTP relay, and the daily scholarship
refresh. Security layers: bcrypt (cost 12), JWT for users, a **separately
signed** JWT for admins (`ADMIN_JWT_SECRET`), TOTP 2FA (RFC 6238), helmet
headers (HSTS etc.), CORS locked to the frontend origin, rate limits (login
10/15 min on both doors, chat 20/min), an append-only `audit_logs` trail, and a
`maintenance_mode` switch that 503s users while keeping `/admin` reachable.

**Key design decisions made during development:**

- **Manual vs. API scholarships.** `scholarships.source` (`'manual'|'api'`) plus
  a **partial unique index** (`WHERE source='api'`) lets admin-typed internal
  scholarships coexist with imported ones — the nightly upsert targets only API
  rows and can never overwrite or duplicate a manual entry. Verified by test.
- **Country names are a controlled vocabulary.** Filtering is exact-match
  against the GeoJSON's `properties.name` (e.g. `"United States of America"`,
  not `"United States"`). `frontend/src/data/countries.js` is **generated from
  the GeoJSON**, and every country input in the UI is a dropdown fed by it, so
  the silent empty-panel mismatch cannot happen.
- **Server-authoritative real-time chat.** Clients never emit chat events. A
  message is sent via `POST /chat`, stored, and only then pushed by the server
  to the recipient's socket room — the sender identity comes from the verified
  JWT and nothing unbacked by the database is ever broadcast.
- **Admins are bootstrapped by CLI, never by signup.** No admin registration
  endpoint exists; `scripts/create-admin.js` creates or resets admins.

---

## 3. Development history (this collaboration, in order)

The build followed a five-day roadmap, executed with two standing conventions:
**every line of every code file carries a comment** explaining its function and
link to the intended output (JSON manifests use `_comment_*` keys since JSON
forbids comments), and **every deliverable was executed and tested before
packaging** — schemas applied to a real PostgreSQL, servers booted, endpoints
curled, builds run.

| Stage | What was built | Notable events & fixes |
| --- | --- | --- |
| **Roadmap** | Five daily plan files from the product spec | Stack locked: React/Vite + Express + PostgreSQL + JWT/TOTP + Socket.io + Leaflet + node-cron |
| **Scope change** | Manual scholarship entry per country | Impact analysis across Days 1/4/5 → the `source` column + partial-unique-index design |
| **Day 1 — Foundations** | Repo scaffold, `schema.sql`, design tokens, env template | Clarified "venv/requirements.txt" does not apply to Node — `package.json` is the manifest. Build caught an invalid JSX comment placed after the root element (fixed, documented in-file). Schema + dedup behavior proven live |
| **Day 2 — Auth** | bcrypt/JWT login, full TOTP cycle, 5MB JPG/PNG photo upload, auth UI | Repo **renamed to `project-juventudes`** → Vite `base` and favicon path updated. Full auth flow verified with a real computed TOTP code; `$2b$12$` hashes and audit rows confirmed |
| **Day 3 — Map & popups** | Leaflet map, dual popup, users/scholarships reads | Real 180-country GeoJSON fetched; `countries.js` generated from it. **Gap closed:** registration never asked for a country → added `PATCH /users/me` + `Profile.jsx`, with a server-side field whitelist (proven to block `email`/`is_active`/`password_hash` edits). Name-mismatch trap demonstrated live |
| **Day 4 — Chat/SMTP/CMS/cron** | Live chat, email relay, scholarship CRUD, 24h scheduler, rate limits | **Design bug in the plan fixed:** the client-emit socket pattern was dead code → replaced with server-side `emitToUser()` after persistence. Second bug class caught by running: SQL `--` comments placed after closing backticks (JS context) → fixed across 3 files. Email captured by a local SMTP catcher; manual-vs-API upsert and expiry verified; limiter blocked at exactly 20/min |
| **Day 5 — Admin & hardening** | Isolated admin panel, migration `002`, deploy files | Three gaps closed: missing schema (mute/settings/toggles → migration), no admin bootstrap (→ `create-admin.js`), and a plan bug where an unset `FRONTEND_ORIGIN` **crashed the server on boot** (→ defensive parsing). Security beyond the plan: RFC-4180 CSV with **formula-injection neutralization** (proven with a hostile `=HYPERLINK` username), optional `ADMIN_JWT_SECRET`, `::int` casts so dashboard counts are numbers. Isolation proven: a valid student token gets 403 on every admin route |
| **Post-dev docs** | `DEPLOYMENT.md` consolidated manual; this memory file | Manual rewritten as a from-scratch retrospective superseding the day files (old db name `scholarship_dev`, old base path, day-by-day installs, etc.). Windows note: Stack Builder add-ons are unnecessary — cancel it |
| **Live-debug fix** | `.env` location bug | User hit "Failed to fetch" on login: the manual said root-level `.env`, but dotenv read only `backend/.env` → no `DATABASE_URL` → the login query **crashed the process**. Reproduced, then fixed three ways: `loadEnv.js` (reads `backend/.env` with repo-root fallback), **startup validation** that names missing variables and exits, and try/catch around login/TOTP handlers so DB failures return 500 instead of killing the server. Also clarified: the `create-admin.js` credentials belong to `…/#admin`, not the student login form |

**Known items intentionally left open for production:** encrypt `totp_secret`
at rest (KMS/envelope encryption); move photo storage off local disk to
S3/Cloudinary (Render wipes `uploads/` on redeploy — only `storeAndGetUrl()`
changes); replace OpenStreetMap's public tiles with a production tile provider;
on sleeping hosts, trigger the daily refresh externally via
`POST /admin/scholarships/refresh`.

---

## 4. File-by-file reference

Tree of everything committed to GitHub (plus the two `package-lock.json` files
generated by `npm install`, which must also be committed for `npm ci` in CI).

### 4.1 Repository root

| File | Function |
| --- | --- |
| `README.md` | Project overview, dependency tables (documents what JSON manifests cannot comment), full API reference by day, security posture. |
| `DEPLOYMENT.md` | The operational manual: from-scratch setup → consolidated 22-point test plan → GitHub → Render → Pages → smoke test → troubleshooting. Supersedes the five day-plan files for setup. |
| `.env.example` | Commented template of every environment variable (DB, CORS origin, both JWT secrets, SMTP, scholarship source). Copied to `backend/.env`; the real file is git-ignored. |
| `.gitignore` | Excludes secrets (`.env*`), installs (`node_modules/`), build output (`frontend/dist/`), runtime uploads (`backend/uploads/`), logs. |
| `LICENSE` | MIT, with placeholder holder/year. |
| `render.yaml` | Infrastructure-as-code blueprint: the Render web service (Node, `npm ci`/`npm start`, `/health` check) + managed PostgreSQL + all env vars (secrets auto-generated or prompted, never committed). |
| `.github/workflows/deploy-frontend.yml` | CI: on pushes to `main` touching `frontend/**` (or manual dispatch), installs with `npm ci`, builds with the `VITE_API_URL` secret baked in, and publishes `frontend/dist` to GitHub Pages. |

### 4.2 Backend — entry & core

| File | Function |
| --- | --- |
| `backend/package.json` | Dependency manifest (the Node "requirements file"): express, cors, dotenv, pg, bcrypt, jsonwebtoken, speakeasy, qrcode, multer, socket.io, nodemailer, node-cron, express-rate-limit, helmet; dev: nodemon, smtp-server. Documented via `_comment_*` keys. |
| `backend/server.js` | Process entry point: wraps Express in an HTTP server, attaches **Socket.io** to the same port, authenticates socket handshakes with the user JWT, joins each user to a private room named by their id, **validates required env vars at startup** (exits with instructions if missing), starts listening, registers the daily scheduler. Deliberately has no `socket.on("dm")` — chat is REST-in, server-push-out. |
| `backend/src/app.js` | The Express "spine", in security-relevant order: `trust proxy`, helmet (HSTS, CORP for avatars), CORS locked to `FRONTEND_ORIGIN` (defensively parsed — an unset value warns instead of crashing), JSON body limit, login rate limits on `/auth/login` **and** `/admin/login`, the `maintenance_mode` gate (503 for users; `/admin` + `/health` stay open; fails open if the settings table is absent), static `/uploads`, `/health`, all five route mounts, JSON 404 and central error handler. |
| `backend/src/realtime.js` | Holds the Socket.io instance (`setIo`) so HTTP routes can `emitToUser(userId, event, payload)` — the mechanism that makes chat live *after* persistence, with the sender derived from the verified token. |

### 4.3 Backend — config, middleware, utils

| File | Function |
| --- | --- |
| `src/config/loadEnv.js` | Robust `.env` loader: resolves paths from the file itself (not the cwd), loading `backend/.env` first with a repo-root `.env` fallback. Fixes the class of bug where the server booted unconfigured and crashed on first query. |
| `src/config/db.js` | The single shared `pg` Pool (reads `DATABASE_URL`, toggles TLS via `DATABASE_SSL`). Every route/service imports this — the one door to PostgreSQL. |
| `src/middleware/auth.js` | `requireAuth`: verifies the `Bearer` user JWT against `JWT_SECRET`, attaches the payload as `req.user`, rejects with 401. Gates every student-facing data route. |
| `src/middleware/admin.js` | `requireAdmin`: verifies against `ADMIN_JWT_SECRET` (falls back to `JWT_SECRET`) **and** requires `role:"admin"`; single generic 403 for every failure mode. Exports `ADMIN_SECRET` for the admin login to sign with. The isolation layer. |
| `src/middleware/rateLimit.js` | `loginLimiter` (10 / 15 min) and `chatLimiter` (20 / min, protecting the email relay behind chat). Documents why `trust proxy` is required behind Render's load balancer. |
| `src/utils/csv.js` | RFC-4180 CSV encoder: quotes/escapes fields, CRLF lines, UTF-8 BOM for Excel accents, and **neutralizes spreadsheet formula injection** (`=`, `+`, `-`, `@`, tab, CR prefixes). Backs the admin user export. |

### 4.4 Backend — routes (the API surface)

| File | Function |
| --- | --- |
| `src/routes/auth.routes.js` | `/auth`: register (bcrypt 12, lowercased email, 409 on duplicate), login (generic 401, `206 {mfa_required}` two-step 2FA, JWT issuance, strips `password_hash`/`totp_secret`, audit-logs every attempt), TOTP setup/verify (QR via `qrcode`, enable-after-proof), photo upload endpoint, scoped multer error handler. Login/TOTP handlers are try/catch-guarded so DB failures return 500, never crash the process. |
| `src/routes/users.routes.js` | `/users`: `PATCH /me` — self-profile update through a strict **field whitelist** (identity/security columns are unreachable); `GET /?country=` — public-safe user cards for the map's right panel (viewer excluded, `is_active` only, paginated with a hard cap of 100). |
| `src/routes/scholarships.routes.js` | `/scholarships`: `GET` (login-gated, `status='active'` only, optional country filter) feeding the left panel; admin-only `POST/PUT/DELETE` with server-side validation (required fields, valid category, date ordering). `POST` hard-codes `source='manual'` + `created_by` so manual entries are refresh-proof. |
| `src/routes/chat.routes.js` | `/chat`: `GET /unread` (badge/dashboard count), `GET /:otherId` (both-direction history, marks received messages read), `POST /` (validates non-empty / not-self / recipient exists+active, **respects the admin mute flag**, stores the row, `emitToUser` live push, fire-and-forget email with logged failures, behind `chatLimiter`). |
| `src/routes/admin.routes.js` | `/admin`: isolated login (admins table, optional TOTP, 1h `role:"admin"` token signed with `ADMIN_SECRET`); dashboard aggregates (`::int` casts so counts are numbers); user search/ban/unban/mute/reset-2FA/CSV export; chat moderation (browse newest, delete); map country toggles (`countries_enabled` upsert); settings read/write; SMTP test; on-demand scholarship refresh (also the endpoint for an external cron); audit-log viewer. **Every mutation writes to `audit_logs`.** |

### 4.5 Backend — services, database, scripts

| File | Function |
| --- | --- |
| `src/services/mailer.js` | Nodemailer transporter (pooled; no-auth mode for local catchers). `sendChatEmail` builds the spec's Spanish notification (subject `Nuevo mensaje de <name>`, `replyTo` the sender) — skips with a warning when SMTP is unconfigured, so local dev never breaks message sending. `sendTestEmail` backs the admin "Probar SMTP" button. |
| `src/services/scheduler.js` | The 24h job (03:00 via node-cron): `refreshFromSource()` pulls `SCHOLARSHIP_API_URL` and upserts as `source='api'`, with `ON CONFLICT … WHERE source='api'` targeting the partial index so **manual rows are untouchable**; `expirePast()` flips past-`end_date` rows inactive. Both exported for manual/admin triggering; errors are logged, never fatal. |
| `src/services/photos.js` | Multer config enforcing the spec's 5 MB cap and JPG/PNG whitelist; `storeAndGetUrl()` writes to `backend/uploads/` with a random filename (dev storage — the documented production swap point for S3/Cloudinary). |
| `src/db/schema.sql` | Source of truth for the core tables: `users` (profile + auth + `current_country`, the map key), `admins` (defined first for the FK), `scholarships` (with `source`, `created_by`, and the **partial unique index `uq_scholarship_api`**), `chats`, `audit_logs`, plus supporting indexes. |
| `src/db/migrations/002_day5_admin.sql` | Idempotent Day 5 additions: `users.chat_disabled` (mute), `settings` key/value store seeded with defaults (`maintenance_mode` etc.), `countries_enabled` map toggles, audit index. Required on every database, dev and prod. |
| `src/db/seed.sql` | **Local-only** demo data: an admin and a Mexico-based user (both password `demo1234`, real bcrypt hash) and one demo scholarship — enough to see the map/popup work before real signups. Never run in production. |
| `scripts/create-admin.js` | CLI admin bootstrap/reset (`node scripts/create-admin.js <email> "<12+ char password>"`) — the only way admins are created, by design. |
| `scripts/dev-smtp.js` | Local SMTP catcher (port 2525): prints every email to the terminal so the mandatory chat notification can be verified without sending real mail. |

### 4.6 Frontend — shell & configuration

| File | Function |
| --- | --- |
| `frontend/index.html` | **The one HTML page.** Spanish `lang`, UTF-8, `#root` mount for React, the Google Translate widget (es↔en per the spec), and the module script Vite rewrites at build time. |
| `frontend/vite.config.js` | Vite config. `base: "/project-juventudes/"` — **must equal the GitHub repo name** or the deployed site is blank; also why the dev URL is `localhost:5173/project-juventudes/`. |
| `frontend/package.json` | Frontend manifest: react, react-dom, leaflet, react-leaflet 4.x (paired with React 18 on purpose), socket.io-client (same 4.x major as the server); dev: vite, plugin-react. Includes the `generate:countries` script. |
| `frontend/public/geo/world.geojson` | Real 180-country world map data. Its `properties.name` values ARE the platform's country vocabulary; copied untouched into the build. |
| `frontend/public/favicon.svg` | Brand tab icon (Deep Blue mortarboard). |
| `frontend/scripts/generate-countries.js` | Regenerates `src/data/countries.js` from the GeoJSON — run whenever the map file changes so dropdowns can never drift from map names. |
| `frontend/src/styles/tokens.css` | **The one stylesheet**: the brand palette as CSS variables (`#0B4F81` primary / `#3A79B4` secondary / `#A8C8E6` accent), buttons, cards, the dual-popup grid (responsive), avatars, badges, and the chat-widget overlay. |

### 4.7 Frontend — application code

| File | Function |
| --- | --- |
| `src/main.jsx` | JS entry: mounts `<App/>` into `#root`, imports the tokens once. Contains the in-file note about where JSX comments are legal (the Day 1 lesson). |
| `src/App.jsx` | Root component and state owner: backend health check, login state, hash routing (`#admin` renders only `AdminPanel`), profile toggle, selected country → mounts `DualPopup`, chat peer → mounts `ChatWidget`, logout clears everything. The wiring diagram of the whole UI. |
| `src/api/client.js` | The single fetch wrapper: base URL from `VITE_API_URL` (baked at build), JSON headers, optional `Bearer` token, throws server error messages for components to display. Every component's only path to the backend. |
| `src/data/countries.js` | **Generated** list + `COUNTRY_SET` — the controlled country vocabulary shared by the profile and admin dropdowns. Do not edit by hand. |
| `components/auth/Login.jsx` | Student login with the two-step 2FA flow (reveals the code field on `mfa_required`), stores the JWT, reports errors. |
| `components/auth/Register.jsx` | Account creation (name/email/password), surfaces 409/validation errors, Spanish-first copy. |
| `components/auth/TotpSetup.jsx` | 2FA enrollment: requests secret+QR, renders it (with manual key fallback), verifies one code to enable. |
| `components/auth/Profile.jsx` | The map-visibility linchpin: sets `current_country` (dropdown from `COUNTRIES`), city, status, institution via `PATCH /users/me` — closes the "registration asks no country" gap. |
| `components/map/WorldMap.jsx` | Leaflet + GeoJSON world map: brand-styled idle/hover/active states, sticky name tooltips, login gating on click (server enforces independently), country hand-off via `onSelectCountry`; loads the GeoJSON through `import.meta.env.BASE_URL` so the path works locally and on Pages. |
| `components/popups/DualPopup.jsx` | The country panel: parallel-fetches scholarships + users, splits Preparatoria/Universidad, renders scholarship cards (areas, dates, status badge, apply link) and user cards (circular avatar, city, email, **Chat** button), empty states, URL-encodes multi-word country names. |
| `components/chat/ChatWidget.jsx` | Bottom-overlay chat: loads history, authenticated Socket.io connection with live/off status dot, de-duplicated incoming `dm` events filtered to the open thread, **5-second polling fallback** when the socket is down, Enter-to-send, optimistic append, rate-limit errors surfaced, full cleanup on close. |
| `components/admin/AdminPanel.jsx` | The isolated admin surface: separate login (own localStorage key `admin_token`), tabs — Resumen (five widgets), Usuarios (search, ban/unban, mute, reset-2FA, CSV download via blob), Becas (form + list with Manual/API badges + delete), Moderación (browse/delete messages), Sistema (settings editor, SMTP test, on-demand refresh). |
| `components/admin/ScholarshipForm.jsx` | Manual per-country scholarship entry: country dropdown from the generated list, category/areas/dates/link/description, posts to the admin-only create (stamped `source='manual'`), resets on success. |
| `src/pages/.gitkeep` | Placeholder keeping the reserved `pages/` folder in Git for future route-level components. |

---

## 5. Runtime relationships (how the files work together)

**A country click:** `WorldMap` → `App` state → `DualPopup` → `api/client` →
(`requireAuth`) → `users.routes` + `scholarships.routes` → `db.js` → PostgreSQL
→ JSON → the two panels.

**A chat message:** `ChatWidget` → `POST /chat` → `chatLimiter` → mute check →
insert into `chats` → `realtime.emitToUser` → recipient's `ChatWidget` socket
(instant) **and** `mailer.sendChatEmail` → SMTP (fire-and-forget, logged on
failure).

**The nightly refresh:** `server.js` → `scheduler.startScheduler` → 03:00 →
`refreshFromSource` (API rows upserted via the partial index; manual rows
untouched) → `expirePast` → the student `GET /scholarships` reflects it with no
deploy.

**An admin action:** `AdminPanel` → `admin.routes` → `requireAdmin`
(`ADMIN_JWT_SECRET` + role) → mutation → `audit_logs` row.

---

## 6. Environment variables (read by `loadEnv.js` from `backend/.env`, repo-root fallback)

| Variable | Role |
| --- | --- |
| `DATABASE_URL` / `DATABASE_SSL` | PostgreSQL connection; SSL `true` on managed hosts. **Required** (boot-validated). |
| `JWT_SECRET` | Signs user tokens. **Required** (boot-validated). |
| `ADMIN_JWT_SECRET` | Signs admin tokens separately (falls back to `JWT_SECRET`). |
| `FRONTEND_ORIGIN` | CORS + Socket.io allow-list — origin only (`https://<user>.github.io`), no path. |
| `SMTP_HOST/PORT/USER/PASS/FROM` | Chat-notification relay (local catcher in dev; unset host = warn & skip). |
| `SCHOLARSHIP_API_URL` | Source for the 24h import (blank = importer skips). |
| `PORT` | API port (hosts inject it; 4000 locally). |
| `VITE_API_URL` | **Frontend, build-time**: the backend URL baked into the bundle (GitHub Actions secret in production). |
