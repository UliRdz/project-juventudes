// src/components/popups/DualPopup.jsx
// PURPOSE: The dual panel that opens when a country is clicked. LEFT = scholarships
// for that country, split into Preparatoria (high_school) and Universidad
// (university). RIGHT = students currently in that country, each with a Chat button.
// INTENDED OUTPUT LINK: this is where the two Day 3 API endpoints become visible
// product. The Chat button calls onChat(user), which Day 4 wires to the chat widget.
//
// CHANGE (photo release): the user card's avatar now goes through mediaUrl(). The
// API returns profile_photo_url as a RELATIVE path ("/uploads/ab12.jpg") because
// that is what backend/src/services/photos.js stores. Rendering it raw made the
// browser ask GitHub Pages for a file that only exists on the Render backend, so
// every avatar silently fell back to the placeholder. mediaUrl() prefixes the API
// origin, which is what finally makes an uploaded photo visible here — including
// on the card whose Chat button opens a conversation.

import { useEffect, useState } from "react";      // State for the two data lists + loading/error flags.
import { api, mediaUrl } from "../../api/client";  // Shared fetch wrapper + the stored-path -> loadable-URL resolver.

export default function DualPopup({ country, onClose, onChat }) { // Props: which country, how to close, what to do on Chat.
  const [scholarships, setScholarships] = useState([]); // Left-panel data (defaults to an empty array so .filter is safe).
  const [users, setUsers] = useState([]);               // Right-panel data.
  const [loading, setLoading] = useState(false);        // True while both requests are in flight.
  const [error, setError] = useState("");               // Message if either request fails.

  useEffect(() => {                                     // Re-run whenever the selected country changes.
    if (!country) return;                               // Nothing selected -> nothing to fetch.

    const token = localStorage.getItem("token");        // Read the JWT saved at login; both endpoints require it.
    setLoading(true);                                   // Show the loading state.
    setError("");                                       // Clear any error from a previous country.

    // encodeURIComponent protects names containing spaces or punctuation, e.g.
    // "United States of America" or "Côte d'Ivoire", which would otherwise break the URL.
    const q = encodeURIComponent(country);              // The safely-encoded country name for the query string.

    // Promise.all runs both requests in parallel (faster than awaiting one then the other).
    Promise.all([
      api(`/scholarships?country=${q}`, { token }),      // LEFT panel: active scholarships in this country.
      api(`/users?country=${q}`, { token }),             // RIGHT panel: other students in this country.
    ])
      .then(([sch, usr]) => {                            // Destructure the two results in request order.
        setScholarships(sch);                            // Populate the left panel.
        setUsers(usr);                                   // Populate the right panel.
      })
      .catch((e) => setError(e.message))                 // 401 (expired token) or network error -> show the message.
      .finally(() => setLoading(false));                 // Always clear the loading flag, success or failure.
  }, [country]);                                         // Dependency: refetch when the user clicks a different country.

  // Split the single scholarships array into the two sections the spec requires.
  const hs = scholarships.filter((s) => s.category === "high_school"); // Preparatoria entries.
  const uni = scholarships.filter((s) => s.category === "university"); // Universidad entries.

  return (                                               // The popup UI.
    <div className="dual-popup">                         {/* Two-column layout styled in tokens.css. */}
      <button className="popup-close" onClick={onClose} aria-label="Cerrar">×</button> {/* Close control returns to the map. */}

      {loading && <p>Cargando…</p>}                      {/* Loading indicator while both fetches run. */}
      {error && <p style={{ color: "crimson" }}>{error}</p>} {/* Error message if a request failed. */}

      {/* ---------------- LEFT PANEL: scholarships ---------------- */}
      <section className="panel-left">                   {/* Scrollable column (overflow set in CSS). */}
        <h3>Preparatoria</h3>                            {/* Section heading for high_school entries. */}
        {hs.length === 0 && !loading && <p className="muted">Sin becas registradas.</p>} {/* Empty-state message. */}
        {hs.map((s) => <ScholarshipCard key={s.id} s={s} />)} {/* One card per high-school scholarship; key = stable id. */}

        <h3>Universidad</h3>                             {/* Section heading for university entries. */}
        {uni.length === 0 && !loading && <p className="muted">Sin becas registradas.</p>} {/* Empty-state message. */}
        {uni.map((s) => <ScholarshipCard key={s.id} s={s} />)} {/* One card per university scholarship. */}
      </section>

      {/* ---------------- RIGHT PANEL: users --------------------- */}
      <section className="panel-right">                  {/* Scrollable column of student cards. */}
        <h3>Estudiantes en {country}</h3>                {/* Heading naming the selected country. */}
        {users.length === 0 && !loading && (             // If nobody has this country set...
          <p className="muted">Aún no hay estudiantes registrados aquí.</p> // ...explain the empty panel.
        )}
        {users.map((u) => (                              // Render one card per user.
          <div className="user-card" key={u.id}>         {/* key = user id so React tracks rows efficiently. */}
            <img
              src={mediaUrl(u.profile_photo_url, `${import.meta.env.BASE_URL}favicon.svg`)} // mediaUrl() prefixes the backend origin, so "/photos/<id>?v=..." resolves against Render and not against github.io; the second argument is the brand-mark fallback for users with no photo.
              alt=""                                     // Decorative image: empty alt keeps screen readers from reading noise.
              className="avatar"                         // CSS makes it a circle (per the spec).
              onError={(e) => {                          // CHANGE (this patch): a 404 (legacy /uploads path, or a photo since removed)...
                e.currentTarget.src = `${import.meta.env.BASE_URL}favicon.svg`; // ...falls back to the placeholder rather than a broken-image icon.
              }}
            />
            <div className="user-info">                  {/* Text block beside the avatar. */}
              <strong>{u.first_name} {u.last_name}</strong> {/* Full name. */}
              <p className="muted">{u.current_city}</p>  {/* City within the selected country. */}
              <p className="muted">{u.email}</p>         {/* Contact email (public-safe field from the API). */}
            </div>
            {/* Passing the WHOLE user object (photo included) is what lets ChatWidget
                render the same avatar in its header without a second API call. */}
            <button className="btn btn-secondary" onClick={() => onChat(u)}>Chat</button> {/* Hands this user to the Day 4 chat widget. */}
          </div>
        ))}
      </section>
    </div>
  );                                                     // End returned JSX.
}                                                        // End DualPopup component.

// Small presentational component for one scholarship entry. Kept in this file
// because it is only ever used here.
function ScholarshipCard({ s }) {                        // Receives one scholarship row from the API.
  return (
    <div className="scholarship-card">                   {/* Card container styled in tokens.css. */}
      <strong>{s.institution_name}</strong>              {/* Institution name = the card title. */}
      {s.areas?.length > 0 && <p className="muted">{s.areas.join(", ")}</p>} {/* Study areas, comma-joined; hidden if empty. */}
      <p className="muted">{s.start_date?.slice(0, 10)} → {s.end_date?.slice(0, 10)}</p> {/* Application window; slice trims the time part of the timestamp. */}
      <span className={s.status === "active" ? "badge-active" : "badge-inactive"}> {/* Colored status badge. */}
        {s.status === "active" ? "Activa" : "Inactiva"}  {/* Spanish-first label for the status. */}
      </span>
      {s.link && (                                       // Only render the link if one exists.
        <a href={s.link} target="_blank" rel="noreferrer">Aplicar</a> // rel="noreferrer" is a security best practice for target="_blank".
      )}
    </div>
  );                                                     // End card JSX.
}                                                        // End ScholarshipCard.
