// src/components/admin/ScholarshipForm.jsx
// PURPOSE: The admin form for typing in a scholarship by hand — internal programs
// or ones the external API doesn't cover.
// INTENDED OUTPUT LINK: posts to POST /scholarships, which stamps the row
// source='manual'. That stamp is what makes the nightly refresh skip it, so a
// hand-entered scholarship survives every update and can be deleted later.
// The country field is a <select> fed by the SAME generated list the map uses, so
// a manual entry can never drift from the GeoJSON names (the Day 3 gotcha).
//
// CHANGE (photo release): the component now serves TWO jobs. Passing an `initial`
// row switches it to EDIT mode, where it issues PUT /scholarships/:id instead of
// POST /scholarships. That backend route already existed but nothing in the UI
// ever called it, so an admin could only create or delete a scholarship — never
// correct a typo, extend a deadline, or flip one inactive. Reusing this form
// rather than writing a second one guarantees both paths share exactly the same
// field list, the same country dropdown and the same date/areas conversions.

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

// Convert an API row into the shape this form edits. Two conversions matter:
// `areas` arrives as a TEXT[] array but is typed as comma-separated text, and the
// dates arrive as full timestamps ("2026-03-01T00:00:00.000Z") which <input
// type="date"> refuses — it only accepts a bare YYYY-MM-DD, so we slice.
function fromRow(row) {                            // row = one scholarship object from GET /scholarships.
  return {
    institution_name: row.institution_name || "",  // Straight copy.
    country: row.country || "",                    // Must still match a COUNTRIES entry for the dropdown to show it.
    category: row.category || "university",        // Falls back to the default section.
    areas: (row.areas || []).join(", "),           // Array -> "Ingeniería, Ciencias" so the same text input works.
    start_date: (row.start_date || "").slice(0, 10), // Timestamp -> "YYYY-MM-DD" for the native date picker.
    end_date: (row.end_date || "").slice(0, 10),   // Same slice for the closing date.
    link: row.link || "",                          // Straight copy.
    description: row.description || "",            // Straight copy.
    status: row.status || "active",                // Straight copy.
  };
}                                                  // End fromRow.

export default function ScholarshipForm({ token, initial, onSaved, onCancelEdit }) { // token = ADMIN token; initial = row to edit (or null/undefined to create); onSaved refreshes the list; onCancelEdit leaves edit mode.
  const isEdit = Boolean(initial?.id);              // One flag decides the endpoint, the HTTP method, the heading and the button labels.
  const [f, setF] = useState(isEdit ? fromRow(initial) : EMPTY); // Pre-fill when editing, start blank when creating. AdminPanel remounts this component (via `key`) whenever the selection changes, which is what re-runs this initializer.
  const [error, setError] = useState("");           // Validation/server error to display.
  const [msg, setMsg] = useState("");               // Success confirmation.
  const [busy, setBusy] = useState(false);          // Disables the submit button while a request is in flight.

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); // Helper: build an onChange updater for field k.

  async function save() {                           // Runs on "Guardar beca" / "Guardar cambios".
    setError("");                                   // Clear previous messages.
    setMsg("");
    setBusy(true);                                  // Lock the button (prevents a duplicate row from a double click).
    try {
      const body = {                                // Shared payload for both create and edit.
        ...f,                                       // All the typed fields...
        // Convert the comma-separated text into the TEXT[] array the column expects.
        areas: f.areas.split(",").map((s) => s.trim()).filter(Boolean), // Trim each and drop empties.
        // Send null rather than "" for optional dates: Postgres rejects "" as a DATE.
        start_date: f.start_date || null,           // Empty string -> null.
        end_date: f.end_date || null,               // Empty string -> null.
      };

      const saved = isEdit
        ? await api(`/scholarships/${initial.id}`, { method: "PUT", token, body })  // EDIT: replaces the row's editable fields and touches updated_at. Note the backend deliberately does NOT let `source` change, so an API row stays an API row.
        : await api("/scholarships", { method: "POST", token, body });              // CREATE: the backend hard-codes source='manual' + created_by.

      setMsg(isEdit ? `Beca actualizada: ${saved.institution_name}` : `Beca guardada: ${saved.institution_name}`); // Confirm with the saved name and the action taken.
      if (!isEdit) setF(EMPTY);                     // Only reset when creating; after an edit the fields should keep showing what was saved.
      onSaved?.(saved);                             // Tell the parent to refresh its list (and leave edit mode).
    } catch (e) {
      setError(e.message);                          // Show the server's validation message (e.g. "invalid category", "Scholarship not found").
    } finally {
      setBusy(false);                               // Unlock the button either way.
    }
  }

  return (
    <div className="card">
      <h3>{isEdit ? "Editar beca" : "Agregar beca (entrada manual)"}</h3> {/* Heading tells the admin which mode the form is in. */}

      {isEdit && (                                                        // Only in edit mode...
        <p className="muted">
          Editando: {initial.institution_name} · {initial.country}         {/* ...name the row being changed, so it is never ambiguous which card this form belongs to. */}
          {initial.source === "api" && " · origen API"}                    {/* Warns that this row came from the importer: the nightly refresh may overwrite these edits. */}
        </p>
      )}

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

      {/* Visibility switch. It exists in both modes but only matters when editing:
          flipping a scholarship to "Inactiva" hides it from students immediately,
          which is the softer alternative to deleting it. */}
      <label className="muted">Estado</label>                        {/* Label for the status select. */}
      <select value={f.status} onChange={set("status")}>             {/* Constrained to the two DB-allowed values. */}
        <option value="active">Activa (visible para estudiantes)</option>   {/* -> status = 'active'; GET /scholarships returns only these. */}
        <option value="inactive">Inactiva (oculta)</option>                 {/* -> status = 'inactive'; stays in the database but disappears from the map. */}
      </select>

      <div className="row-actions">                                  {/* Button strip so Guardar and Cancelar sit on one line. */}
        <button className="btn btn-primary" onClick={save} disabled={busy}> {/* Submit; label depends on the mode. */}
          {busy ? "Guardando…" : isEdit ? "Guardar cambios" : "Guardar beca"}
        </button>
        {isEdit && (                                                 // Only edit mode needs a way out...
          <button className="btn btn-secondary" onClick={() => onCancelEdit?.()}>Cancelar edición</button> // ...which returns the form to blank "create" mode.
        )}
      </div>

      {msg && <p style={{ color: "green" }}>{msg}</p>}      {/* Success feedback. */}
      {error && <p style={{ color: "crimson" }}>{error}</p>} {/* Error feedback. */}
    </div>
  );
}
