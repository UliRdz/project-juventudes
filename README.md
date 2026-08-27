# Scholarship Social Network

Spanish-first platform for scholarship students to create verified profiles,
discover scholarships by country on an interactive map, and connect via chat.

## Architecture

- **Frontend:** React (Vite), deployed to GitHub Pages.
- **Backend:** Node.js + Express REST API, deployed to Render/Railway.
- **Database:** PostgreSQL.
- **Auth:** JWT + bcrypt + optional TOTP 2FA (added Day 2).

## Repository structure

- `frontend/` - the static single-page app served by GitHub Pages.
- `backend/` - the Express API and PostgreSQL schema, hosted externally.
- `.env.example` - template of all required environment variables.

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
   createdb scholarship_dev
   psql scholarship_dev -f backend/src/db/schema.sql
   # optional demo data:
   psql scholarship_dev -f backend/src/db/seed.sql
   ```
5. Open the frontend (default `http://localhost:5173`). The page should show
   **"Backend health: ok"**, proving the frontend reached the API.

## Dependency reference

Because `package.json` is JSON and cannot contain inline comments, each
dependency is documented here.

### Backend (`backend/package.json`)

| Package           | Why it's here                                                           |
| ----------------- | ----------------------------------------------------------------------- |
| `express`       | HTTP server and routing — the API framework.                           |
| `cors`          | Sends the CORS headers that let the GitHub Pages frontend call the API. |
| `dotenv`        | Loads`.env` values into `process.env` during local development.     |
| `pg`            | PostgreSQL driver used by`src/config/db.js`.                          |
| `nodemon` (dev) | Auto-restarts the server on file changes while developing.              |

### Frontend (`frontend/package.json`)

| Package                        | Why it's here                                          |
| ------------------------------ | ------------------------------------------------------ |
| `react`, `react-dom`       | The UI library and its browser renderer.               |
| `leaflet`                    | Map rendering engine (used by the Day 3 map).          |
| `react-leaflet`              | React bindings for Leaflet (v4.x pairs with React 18). |
| `vite` (dev)                 | Dev server and static build tool.                      |
| `@vitejs/plugin-react` (dev) | Enables JSX and hot-reload in Vite.                    |

## Scripts

- Backend: `npm run dev` (auto-reload) / `npm start` (production run).
- Frontend: `npm run dev` (local) / `npm run build` (static output in `dist/`) /
  `npm run preview` (serve the built bundle locally).

## Security notes

- Never commit `.env`, credentials, or the real `JWT_SECRET`.
- `vite.config.js` `base` **must** equal the GitHub repo name, or the deployed
  SPA will 404 on its assets.
- Lock CORS to your GitHub Pages origin before production (do not ship `origin: "*"`).
