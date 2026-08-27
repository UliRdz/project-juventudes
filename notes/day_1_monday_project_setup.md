# Monday Workday Plan: Project Setup and Foundations

## Objective

Build the technical base for the **Scholarship Social Network** by creating the full-stack repository (frontend + backend), setting up reproducible environments, defining the database schema, and encoding the design system so every later feature has a clean, consistent base.

## Concepts to learn today

- Monorepo vs. two-repo layout for a static frontend + external backend.
- How a **static GitHub Pages SPA** talks to an **external REST API** (CORS, base URLs, environment variables).
- Relational schema design for `users`, `scholarships`, `chats`, and `admin`.
- Design tokens: turning a brand color palette into reusable CSS variables.

## Deliverables covered

- `frontend/` scaffold (Vite + React)
- `backend/` scaffold (Node.js + Express)
- `backend/db/schema.sql` (PostgreSQL tables)
- `frontend/src/styles/tokens.css` (design system colors)
- `.env.example` (frontend + backend)
- Draft `README.md`
- Initial `.gitignore` and `LICENSE`

## Recommended repository structure

```text
scholarship-network/
├── frontend/                       # deployed to GitHub Pages
│   ├── public/
│   │   ├── geo/
│   │   │   └── world.geojson        # world map data (Day 3)
│   │   └── favicon.svg
│   ├── src/
│   │   ├── api/
│   │   │   └── client.js            # fetch wrapper + base URL
│   │   ├── components/
│   │   │   ├── auth/                # Login/Register (Day 2)
│   │   │   ├── map/                 # Interactive map (Day 3)
│   │   │   ├── popups/              # Dual popup system (Day 3)
│   │   │   ├── chat/                # Chat widget (Day 4)
│   │   │   └── admin/               # Admin panel (Day 5)
│   │   ├── pages/
│   │   ├── styles/
│   │   │   └── tokens.css           # design system variables
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── backend/                        # deployed to Render/Railway
│   ├── src/
│   │   ├── config/
│   │   │   └── db.js                # PostgreSQL pool
│   │   ├── middleware/
│   │   │   ├── auth.js              # JWT guard (Day 2)
│   │   │   └── rateLimit.js         # rate limiting (Day 4/5)
│   │   ├── routes/
│   │   │   ├── auth.routes.js       # (Day 2)
│   │   │   ├── users.routes.js      # (Day 3)
│   │   │   ├── scholarships.routes.js # (Day 4)
│   │   │   ├── chat.routes.js       # (Day 4)
│   │   │   └── admin.routes.js      # (Day 5)
│   │   ├── services/
│   │   │   ├── mailer.js            # SMTP relay (Day 4)
│   │   │   └── scheduler.js         # cron 24h (Day 4)
│   │   ├── db/
│   │   │   ├── schema.sql
│   │   │   └── seed.sql
│   │   └── app.js                   # Express bootstrap
│   ├── server.js
│   └── package.json
├── .github/
│   └── workflows/
│       └── deploy-frontend.yml      # Pages deploy (Day 5)
├── .env.example
├── .gitignore
├── README.md
└── LICENSE
```

## Workday outcome

By the end of Monday the repository should clone cleanly, both the frontend dev server and the backend API server should start locally, the PostgreSQL schema should apply without errors, and the brand colors should be available as CSS variables. No feature logic yet — only a solid, reproducible skeleton.

## Step-by-step exercises

### 1. Create the repository skeleton

From the repository root:

```bash
mkdir -p frontend/public/geo frontend/src/{api,components,pages,styles}
mkdir -p backend/src/{config,middleware,routes,services,db}
mkdir -p .github/workflows
touch README.md .env.example .gitignore LICENSE
```

Add this starter `.gitignore`:

```gitignore
# dependencies
node_modules/
# env / secrets
.env
.env.local
# build output
frontend/dist/
# logs
*.log
npm-debug.log*
# os
.DS_Store
```

### 2. Scaffold the frontend (Vite + React)

```bash
cd frontend
npm create vite@latest . -- --template react
npm install
npm install leaflet react-leaflet   # map (used Day 3)
```

Configure `vite.config.js` so the app works when served from a GitHub Pages subpath (`https://<user>.github.io/<repo>/`):

```js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // IMPORTANT for GitHub Pages project sites: must match the repo name.
  base: "/scholarship-network/",
});
```

Add a tiny API client that reads the backend URL from an env variable (`frontend/src/api/client.js`):

```js
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export async function api(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error((await res.json()).error || res.statusText);
  return res.json();
}
```

### 3. Scaffold the backend (Node.js + Express)

```bash
cd ../backend
npm init -y
npm install express cors dotenv pg
npm install -D nodemon
```

Create `backend/src/app.js`:

```js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";

dotenv.config();
const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(
  cors({
    origin: process.env.FRONTEND_ORIGIN?.split(",") || "*",
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Routes are mounted here on later days:
// app.use("/auth", authRoutes);        // Day 2
// app.use("/users", usersRoutes);      // Day 3
// app.use("/scholarships", scholarshipRoutes); // Day 4
// app.use("/chat", chatRoutes);        // Day 4
// app.use("/admin", adminRoutes);      // Day 5

export default app;
```

Create `backend/server.js`:

```js
import app from "./src/app.js";
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`API running on :${PORT}`));
```

Add `"type": "module"` and scripts to `backend/package.json`:

```json
{
  "type": "module",
  "scripts": {
    "dev": "nodemon server.js",
    "start": "node server.js"
  }
}
```

### 4. Define the database schema

Create `backend/src/db/schema.sql`. This encodes the User model from the spec plus the scholarship, chat, and admin tables:

