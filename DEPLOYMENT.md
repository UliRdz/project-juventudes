# DEPLOYMENT.md — Orchestrate, Test, Commit and Mount on GitHub Pages

This is the single runbook for **project-juventudes**: it takes the repository
from a folder on your machine to a live site, in order. Follow the phases top to
bottom — later phases depend on earlier ones (for example, the frontend deploy
needs the backend URL, so the backend goes live first).

**What you are deploying (two halves, two hosts):**

```text
┌────────────────────────────┐        HTTPS + WebSocket        ┌─────────────────────────────┐
│  GitHub Pages (static)     │ ──────────────────────────────► │  Render (Node.js API)       │
│  https://<user>.github.io/ │   fetch() + Socket.io           │  https://<app>.onrender.com │
│  project-juventudes/       │ ◄────────────────────────────── │  + PostgreSQL + cron + SMTP │
└────────────────────────────┘        JSON / events            └─────────────────────────────┘
```

GitHub Pages can only serve static files — it cannot run Node, hold a database,
or send email. That is why every step below exists twice: once for the static
frontend (Pages) and once for the stateful backend (Render).

---

## Phase 0 — Prerequisites

Install / create these before starting:

| Tool / account | Why | Check |
| --- | --- | --- |
| **Node.js 20 LTS** (18 minimum) | Runs backend + frontend build; the code uses Node 18's built-in `fetch` | `node -v` |
| **PostgreSQL 14+** (local) | The development database | `psql --version` |
| **Git** | Version control + pushing to GitHub | `git --version` |
| **GitHub account** | Hosts the repo and the Pages site | — |
| **Render account** (free) | Hosts the API + managed PostgreSQL | render.com |
| **SMTP provider** (production only) | Real chat-notification email (Mailtrap/Brevo/Gmail SMTP…) | — |

> **Windows users:** run the commands below in **Git Bash** (installed with Git),
> not CMD/PowerShell, so the `bash` syntax works unchanged.

---

## Phase 1 — Orchestrate locally (get everything running)

### 1.1 Position the project

Unzip `project-juventudes-complete.zip` and open a terminal at the repo root:

```bash
cd project-juventudes        # You should see backend/, frontend/, render.yaml, .github/
ls -la                       # Confirm .env.example, .gitignore and .github/ are present (they are hidden files).
```

### 1.2 Create your environment file

```bash
cp .env.example .env         # Copy the template; .env is git-ignored so secrets never reach GitHub.
```

Edit `.env` and set at least these for local work:

```text
DATABASE_URL=postgres://<your_pg_user>:<password>@localhost:5432/juventudes_dev
DATABASE_SSL=false
FRONTEND_ORIGIN=http://localhost:5173
JWT_SECRET=<paste a long random string>
ADMIN_JWT_SECRET=<paste a DIFFERENT long random string>
SMTP_HOST=127.0.0.1          # points at the local mail catcher from step 1.5
SMTP_PORT=2525
SMTP_FROM=juventudes@gtoxmundo.com
```

