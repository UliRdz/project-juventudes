// src/components/admin/ScholarshipForm.jsx
// PURPOSE: The admin form for typing in a scholarship by hand — internal programs
// or ones the external API doesn't cover.
// INTENDED OUTPUT LINK: posts to POST /scholarships, which stamps the row
// source='manual'. That stamp is what makes the nightly refresh skip it, so a
// hand-entered scholarship survives every update and can be deleted later.
// The country field is a <select> fed by the SAME generated list the map uses, so
// a manual entry can never drift from the GeoJSON names (the Day 3 gotcha).

import { useState } from "react";                 // Local state for the form fields and messages.
import { api } from "../../api/client";            // Shared fetch wrapper.
import { COUNTRIES } from "../../data/countries";  // Generated from world.geojson: the only valid country strings.

const EMPTY = {                                    // The blank form, reused for reset after a successful save.
  institution_name: "",                            // Card title.
  country: "",                                     // Must match a GeoJSON country name exactly.
  category: "university",                          // Defaults to the Universidad section.
  areas: "",                                       // Comma-separated text, split into an array on submit.
  start_date: "",                                  // Application window start.
  end_date: "",                                    // Application window end.
  link: "",                                        // External apply URL.
  description: "",                                 // Longer details.
  status: "active",                                // Visible by default.
};

export default function ScholarshipForm({ token, onSaved }) { // token = the ADMIN token; onSaved refreshes the list.
  const [f, setF] = useState(EMPTY);                // Current form values.
  const [error, setError] = useState("");           // Validation/server error to display.
  const [msg, setMsg] = useState("");               // Success confirmation.

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); // Helper: build an onChange updater for field k.

  async function save() {                           // Runs on "Guardar beca".
    setError("");                                   // Clear previous messages.
    setMsg("");
    try {
      const saved = await api("/scholarships", {    // POST creates the manual entry (admin-only route).
        method: "POST",
        token,                                      // Admin Bearer token; a user token gets 403 here.
        body: {
          ...f,                                     // All the typed fields...
          // Convert the comma-separated text into the TEXT[] array the column expects.
          areas: f.areas.split(",").map((s) => s.trim()).filter(Boolean), // Trim each and drop empties.
          // Send null rather than "" for optional dates: Postgres rejects "" as a DATE.
          start_date: f.start_date || null,         // Empty string -> null.
          end_date: f.end_date || null,             // Empty string -> null.
        },
      });
      setMsg(`Beca guardada: ${saved.institution_name}`); // Confirm with the saved name.
      setF(EMPTY);                                  // Reset the form so the next entry starts clean.
      onSaved?.(saved);                             // Tell the parent to refresh its list.
    } catch (e) {
      setError(e.message);                          // Show the server's validation message (e.g. "invalid category").
    }
  }

  return (
    <div className="card">
      <h3>Agregar beca (entrada manual)</h3>       {/* Makes clear this is the hand-entered path. */}

      <input placeholder="Institución" value={f.institution_name} onChange={set("institution_name")} /> {/* Required. */}

      <select value={f.country} onChange={set("country")}>          {/* Controlled dropdown, never free text. */}
        <option value="" disabled>País…</option>                    {/* Placeholder for the unset state. */}
        {COUNTRIES.map((c) => (                                     // One option per known country...
          <option key={c} value={c}>{c}</option>                    // ...value is the exact GeoJSON name.
        ))}
      </select>

      <select value={f.category} onChange={set("category")}>        {/* Which panel section it appears under. */}
        <option value="high_school">Preparatoria</option>           {/* -> category = 'high_school'. */}
        <option value="university">Universidad</option>             {/* -> category = 'university'. */}
      </select>

      <input placeholder="Áreas (separadas por coma)" value={f.areas} onChange={set("areas")} /> {/* Split into an array on save. */}

      <label className="muted">Inicio de aplicación</label>          {/* Label clarifies what the date is for. */}
      <input type="date" value={f.start_date} onChange={set("start_date")} /> {/* Native date picker. */}

      <label className="muted">Fin de aplicación</label>             {/* Label for the closing date. */}
      <input type="date" value={f.end_date} onChange={set("end_date")} /> {/* The scheduler expires rows past this date. */}

      <input placeholder="Enlace (opcional)" value={f.link} onChange={set("link")} /> {/* "Aplicar" link on the card. */}

      <textarea placeholder="Descripción" value={f.description} onChange={set("description")} /> {/* Free-text details. */}

      <button className="btn btn-primary" onClick={save}>Guardar beca</button> {/* Submit. */}

      {msg && <p style={{ color: "green" }}>{msg}</p>}      {/* Success feedback. */}
      {error && <p style={{ color: "crimson" }}>{error}</p>} {/* Error feedback. */}
    </div>
  );
}
