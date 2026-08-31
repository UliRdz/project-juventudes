# DEPLOYMENT.md — Post-Development Manual (from zero to live)

**Project:** `project-juventudes` — Spanish-first scholarship social network
**Repository name (fixed):** `project-juventudes` · **Frontend:** GitHub Pages · **Backend:** Render (Node.js + PostgreSQL)

This is the **consolidated, retrospective manual** for the finished build. During
development the work was split into five day-plans (setup → auth → map → chat/CMS
→ admin/deploy). Those five documents remain useful as *design and learning*
records, but they describe intermediate states. **This manual supersedes them for
setup and deployment**: it assumes you are starting from scratch with only the
final code, and it takes you from an empty machine to a live site in one pass.

---

## Part A — Retrospective: how the five days map to this manual

Everything the five days produced is already in the final code, so "doing the five
days" now collapses into the phases below:

| Day | What was built | Where it lands in this manual |
| --- | --- | --- |
| **1 — Foundations** | Repo structure, Vite/React + Express scaffolds, `schema.sql`, design tokens, `.env.example` | Phase 1 (env + database + install) — no scaffolding commands needed; the files exist |
| **2 — Authentication** | Register/login, bcrypt, JWT, TOTP 2FA, photo upload, auth UI | Installed by the same `npm install`; verified in Phase 2 tests 4–8 |
| **3 — Map & popups** | Leaflet world map, dual popup, users/scholarships endpoints, `PATCH /users/me`, country list generated from the GeoJSON | Verified in Phase 2 tests 9–12 |
| **4 — Chat, SMTP, CMS, cron** | Socket.io live chat, mandatory email relay, scholarship CRUD, 24h scheduler, rate limits | Phase 1.5 (mail catcher) + Phase 2 tests 13–16 |
| **5 — Admin & hardening** | Isolated admin panel, migration `002`, `create-admin.js`, helmet/CORS/limits, CI workflow, `render.yaml` | Phase 1.3–1.4 (migration + admin bootstrap), Phase 2 tests 17–22, Phases 4–5 (deploy) |

### Instructions from the day files that the final code SUPERSEDES

If you re-read the five day documents, **do not follow these** — the final code
moved past them:

1. **No scaffolding.** Skip every `npm create vite`, `npm init -y`, `mkdir`,
   `touch` from Days 1–2. The files already exist; running scaffolders again can
   overwrite them.
2. **No day-by-day installs.** Skip the incremental `npm install <package>` steps
   from Days 2 and 4. One `npm install` per folder installs all five days'
   dependencies (backend: express, cors, dotenv, pg, bcrypt, jsonwebtoken,
   speakeasy, qrcode, multer, socket.io, nodemailer, node-cron,
   express-rate-limit, helmet; frontend: react, react-dom, leaflet,
   react-leaflet, socket.io-client).
3. **Database name.** Day 1 says `scholarship_dev` (the project's pre-rename
   name). This manual uses **`juventudes_dev`**. Either works — the local name is
   arbitrary — but your `.env` `DATABASE_URL` must match whichever you create.
4. **Base path.** Day 1 shows `base: "/scholarship-network/"`. The final code has
   **`base: "/project-juventudes/"`**, which must equal the GitHub repository
   name. Never revert this.
5. **`schema.sql` alone is no longer enough.** Day 5 introduced
   `migrations/002_day5_admin.sql` (chat mute, settings, country toggles). A
   fresh database needs **both** files, in that order.
6. **Scholarship writes are admin-only now.** Day 4's `requireAuth` placeholder on
   `POST/PUT/DELETE /scholarships` was replaced by `requireAdmin` on Day 5. A
   normal user token gets 403 there — that is correct behavior, not a bug.
7. **Admins are created by script, not SQL or signup.** Use
   `backend/scripts/create-admin.js` (Phase 1.4). There is deliberately no admin
   signup endpoint.
8. **Rate limits as shipped:** login **10 attempts / 15 min** on *both*
   `/auth/login` and `/admin/login` (the Day 5 text said 5 for admin; the final
   code standardizes on one limiter), and chat **20 messages / min**.