Generate good secrets with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`

### 1.3 Create the database and apply the SQL (in this exact order)

```bash
createdb juventudes_dev                                            # 1) Empty database.
psql juventudes_dev -f backend/src/db/schema.sql                   # 2) Core tables (users, scholarships, chats, admins, audit_logs).
psql juventudes_dev -f backend/src/db/migrations/002_day5_admin.sql # 3) Day 5 additions (chat mute, settings, country toggles). Idempotent.
psql juventudes_dev -f backend/src/db/migrations/003_profile_contact.sql # 4) Photo release: profile_photo_url + phone_country_code + phone_number. Idempotent.
psql juventudes_dev -f backend/src/db/seed.sql                     # 5) OPTIONAL demo data — LOCAL ONLY (see warning below).
```

> **Why 003 exists even though `schema.sql` already declares those three
> columns:** a database created from an *earlier* revision of `schema.sql` is
> missing them, and a missing column surfaces as a confusing 500 ("column does
> not exist") on registration and on photo upload. Every statement in 003 uses
> `IF NOT EXISTS`, so on a database built from the current `schema.sql` it is a
> no-op. Running it unconditionally makes both cases identical.

> ⚠️ **seed.sql is for local development only.** It creates
> `demo@example.com` / `admin@example.com` with the password `demo1234`, which is
> printed in this public repository. Never run it against production.

### 1.4 Install backend dependencies and bootstrap the first admin

```bash
cd backend
npm install                                            # Installs everything in package.json AND generates package-lock.json.
node scripts/create-admin.js you@example.com "a-strong-password-12chars+"   # No admin signup route exists by design; this is the way in.
```

> **Do not delete `package-lock.json`.** Both CI pipelines (GitHub Actions and
> Render) install with `npm ci`, which **fails if the lockfile is missing**. It
> must be committed in Phase 3.

### 1.5 Start the local email catcher (terminal 1)

The spec requires an email on every chat message; this prints them instead of
sending real mail:

```bash
cd backend
node scripts/dev-smtp.js     # Leave running. Every chat email appears in this terminal.
```

### 1.6 Start the backend (terminal 2)

```bash
cd backend
npm run dev                  # Expect: "API + WebSocket running on :4000" and "Scheduler registered: daily at 03:00".
```

### 1.7 Start the frontend (terminal 3)

```bash
cd frontend
npm install                  # Also generates frontend/package-lock.json (commit it too).
npm run dev                  # Opens on http://localhost:5173
```

Open **http://localhost:5173**. The page must show **"Backend health: ok"** —
that line is the proof the two halves are talking. If it says
"backend unreachable", fix that before continuing (see Troubleshooting).

---

## Phase 2 — Test everything locally

Run through this in the browser (it mirrors the five days' validation
checklists). Each item maps to a feature you built:

**Student flow**
1. **Register** a new account (password must be 8+ chars; a duplicate email must show an error, not crash).
2. **Log in** → the map view appears.
3. Open **Mi perfil** → pick a country from the dropdown (e.g. `Mexico`) → **Guardar**. *(Without this step you are invisible on the map — registration deliberately doesn't ask for a country.)*
4. Optional: **Seguridad (2FA)** → Activar → scan the QR with Google Authenticator → confirm a code → log out and back in; it must now demand the 6-digit code.
5. On the map: **hover** = light blue, **click** = deep blue + the dual popup opens (scholarships left, students right). Logged out, a click must be blocked.
6. In a **second browser / private window**, register a second user, set the *same* country, and from the first account click **Chat** on their card. Send a message:
   - it appears instantly in the other window (green dot = live socket), and
   - the notification email prints in the **dev-smtp terminal** with subject `Nuevo mensaje de <name>`.
7. Send >20 messages in a minute → the composer must show the rate-limit error (HTTP 429).

**Admin flow**
8. Open **http://localhost:5173/#admin** (note the `#`) → log in with the admin created in 1.4. Your *student* login must NOT work here.
9. **Resumen**: the five widgets show live numbers.
10. **Becas**: add a manual scholarship for a country → it appears with a **Manual** badge, and immediately shows in that country's map popup for students.
11. **Usuarios**: mute your second user → in their window, sending chat now fails (403); unmute restores it. Try **Exportar CSV**.
12. **Sistema**: set `maintenance_mode` to `true` → the student window gets a 503 message; the admin panel keeps working; set it back to `false`.

**Command-line spot checks (optional but fast):**

```bash
curl -s localhost:4000/health                                   # -> {"status":"ok"}
curl -s -o /dev/null -w "%{http_code}\n" "localhost:4000/scholarships?country=Mexico"   # -> 401 (login required, enforced server-side)
```

**Pre-flight build (must pass before committing):**

```bash
cd frontend && npm run build     # Must end with "✓ built". This is exactly what GitHub Actions will run.
cd ../backend && for f in $(find src scripts server.js -name '*.js'); do node --check "$f" || echo "FAIL $f"; done
```

---

## Phase 3 — Commit and push to GitHub

### 3.1 The repository name is not optional

`frontend/vite.config.js` contains `base: "/project-juventudes/"`. On GitHub
Pages, **the repo name must be exactly `project-juventudes`** or every asset
URL 404s and the deployed page renders blank. (If you ever rename the repo,
change `base` — and the favicon path in `frontend/index.html` — to match.)

### 3.2 Initialize, verify what will be committed, and push

```bash
cd project-juventudes                 # repo root
git init                              # New local repository.
git add .                             # Stage everything not excluded by .gitignore.
git status                            # VERIFY before committing:
                                      #   MUST be listed:   backend/package-lock.json, frontend/package-lock.json,
                                      #                     .github/workflows/deploy-frontend.yml, render.yaml
                                      #   MUST NOT appear:  .env, node_modules/, backend/uploads/, frontend/dist/
git commit -m "Scholarship social network: full 5-day build"
git branch -M main                    # The workflow triggers on pushes to main.
```

