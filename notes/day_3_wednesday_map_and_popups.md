# Wednesday Workday Plan: Interactive Map and Dual Popup System

## Objective

Build the core discovery experience: a **GeoJSON world map** with hover/active states, gated behind login, that opens a **dual popup** on country click — scholarships on the left, users in that country on the right — with a chat button that hands off to Day 4.

## Concepts to learn today

- Rendering vector world geography from **GeoJSON** with Leaflet.
- Driving per-feature styling (hover = light blue, active = deep blue) from state.
- **Access gating** on the client and enforcing it on the server.
- Filtering server data by a selected country and shaping it into UI cards.

## Deliverables covered

- `frontend/src/components/map/WorldMap.jsx`
- `frontend/src/components/popups/DualPopup.jsx`
- `backend/src/routes/scholarships.routes.js` (read endpoint)
- `backend/src/routes/users.routes.js` (users-by-country)
- Google Translate widget wired into the shell

## Workday outcome

By the end of Wednesday, a logged-in user sees a world map, hovers to highlight a country in light blue, clicks to select it in deep blue, and gets a dual panel: scrollable scholarships (High School / University) on the left and profile cards of users in that country on the right, each with a Chat button.

## Step-by-step exercises

### 1. Add world map data

Place a world countries file at `frontend/public/geo/world.geojson`. Each feature must expose a country name property (commonly `properties.name` or `properties.ADMIN`) so clicks can be matched to your `current_country` values. Normalize names consistently (decide on English or Spanish country names and stick to it across the DB and the GeoJSON).

### 2. Backend: read scholarships by country

`backend/src/routes/scholarships.routes.js`:

```js
import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

// Only active scholarships, grouped by category on the client.
router.get("/", requireAuth, async (req, res) => {
  const { country } = req.query;
  const { rows } = await pool.query(
    `SELECT id, institution_name, country, category, areas,
            start_date, end_date, link, status
     FROM scholarships
     WHERE status = 'active' AND ($1::text IS NULL OR country = $1)
     ORDER BY category, institution_name`,
    [country || null]
  );
  res.json(rows);
});

export default router;
```

### 3. Backend: users by country

`backend/src/routes/users.routes.js` — returns only public-safe fields:

```js
import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

router.get("/", requireAuth, async (req, res) => {
  const { country } = req.query;
  if (!country) return res.status(400).json({ error: "country is required" });
  const { rows } = await pool.query(
    `SELECT id, first_name, last_name, current_city, email, profile_photo_url
     FROM users
     WHERE current_country = $1 AND is_active = TRUE AND id <> $2
     ORDER BY first_name`,
    [country, req.user.sub]
  );
  res.json(rows);
});

export default router;
```

Mount both in `app.js`:

```js
import scholarshipRoutes from "./routes/scholarships.routes.js";
import usersRoutes from "./routes/users.routes.js";
app.use("/scholarships", scholarshipRoutes);
app.use("/users", usersRoutes);
```

### 4. Frontend: the interactive map

`frontend/src/components/map/WorldMap.jsx`:

```jsx
import { useEffect, useState } from "react";
import { MapContainer, GeoJSON, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";

const IDLE   = { fillColor: "#A8C8E6", weight: 1, color: "#3A79B4", fillOpacity: 0.4 };
const HOVER  = { fillColor: "#A8C8E6", weight: 2, color: "#3A79B4", fillOpacity: 0.7 };
const ACTIVE = { fillColor: "#0B4F81", weight: 2, color: "#0B4F81", fillOpacity: 0.8 };

export default function WorldMap({ isLoggedIn, onSelectCountry }) {
  const [geo, setGeo] = useState(null);
  const [active, setActive] = useState(null);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}geo/world.geojson`)
      .then((r) => r.json())
      .then(setGeo);
  }, []);

  function styleFor(feature) {
    const name = feature.properties.name || feature.properties.ADMIN;
    return name === active ? ACTIVE : IDLE;
  }

  function onEach(feature, layer) {
    const name = feature.properties.name || feature.properties.ADMIN;
    layer.on({
      mouseover: (e) => { if (name !== active) e.target.setStyle(HOVER); },
      mouseout:  (e) => { if (name !== active) e.target.setStyle(IDLE); },
      click: () => {
        if (!isLoggedIn) return alert("Inicia sesión para explorar países");
        setActive(name);
        onSelectCountry(name);
      },
    });
  }

  if (!geo) return <p>Cargando mapa…</p>;

  return (
    <MapContainer center={[20, 0]} zoom={2} style={{ height: "70vh" }}>
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <GeoJSON key={active} data={geo} style={styleFor} onEachFeature={onEach} />
    </MapContainer>
  );
}
```

> The `key={active}` forces Leaflet to re-apply styles when the active country changes. The click handler blocks interaction when `isLoggedIn` is false — but remember the **server also requires a valid JWT**, so gating is enforced on both sides.

### 5. Frontend: the dual popup

`frontend/src/components/popups/DualPopup.jsx`:

```jsx
import { useEffect, useState } from "react";
import { api } from "../../api/client";