```sql
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email             VARCHAR(255) UNIQUE NOT NULL,
  password_hash     TEXT NOT NULL,
  totp_enabled      BOOLEAN NOT NULL DEFAULT FALSE,
  totp_secret       TEXT,
  profile_photo_url TEXT,
  first_name        VARCHAR(80) NOT NULL,
  last_name         VARCHAR(80) NOT NULL,
  city_origin       VARCHAR(120),
  state_origin      VARCHAR(120),
  current_country   VARCHAR(120),
  current_city      VARCHAR(120),
  status            VARCHAR(20) CHECK (status IN ('working','studying')),
  institution_company VARCHAR(160),
  phone_number      VARCHAR(30),
  phone_country_code VARCHAR(8),
  is_active         BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_users_country ON users (current_country);

-- Defined before scholarships because scholarships.created_by references it.
CREATE TABLE admins (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  totp_secret   TEXT
);

CREATE TABLE scholarships (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_name VARCHAR(200) NOT NULL,
  country         VARCHAR(120) NOT NULL,
  category        VARCHAR(20) CHECK (category IN ('high_school','university')),
  areas           TEXT[],
  start_date      DATE,
  end_date        DATE,
  link            TEXT,
  description     TEXT,
  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','inactive')),
  -- Provenance: distinguishes admin-typed entries from API-imported ones.
  source          VARCHAR(20) NOT NULL DEFAULT 'manual'
                  CHECK (source IN ('manual','api')),
  created_by      UUID REFERENCES admins(id), -- NULL for API rows
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_scholarships_country ON scholarships (country);

-- Dedupe ONLY automated imports. Manual entries (internal scholarships,
-- API gaps) are intentionally left unconstrained so an admin can add several
-- programs for the same institution/country/category and remove them later.
CREATE UNIQUE INDEX uq_scholarship_api
  ON scholarships (institution_name, country, category)
  WHERE source = 'api';

CREATE TABLE chats (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  receiver_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_chats_pair ON chats (sender_id, receiver_id, created_at);

-- Audit log for login attempts and admin actions (security requirement)
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor      VARCHAR(255),
  action     VARCHAR(120) NOT NULL,
  ip         VARCHAR(64),
  detail     JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Create the PostgreSQL connection pool `backend/src/config/db.js`:

```js
import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});
```

Apply the schema against a local database:

```bash
createdb scholarship_dev
psql scholarship_dev -f src/db/schema.sql
```

### 5. Encode the design system

Create `frontend/src/styles/tokens.css` from the color rules in the context:

```css
:root {
  /* Brand palette */
  --color-primary:   #0B4F81; /* Deep Blue  – primary buttons, active country */
  --color-secondary: #3A79B4; /* Medium Blue – secondary buttons, links */
  --color-accent:    #A8C8E6; /* Light Blue  – hover, highlights */

  /* Neutrals */
  --color-bg:        #FFFFFF;
  --color-surface:   #F5F5F5; /* cards, sections */
  --color-border:    #E6E6E6;
  --color-disabled:  #E6E6E6;

  /* Text */
  --color-text:      #1A1A1A;
  --color-text-muted:#5A5A5A;

  /* Radius & spacing */
  --radius: 10px;
  --space:  8px;
}

.btn-primary   { background: var(--color-primary);   color: #fff; }
.btn-secondary { background: var(--color-secondary);  color: #fff; }
.btn:disabled  { background: var(--color-disabled);   color: var(--color-text-muted); }
```

Import it once in `frontend/src/main.jsx`:

```js
import "./styles/tokens.css";
```

### 6. Document environment variables

Create `.env.example` (never commit the real `.env`):

```text
# ---- backend ----
PORT=4000
DATABASE_URL=postgres://user:password@localhost:5432/scholarship_dev
DATABASE_SSL=false
FRONTEND_ORIGIN=http://localhost:5173
JWT_SECRET=change_me_to_a_long_random_string
# SMTP (Day 4)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=juventudes@gtoxmundo.com
# Scholarship source (Day 4)
SCHOLARSHIP_API_URL=

# ---- frontend (Vite) ----
VITE_API_URL=http://localhost:4000
```

### 7. Start the README

Add these sections to `README.md`:

```markdown
# Scholarship Social Network

Spanish-first platform for scholarship students to create verified profiles,
discover scholarships by country on an interactive map, and connect via chat.

## Architecture
- Frontend: React (Vite), deployed to GitHub Pages.
- Backend: Node.js + Express REST API, deployed to Render/Railway.
- Database: PostgreSQL.
- Auth: JWT + bcrypt + optional TOTP 2FA.

## Local development
1. Copy `.env.example` to `.env` and fill values.
2. Backend: `cd backend && npm install && npm run dev`.
3. Frontend: `cd frontend && npm install && npm run dev`.
4. Apply schema: `psql scholarship_dev -f backend/src/db/schema.sql`.
```

## Validation checklist

- [ ] `frontend/` and `backend/` scaffolds exist and install without errors.
- [ ] `npm run dev` starts the frontend (default `:5173`).
- [ ] `npm run dev` starts the backend and `GET /health` returns `{ "status": "ok" }`.
- [ ] `schema.sql` applies to a fresh PostgreSQL database with no errors.
- [ ] `tokens.css` is imported and brand variables render.
- [ ] `.env` is git-ignored; only `.env.example` is committed.

## Security and reproducibility notes

- Never commit `.env`, credentials, or the real `JWT_SECRET`.
- `vite.config.js` `base` **must** equal the GitHub repo name or the deployed SPA will 404 on assets.
- Keep the schema in version control; treat it as the single source of truth for the data model.
- Lock CORS to your GitHub Pages origin before production (do not ship `origin: "*"`).