Create the repo on GitHub (via the website: **New repository → name:
`project-juventudes` → Public** — Pages on the free plan requires a public
repo), then:

```bash
git remote add origin https://github.com/<your-username>/project-juventudes.git
git push -u origin main
```

> The push will start the "Deploy frontend to Pages" workflow, and **its deploy
> step will fail** — expected, because Pages isn't enabled and the backend URL
> secret doesn't exist yet. Phases 4–5 fix that; you'll re-run it in 5.3.

---

## Phase 4 — Deploy the backend first (Render)

The frontend build bakes the backend URL into the bundle, so the backend must
exist before the Pages build.

### 4.1 Create the services from the blueprint

1. Render dashboard → **New + → Blueprint** → connect the
   `project-juventudes` repo. Render reads `render.yaml` and proposes the API
   service + the PostgreSQL database.
2. It prompts for every `sync: false` variable. Set:
   - `FRONTEND_ORIGIN` = `https://<your-username>.github.io`
     — **origin only: no path, no trailing slash.** CORS matches origins
     (scheme+host), so `https://user.github.io/project-juventudes` would never match.
   - `SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_FROM` = your real
     provider (never the local catcher).
   - `SCHOLARSHIP_API_URL` = your scholarship source (leave blank to skip the
     nightly import for now).
3. Deploy. First build takes a few minutes.

### 4.2 Apply the SQL to the managed database

On the Render **database** page copy the **External Connection String**, then
from your machine:

```bash
export PROD_DB="<external-connection-string>"                          # Contains user/pass/host — treat as a secret.
psql "$PROD_DB" -f backend/src/db/schema.sql                           # Core tables.
psql "$PROD_DB" -f backend/src/db/migrations/002_day5_admin.sql        # Day 5 tables. (Do NOT run seed.sql here.)
psql "$PROD_DB" -f backend/src/db/migrations/003_profile_contact.sql   # Photo release: avatar path + private phone pair. Idempotent, safe to re-run.
```

Verify the third file actually landed on the database your API is connected to:

```bash
psql "$PROD_DB" -c "SELECT column_name FROM information_schema.columns \
  WHERE table_name='users' \
    AND column_name IN ('profile_photo_url','phone_country_code','phone_number');"
# Expect exactly 3 rows. Fewer means DATABASE_URL on the web service points
# somewhere else than $PROD_DB — registration will return 500 until they match.
```

> **Ordering:** run this migration *before* the new backend serves its first
> request. A backend that inserts `phone_number` into a table without that
> column returns 500 on every registration.

### 4.3 Create the production admin

```bash
cd backend
DATABASE_URL="$PROD_DB" DATABASE_SSL=true node scripts/create-admin.js admin@yourdomain.com "a-long-unique-production-password"
```

### 4.4 Verify

```bash
curl https://<your-app>.onrender.com/health        # -> {"status":"ok"}
```

Keep that URL — it is the value of the next phase's secret.

---

## Phase 5 — Mount the frontend on GitHub Pages

### 5.1 Enable Pages

GitHub repo → **Settings → Pages → Build and deployment → Source:
"GitHub Actions"**.

### 5.2 Add the backend URL secret

**Settings → Secrets and variables → Actions → New repository secret**:

- Name: `VITE_API_URL`
- Value: `https://<your-app>.onrender.com`   *(no trailing slash)*

Vite inlines this at **build time** — there is no server on Pages to read it at
runtime, which is why it must exist *before* the build runs.

### 5.3 Run the deployment

**Actions tab → "Deploy frontend to Pages" → Run workflow** (the manual
`workflow_dispatch` trigger exists exactly for this). Watch it go green:
checkout → Node 20 → `npm ci` → build → upload → deploy. From now on, every push
to `main` touching `frontend/**` redeploys automatically.

### 5.4 Open the site

- Student app: `https://<your-username>.github.io/project-juventudes/`
- Admin panel: `https://<your-username>.github.io/project-juventudes/#admin`
  *(hash routing on purpose — Pages has no server rewrites, so a `/admin` path
  would 404 on refresh; a `#admin` hash never reaches the server).*

---

## Phase 6 — Production smoke test

Run the same sequence as Phase 2, now against the live site, in this order:

