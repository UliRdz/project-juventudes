// src/components/auth/Profile.jsx
// PURPOSE: Let a logged-in user set their location and profile details.
// INTENDED OUTPUT LINK: this is the missing link between registration (Day 2) and
// the map (Day 3). Registration only collects email/password/name, so until a user
// sets current_country here they appear in NO country panel. The country field is a
// <select> driven by the generated COUNTRIES list, which guarantees the saved value
// matches the map's GeoJSON name exactly — free text would silently break filtering.

import { useState } from "react";                    // State for the form fields and status messages.
import { api } from "../../api/client";               // Shared backend fetch wrapper.
import { COUNTRIES } from "../../data/countries";     // Generated from world.geojson: the ONLY valid country strings.

export default function Profile({ user, onSaved }) {  // Props: the current user, and a callback after a successful save.
  const [form, setForm] = useState({                  // Pre-fill the form with whatever the user already has.
    current_country: user?.current_country || "",     // Country (drives map placement); "" means "not set yet".
    current_city: user?.current_city || "",           // City shown on the user card.
    city_origin: user?.city_origin || "",             // Hometown city.
    state_origin: user?.state_origin || "",           // Hometown state.
    status: user?.status || "studying",               // 'studying' or 'working' (matches the DB CHECK constraint).
    institution_company: user?.institution_company || "", // Where they study/work.
  });
  const [msg, setMsg] = useState("");                 // Success message after saving.
  const [error, setError] = useState("");             // Error message if the save fails.

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value }); // Helper: build an onChange handler for field k.

  async function save() {                             // Runs when the user clicks "Guardar".
    setMsg("");                                       // Clear previous messages before the attempt.
    setError("");
    try {
      const token = localStorage.getItem("token");    // The JWT; PATCH /users/me is a protected route.
      const updated = await api("/users/me", {        // Send only the editable fields (server whitelists them again).
        method: "PATCH",                              // PATCH = partial update of the existing record.
        token,                                        // Attach the Bearer token so the server knows who to update.
        body: form,                                   // The form values.
      });
      setMsg("Perfil guardado.");                     // Confirm to the user (Spanish-first).
      onSaved?.(updated);                             // Let the parent refresh its copy of the user (optional callback).
    } catch (e) {
      setError(e.message);                            // Show the backend's message (e.g. "Invalid field value").
    }
  }                                                   // End save.

  return (
    <div className="card">
      <p className="muted">
        Selecciona tu país para aparecer en el mapa.   {/* Explains WHY this matters: it controls map visibility. */}
      </p>

      <select value={form.current_country} onChange={set("current_country")}> {/* Controlled dropdown, not free text. */}
        <option value="">País actual…</option>        {/* Placeholder option for the unset state. */}
        {COUNTRIES.map((c) => (                       // One option per country from the generated list...
          <option key={c} value={c}>{c}</option>      // ...value is the exact GeoJSON name, so map clicks will match.
        ))}
      </select>

      <input placeholder="Ciudad actual" value={form.current_city} onChange={set("current_city")} />       {/* Shown on the card. */}
      <input placeholder="Ciudad de origen" value={form.city_origin} onChange={set("city_origin")} />      {/* Hometown city. */}
      <input placeholder="Estado de origen" value={form.state_origin} onChange={set("state_origin")} />    {/* Hometown state. */}

      <select value={form.status} onChange={set("status")}>  {/* Constrained to the two DB-allowed values. */}
        <option value="studying">Estudiando</option>          {/* Maps to status = 'studying'. */}
        <option value="working">Trabajando</option>           {/* Maps to status = 'working'. */}
      </select>

      <input
        placeholder="Institución / Empresa"                    // Where they study or work.
        value={form.institution_company}
        onChange={set("institution_company")}
      />

      <button className="btn btn-primary" onClick={save}>Guardar</button> {/* Primary action -> save(). */}
      {msg && <p style={{ color: "green" }}>{msg}</p>}         {/* Success feedback. */}
      {error && <p style={{ color: "crimson" }}>{error}</p>}   {/* Failure feedback. */}
    </div>
  );                                                           // End JSX.
}                                                              // End Profile component.