9. **Two secrets, not one.** The final `.env` adds `ADMIN_JWT_SECRET` so admin
   tokens are signed separately from user tokens (falls back to `JWT_SECRET` if
   unset, but set both).

**Architecture being deployed** (unchanged since Day 1's design):

```text
┌────────────────────────────┐        HTTPS + WebSocket        ┌─────────────────────────────┐
│  GitHub Pages (static)     │ ──────────────────────────────► │  Render (Node.js API)       │
│  https://<user>.github.io/ │   fetch() + Socket.io           │  https://<app>.onrender.com │
│  project-juventudes/       │ ◄────────────────────────────── │  + PostgreSQL + cron + SMTP │
└────────────────────────────┘        JSON / events            └─────────────────────────────┘
```

GitHub Pages serves only static files, so it hosts the built frontend; everything
stateful (database, sockets, email, the 24h refresh) runs on Render.

---

## Part B — Phase 0 · Prerequisites

| Tool / account | Why | Check |
| --- | --- | --- |
| **Node.js 20 LTS** (18 min.) | Backend + frontend build; code uses Node 18's built-in `fetch` | `node -v` |
| **PostgreSQL 14+** local | Development database | `psql --version` |
| **Git** | Version control + push | `git --version` |
| **GitHub account** | Repo + Pages hosting | — |
| **Render account** (free) | API + managed PostgreSQL | render.com |
| **SMTP provider** (prod only) | Real chat-notification email | — |

> **Windows:** run everything below in **Git Bash** so the syntax works unchanged.

---

## Phase 1 · Local orchestration from scratch

### 1.1 Position the code

Unzip the final package and open a terminal at the repo root:

```bash
cd project-juventudes         # Must contain backend/, frontend/, render.yaml, .github/, .env.example
ls -la                        # (.env.example and .github/ are hidden files)
```

### 1.2 Environment file

```bash
cp .env.example .env          # .env is git-ignored; secrets never reach GitHub.
```

Edit `.env` — minimum working local set:

```text
DATABASE_URL=postgres://<pg_user>:<password>@localhost:5432/juventudes_dev
DATABASE_SSL=false
FRONTEND_ORIGIN=http://localhost:5173
JWT_SECRET=<long random string>
ADMIN_JWT_SECRET=<a DIFFERENT long random string>
SMTP_HOST=127.0.0.1           # the local mail catcher from 1.5
SMTP_PORT=2525
SMTP_FROM=juventudes@gtoxmundo.com
```

Generate secrets: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### 1.3 Database — schema, migration, optional seed (this order)

```bash
createdb juventudes_dev                                             # 1) Empty database.
psql juventudes_dev -f backend/src/db/schema.sql                    # 2) Day 1 core: users, admins, scholarships, chats, audit_logs.
psql juventudes_dev -f backend/src/db/migrations/002_day5_admin.sql # 3) Day 5: chat mute, settings, country toggles. Idempotent.
psql juventudes_dev -f backend/src/db/seed.sql                      # 4) OPTIONAL demo data — LOCAL ONLY.
```

> **Have a Day 1 database already** (e.g. `scholarship_dev`)? Keep it: point
> `DATABASE_URL` at it and run steps 3–4 against that name. Only the migration is
> mandatory — it didn't exist on Day 1.

> ⚠️ **seed.sql is local-only.** It creates `demo@example.com` /
> `admin@example.com` with password `demo1234`, printed in this repository.
> Never run it in production.

### 1.4 Backend — install everything, bootstrap the first admin

```bash
cd backend
npm install                                                # All 5 days' packages in one pass; also generates package-lock.json.
node scripts/create-admin.js you@example.com "a-strong-password-12chars+"
```

> **Keep both `package-lock.json` files.** GitHub Actions and Render install with
> `npm ci`, which **fails without a committed lockfile**. They must be committed
> in Phase 3.

### 1.5 Mail catcher (terminal 1)

Every chat message must trigger an email (product requirement). Locally, catch
them instead of sending real mail:

```bash
cd backend
node scripts/dev-smtp.js       # Prints every email it receives. Leave running.
```

### 1.6 Backend server (terminal 2)

```bash
cd backend
npm run dev                    # Expect: "API + WebSocket running on :4000" + "Scheduler registered: daily at 03:00".
```

### 1.7 Frontend (terminal 3)

```bash
cd frontend
npm install                    # Generates frontend/package-lock.json (commit it too).
npm run dev                    # http://localhost:5173
```

Open **http://localhost:5173** — the page must show **"Backend health: ok"**.
That line proves the two halves are connected; do not continue until it does.

---

## Phase 2 · Master test plan (all five days' checklists, consolidated)

Work through this in the browser. Numbers group by the day that built the feature.

**Day 1 — foundations**
1. Frontend loads with the brand palette (deep-blue title) — `tokens.css` active.
2. "Backend health: ok" — CORS + API client working.
3. `psql juventudes_dev -c "\dt"` lists 8 tables (5 core + settings, countries_enabled, plus audit_logs).

**Day 2 — authentication**
4. Register (8+ char password). Registering the same email again shows an error (409), not a crash.
5. Log in → the map view appears. `psql`-check: `password_hash` starts with `$2b$12$`, never plaintext.
6. Optional 2FA: Seguridad → Activar → scan QR in Google Authenticator → confirm → logout → login now demands the 6-digit code; a wrong code is rejected.
7. Photo upload: a JPG/PNG under 5MB is accepted; a bigger or non-image file is rejected with a clear message.
8. `audit_logs` has rows for your login attempts.

**Day 3 — map & discovery**
9. **Mi perfil → pick a country from the dropdown → Guardar.** (Registration doesn't ask for one; without this you appear in no country panel — by design.)
10. Map: hover = light blue; click = deep blue + dual popup (scholarships left, students right). Logged out, clicks are blocked client-side *and* the API returns 401.
11. In a second/private browser window, register a second user and set the *same* country → they appear on the first user's panel (the viewer is excluded from their own list).
12. Country names must come from dropdowns only — the list is generated from the GeoJSON, so "United States of America" matches and hand-typed "United States" silently wouldn't.

**Day 4 — chat, email, CMS, cron**
13. From user A, click **Chat** on user B's card, send a message → it appears **instantly** in B's window (green dot = live socket) **and** the email prints in the dev-smtp terminal (`Nuevo mensaje de <name>`).
14. Blank message → rejected; messaging yourself → rejected; >20 messages in a minute → rate-limit error (429).
15. Close/reopen the chat → history persists; B's unread count drops to 0 after reading.
16. Scheduler: it fires at 03:00, or trigger it now from the admin panel (test 20) — expired scholarships flip to inactive and vanish from the student view.

**Day 5 — admin & hardening**
17. **`http://localhost:5173/#admin`** → log in with the 1.4 admin. Your *student* credentials must fail here, and a student token must get 403 on admin APIs.
18. Resumen: five live widgets (users, active scholarships, countries, pending chats, last update).
19. Becas: add a manual scholarship → "Manual" badge → **it appears in that country's map popup for students immediately.** Delete works.
20. Sistema: **Actualizar becas ahora** runs the refresh on demand; **Probar SMTP** lands in the dev-smtp terminal.
21. Usuarios: mute your second user → their sends now fail (403); unmute restores; **Exportar CSV** downloads a well-formed file (commas in names stay in one cell; a name starting with `=` is neutralized).
22. Sistema → `maintenance_mode=true` → the student window gets a 503 message while `#admin` keeps working → set back to `false`.

**Pre-flight (must pass before committing):**

```bash
cd frontend && npm run build      # Must end "✓ built" — exactly what CI will run.
cd ../backend && for f in $(find src scripts server.js -name '*.js'); do node --check "$f" || echo "FAIL $f"; done
```

---

## Phase 3 · Commit and push to GitHub

### 3.1 The repository name is load-bearing

`frontend/vite.config.js` has `base: "/project-juventudes/"`. On GitHub Pages the
**repo must be named exactly `project-juventudes`**, or every built asset URL
404s and the site renders blank. (Renaming the repo later means changing `base`
and the favicon path in `frontend/index.html` to match.)

### 3.2 Initialize, verify, push

```bash
cd project-juventudes
git init
git add .
git status        # VERIFY:
                  #  MUST be staged:  backend/package-lock.json, frontend/package-lock.json,
                  #                   .github/workflows/deploy-frontend.yml, render.yaml
                  #  MUST be absent:  .env, node_modules/, backend/uploads/, frontend/dist/
git commit -m "project-juventudes: scholarship social network (5-day build)"
git branch -M main
```

On github.com: **New repository → name `project-juventudes` → Public** (free-plan
Pages requires public). Then:

```bash
git remote add origin https://github.com/<your-username>/project-juventudes.git
git push -u origin main
```

> The push triggers the Pages workflow and **it will fail** — expected: Pages
> isn't enabled and the backend URL secret doesn't exist yet. Phases 4–5 fix it;
> you re-run in 5.3.

---

## Phase 4 · Deploy the backend first (Render)

The Pages build bakes the backend URL into the bundle, so the backend must exist
before the frontend deploy.

### 4.1 Blueprint

Render → **New + → Blueprint** → connect the repo. Render reads `render.yaml`
(API service + PostgreSQL) and prompts for the `sync: false` values:

- `FRONTEND_ORIGIN` = `https://<your-username>.github.io` — **origin only: no
  path, no trailing slash.** CORS matches scheme+host; a path would never match.
- `SMTP_HOST/PORT/USER/PASS/FROM` = your real provider (never the local catcher).
- `SCHOLARSHIP_API_URL` = your source, or blank to skip the nightly import.

`JWT_SECRET` and `ADMIN_JWT_SECRET` are auto-generated by the blueprint. Deploy.

### 4.2 Apply the SQL to the managed database

Copy the database's **External Connection String**, then locally:

```bash
export PROD_DB="<external-connection-string>"                     # Secret — contains credentials.
psql "$PROD_DB" -f backend/src/db/schema.sql
psql "$PROD_DB" -f backend/src/db/migrations/002_day5_admin.sql   # Do NOT run seed.sql here.
```

### 4.3 Production admin

```bash
cd backend
DATABASE_URL="$PROD_DB" DATABASE_SSL=true node scripts/create-admin.js admin@yourdomain.com "a-long-unique-production-password"
```

### 4.4 Verify

```bash
curl https://<your-app>.onrender.com/health      # -> {"status":"ok"}
```

That URL is the value of the next phase's secret.

---

## Phase 5 · Mount the frontend on GitHub Pages

1. **Enable Pages:** repo → Settings → Pages → Source: **"GitHub Actions"**.
2. **Secret:** Settings → Secrets and variables → Actions → New repository secret
   → Name `VITE_API_URL`, Value `https://<your-app>.onrender.com` (no trailing
   slash). Vite inlines it at **build time** — Pages has no server to read it later.
3. **Run:** Actions tab → **"Deploy frontend to Pages"** → **Run workflow** (the
   manual trigger exists for exactly this first run). Watch: checkout → Node 20 →
   `npm ci` → build → deploy. Afterwards, every push to `main` touching
   `frontend/**` redeploys automatically.
4. **Open:**
   - Students: `https://<your-username>.github.io/project-juventudes/`
   - Admin: `https://<your-username>.github.io/project-juventudes/#admin`
     *(hash routing on purpose — Pages has no rewrites, so `/admin` would 404 on
     refresh; a `#admin` hash never reaches the server).*

---

## Phase 6 · Production smoke test

In order: (1) `/health` returns ok → (2) site shows "Backend health: ok" (CORS +
baked URL correct) → (3) register, log in, set a country, confirm your card shows
from a second account → (4) send a chat, confirm the **real** email arrives
(check spam once) → (5) `#admin` with the Phase 4.3 admin, add a manual
scholarship, confirm a student sees it with **no redeploy** → (6) dashboard
counts reflect all of it.

> **Free tier:** Render sleeps idle instances — the first request after a quiet
> period takes ~30–60 s. That's the host waking, not a bug.

---

## Phase 7 · Operating it after launch

1. **The 03:00 refresh only fires while the process is awake.** On a sleeping
   free instance, trigger it externally — a GitHub Actions cron that logs into
   `/admin/login` and calls `POST /admin/scholarships/refresh` — or press
   **"Actualizar becas ahora"** in Sistema.
2. **Known pre-production items (flagged during the build, intentionally open):**
   `totp_secret` is plaintext at rest (add KMS/envelope encryption before scale),
   and profile photos write to local disk, which **Render wipes on every
   redeploy** — swap `storeAndGetUrl()` in `backend/src/services/photos.js` for
   object storage (S3/Cloudinary); the validation stays identical.
3. **Migrations:** flip `maintenance_mode` to `true` in Sistema first — users get
   a clean 503 while `/admin` and `/health` stay reachable — then back off.
4. **Rotate** the demo-era secrets: never reuse `demo1234`-style credentials or
   the local `JWT_SECRET` values anywhere near production.

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pages site **blank**, console 404s | Repo name ≠ `base` in `vite.config.js` | Repo must be `project-juventudes`; push again |
| **CORS error** / "backend unreachable" | `FRONTEND_ORIGIN` wrong on Render | `https://<user>.github.io` exactly — origin only |
| CI fails at **`npm ci`** | Lockfiles not committed | `npm install` in both folders, commit both `package-lock.json`, push |
| Deploy step "Get Pages site failed" | Pages source not set | Settings → Pages → GitHub Actions, re-run |
| Live site calls `localhost:4000` | `VITE_API_URL` secret missing at build | Add secret, **re-run the workflow** (rebuild required) |
| Country panel **empty, no error** | Name mismatch vs the GeoJSON | Use the dropdowns only; regenerate list via `frontend/scripts/generate-countries.js` if the map file changes |
| Everything 503 "En mantenimiento" | `maintenance_mode=true` | `#admin` → Sistema → set `false` |
| Chat works, **no email** | `SMTP_HOST` unset (logged + skipped) or bad creds | Fix SMTP vars; verify with **Probar SMTP** |
| **403** on admin routes as a student | Token isolation working as designed | Log in at `#admin` with an admin account |
| **403** on creating a scholarship | Writes are admin-only since Day 5 | Use the admin panel, not a user session |
| First request takes ~1 min | Free instance waking | Expected; upgrade or accept |
| `psql` SSL errors to Render | Managed Postgres needs TLS | External Connection String; scripts need `DATABASE_SSL=true` |

---

## Quick reference — zero to live

```bash
# LOCAL (Phases 1–2)
cp .env.example .env                                   # then fill values
createdb juventudes_dev
psql juventudes_dev -f backend/src/db/schema.sql
psql juventudes_dev -f backend/src/db/migrations/002_day5_admin.sql
(cd backend  && npm install && node scripts/create-admin.js you@x.com "strong-pass-12+")
(cd backend  && node scripts/dev-smtp.js &)            # terminal 1
(cd backend  && npm run dev &)                         # terminal 2
(cd frontend && npm install && npm run dev)            # terminal 3 → test at :5173 (+ /#admin)
(cd frontend && npm run build)                         # must pass before pushing

# GITHUB (Phase 3)
git init && git add . && git commit -m "initial" && git branch -M main
git remote add origin https://github.com/<user>/project-juventudes.git && git push -u origin main

# BACKEND (Phase 4): Render → New Blueprint → fill env vars
psql "$PROD_DB" -f backend/src/db/schema.sql
psql "$PROD_DB" -f backend/src/db/migrations/002_day5_admin.sql
(cd backend && DATABASE_URL="$PROD_DB" DATABASE_SSL=true node scripts/create-admin.js admin@x.com "prod-pass-12+")

# FRONTEND (Phase 5): Settings→Pages: GitHub Actions | Secret VITE_API_URL=<render URL>
# Actions → "Deploy frontend to Pages" → Run workflow
# → https://<user>.github.io/project-juventudes/   (+ /#admin)
```