1. `https://<app>.onrender.com/health` returns `ok`.
2. Site loads with **"Backend health: ok"** (proves CORS + the baked-in URL are right).
3. Register → log in → set a country in **Mi perfil** → your card appears in that country's panel from a second account.
4. Send a chat message → the **real email** arrives (check spam the first time).
5. **Mi perfil** → **Cambiar foto** → upload a JPG under 5 MB → the header avatar
   updates, and the same photo appears on your card in the country panel and in
   the chat header. (If it stays a placeholder, `VITE_API_URL` was not set at
   build time — see Troubleshooting.)
6. Logo top-left on every screen, language selector top-right; translate to
   English and back — neither should shift position.
7. `#admin` → log in with the Phase 4.3 admin → add a manual scholarship →
   confirm a student sees it on the map with no redeploy.
8. `#admin` → **Usuarios** → **Editar** a profile and save, then **Becas** →
   **Editar** a scholarship and save. Both should reload with the new values.
9. Dashboard counts reflect everything you just did.

> **Free-tier note:** Render's free instances sleep when idle — the first
> request after a quiet period takes ~30–60 s to wake. That is the host, not a bug.

---

## Phase 7 — Two follow-ups before real traffic

1. **The 03:00 scholarship refresh only runs while the process is awake.** On the
   free (sleeping) tier, schedule it externally: a GitHub Actions cron that logs
   into `/admin/login` and calls `POST /admin/scholarships/refresh`, or simply
   press **"Actualizar becas ahora"** in the admin panel's Sistema tab.
2. **Known pre-production items** (documented in the README): encrypt
   `totp_secret` at rest, and move profile photos from local disk to object
   storage — **Render wipes `uploads/` on every redeploy**, so production photos
   need S3/Cloudinary (only `storeAndGetUrl()` in `photos.js` changes).

---

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Pages site is **blank**, console full of 404s | Repo name ≠ `base` in `vite.config.js` | Make them identical, push again |
| Browser shows **CORS error**; site says "backend unreachable" | `FRONTEND_ORIGIN` wrong on Render | Set it to `https://<user>.github.io` exactly — origin only, no path/slash |
| Workflow fails at **`npm ci`** | `package-lock.json` not committed | `npm install` in both folders, commit both lockfiles, push |
| Workflow deploy step: "Get Pages site failed" | Pages source not set | Settings → Pages → Source: GitHub Actions, then re-run |
| Site loads but calls hit `http://localhost:4000` | `VITE_API_URL` secret missing at build time | Add the secret, **re-run the workflow** (a rebuild is required) |
| A country's user panel is **empty, no error** | Country string mismatch (e.g. "United States" vs "United States of America") | Only set countries via the dropdowns (generated from the GeoJSON); never hand-edit |
| Everything returns **503 "En mantenimiento"** | `maintenance_mode` is `true` | Admin panel → Sistema → set it to `false` (`/admin` stays reachable for exactly this) |
| Chat sends but **no email** | `SMTP_HOST` unset (backend logs a warning and skips) or wrong credentials | Fix SMTP vars; verify with admin **Probar SMTP** |
| **403** on admin routes with a student login | Working as designed — token isolation | Use the `#admin` login with an admin account |
| First request after idle takes ~1 min | Free instance waking up | Expected on the free tier; upgrade or accept |
| `psql` SSL errors against Render | Managed Postgres requires TLS | Use the External Connection String; for the admin script also set `DATABASE_SSL=true` |

---

## Quick reference — the whole path in 12 commands

```bash
createdb juventudes_dev
psql juventudes_dev -f backend/src/db/schema.sql
psql juventudes_dev -f backend/src/db/migrations/002_day5_admin.sql
psql juventudes_dev -f backend/src/db/migrations/003_profile_contact.sql
(cd backend && npm install && node scripts/create-admin.js you@x.com "strong-pass-12+")
(cd backend && node scripts/dev-smtp.js &) ; (cd backend && npm run dev &)
(cd frontend && npm install && npm run dev)          # test at :5173, then:
(cd frontend && npm run build)                       # must pass before pushing
git init && git add . && git commit -m "initial" && git branch -M main
git remote add origin https://github.com/<user>/project-juventudes.git && git push -u origin main
# Render: New Blueprint -> fill env vars -> apply schema + migrations 002 AND 003 to prod DB -> create prod admin
# GitHub: Settings->Pages: GitHub Actions | Secrets: VITE_API_URL=<render URL>
# Actions -> "Deploy frontend to Pages" -> Run workflow -> open https://<user>.github.io/project-juventudes/
```