export default function DualPopup({ country, onClose, onChat }) {
  const [scholarships, setScholarships] = useState([]);
  const [users, setUsers] = useState([]);
  const token = localStorage.getItem("token");

  useEffect(() => {
    if (!country) return;
    api(`/scholarships?country=${encodeURIComponent(country)}`, { token }).then(setScholarships);
    api(`/users?country=${encodeURIComponent(country)}`, { token }).then(setUsers);
  }, [country]);

  const hs = scholarships.filter((s) => s.category === "high_school");
  const uni = scholarships.filter((s) => s.category === "university");

  return (
    <div className="dual-popup">
      <button onClick={onClose}>×</button>

      <section className="panel-left">
        <h3>Preparatoria</h3>
        {hs.map((s) => <ScholarshipCard key={s.id} s={s} />)}
        <h3>Universidad</h3>
        {uni.map((s) => <ScholarshipCard key={s.id} s={s} />)}
      </section>

      <section className="panel-right">
        <h3>Estudiantes en {country}</h3>
        {users.map((u) => (
          <div className="user-card" key={u.id}>
            <img src={u.profile_photo_url} alt="" className="avatar" />
            <div>
              <strong>{u.first_name} {u.last_name}</strong>
              <p>{u.current_city}</p>
              <p>{u.email}</p>
            </div>
            <button className="btn btn-secondary" onClick={() => onChat(u)}>Chat</button>
          </div>
        ))}
      </section>
    </div>
  );
}

function ScholarshipCard({ s }) {
  return (
    <div className="scholarship-card">
      <strong>{s.institution_name}</strong>
      <p>{(s.areas || []).join(", ")}</p>
      <p>{s.start_date} → {s.end_date}</p>
      <span className={s.status === "active" ? "badge-active" : "badge-inactive"}>{s.status}</span>
      {s.link && <a href={s.link} target="_blank" rel="noreferrer">Aplicar</a>}
    </div>
  );
}
```

### 6. Google Translate widget (English support)

Add to `frontend/index.html` so the Spanish-first UI can be translated on demand:

```html
<div id="google_translate_element"></div>
<script type="text/javascript">
  function googleTranslateElementInit() {
    new google.translate.TranslateElement(
      { pageLanguage: "es", includedLanguages: "en,es" },
      "google_translate_element"
    );
  }
</script>
<script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit"></script>
```

### 7. Wire it together

In `App.jsx`, render `WorldMap` and, when a country is selected, mount `DualPopup`. Pass an `onChat(user)` callback that stores the target user and (tomorrow) opens the chat widget.

## Validation checklist

- [ ] The map renders from `world.geojson`.
- [ ] Hover highlights light blue; the selected country stays deep blue.
- [ ] A logged-out click is blocked on the client **and** rejected by the API (401).
- [ ] Clicking a country loads scholarships split into Preparatoria / Universidad.
- [ ] The right panel lists users whose `current_country` matches, excluding the viewer.
- [ ] Each user card shows photo, name, city, email, and a Chat button.
- [ ] The Google Translate widget switches the UI between Spanish and English.

## Security and reproducibility notes

- Client-side gating is a UX convenience, not security — the **API must require a JWT** on `/scholarships` and `/users`.
- Return only public-safe user fields; never expose `password_hash`, `totp_secret`, or phone numbers in the country list.
- Keep country-name normalization identical between the GeoJSON `properties` and the `users.current_country` / `scholarships.country` columns, or filtering silently returns nothing.
- Consider paginating the users-by-country endpoint before launch to keep payloads small.
