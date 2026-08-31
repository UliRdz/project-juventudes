// src/components/auth/Profile.jsx
// PURPOSE: Let a logged-in user set their location and profile details.
// INTENDED OUTPUT LINK: this is the missing link between registration (Day 2) and
// the map (Day 3). Registration only collects email/password/name, so until a user
// sets current_country here they appear in NO country panel. The country field is a
// <select> driven by the generated COUNTRIES list, which guarantees the saved value
// matches the map's GeoJSON name exactly — free text would silently break filtering.
//
// CHANGE (photo release), three additions:
//   1. A real PHOTO UPLOAD control ("Cambiar foto") — previously the backend route
//      POST /auth/me/photo existed but nothing in the UI ever called it, so no user
//      could ever have an avatar. It now previews, validates 5MB/JPG/PNG client-side
//      and uploads, then hands the new URL up via onSaved() so App.jsx, DualPopup.jsx
//      and ChatWidget.jsx all re-render with the picture.
//   2. PRIVATE CONTACT fields (country code + phone). These are deliberately NOT in
//      GET /users (the public country panel), so only the owner and an administrator
//      can ever see them.
//   3. mediaUrl() is used for the preview so the relative "/uploads/..." path the
//      backend returns resolves against the API origin, not GitHub Pages.

import { useRef, useState } from "react";            // useState for form/status; useRef to trigger the hidden file input from a styled button.
import { api, upload, mediaUrl } from "../../api/client"; // api = JSON calls, upload = multipart photo POST, mediaUrl = path -> loadable URL.
import { COUNTRIES } from "../../data/countries";     // Generated from world.geojson: the ONLY valid country strings.

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;              // 5MB — mirrors the multer limit in backend/src/services/photos.js so we fail fast, before uploading.
const ALLOWED_TYPES = ["image/jpeg", "image/png"];    // JPG/PNG only — mirrors the backend fileFilter whitelist (spec requirement).

export default function Profile({ user, onSaved }) {  // Props: the current user, and a callback after a successful save.
  const [form, setForm] = useState({                  // Pre-fill the form with whatever the user already has.
    current_country: user?.current_country || "",     // Country (drives map placement); "" means "not set yet".
    current_city: user?.current_city || "",           // City shown on the user card.
    city_origin: user?.city_origin || "",             // Hometown city.
    state_origin: user?.state_origin || "",           // Hometown state.
    status: user?.status || "studying",               // 'studying' or 'working' (matches the DB CHECK constraint).
    institution_company: user?.institution_company || "", // Where they study/work.
    phone_country_code: user?.phone_country_code || "",   // NEW: dialing code, e.g. "+52" (users.phone_country_code, VARCHAR(8)).
    phone_number: user?.phone_number || "",               // NEW: phone digits (users.phone_number, VARCHAR(30)); private field.
  });
  const [msg, setMsg] = useState("");                 // Success message after saving.
  const [error, setError] = useState("");             // Error message if the save fails.

  // ---- Photo state (separate from `form` because it uploads on its own) ----
  const [photoUrl, setPhotoUrl] = useState(user?.profile_photo_url || ""); // The stored path/URL of the current avatar ("" = none yet).
  const [preview, setPreview] = useState("");         // A temporary blob: URL of the file just picked, shown before it is uploaded.
  const [busy, setBusy] = useState(false);            // True while the upload request is in flight (disables the button).
  const fileRef = useRef(null);                       // Ref to the hidden <input type="file"> so the styled button can open the file picker.

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value }); // Helper: build an onChange handler for field k.

  // ---- Photo picker: validate locally, preview instantly, then upload --------
  async function onPickPhoto(e) {                     // Runs when the user chooses a file in the OS dialog.
    const file = e.target.files?.[0];                 // Only one avatar at a time; take the first selected file.
    if (!file) return;                                // The user cancelled the dialog -> nothing to do.

    setMsg("");                                       // Clear stale messages before this attempt.
    setError("");

    if (!ALLOWED_TYPES.includes(file.type)) {         // Client-side type check (the backend re-checks; this just gives instant feedback).
      setError("La foto debe ser JPG o PNG.");        // Spanish-first error, same rule as the server.
      e.target.value = "";                            // Reset the input so picking the SAME bad file again still fires onChange.
      return;                                         // Stop: never upload a file we know will be rejected.
    }
    if (file.size > MAX_PHOTO_BYTES) {                // Client-side size check against the shared 5MB cap.
      setError("La foto no debe pesar más de 5 MB."); // Explains the limit in the user's own terms.
      e.target.value = "";                            // Reset the input as above.
      return;                                         // Stop before wasting the upload.
    }

    const localUrl = URL.createObjectURL(file);       // Make an in-memory URL for the chosen file...
    setPreview(localUrl);                             // ...and show it immediately, so the change feels instant while the request runs.

    setBusy(true);                                    // Disable the button and show "Subiendo…".
    try {
      const token = localStorage.getItem("token");    // POST /auth/me/photo is protected by requireAuth.
      const res = await upload("/auth/me/photo", file, { token }); // Multipart POST -> multer -> storeAndGetUrl() -> UPDATE users.profile_photo_url.
      setPhotoUrl(res.profile_photo_url);             // Store the SERVER path; this is what every other screen will read.
      setPreview("");                                 // Drop the temporary preview now that the real URL exists.
      URL.revokeObjectURL(localUrl);                  // Release the blob from memory (otherwise it leaks for the page's lifetime).
      setMsg("Foto actualizada.");                    // Confirm to the user.
      onSaved?.({ profile_photo_url: res.profile_photo_url }); // KEY LINK: pushes the new URL into App.jsx state, so the header avatar, the map's user card and the chat header all update without a reload.
    } catch (err) {
      setPreview("");                                 // Roll the preview back so the UI doesn't imply success.
      URL.revokeObjectURL(localUrl);                  // Still release the blob.
      setError(err.message);                          // Show the backend's reason ("Only JPG/PNG allowed", "File too large", 401...).
    } finally {
      setBusy(false);                                 // Re-enable the button either way.
      e.target.value = "";                            // Clear the input so re-picking the same file works.
    }
  }                                                   // End onPickPhoto.

  async function save() {                             // Runs when the user clicks "Guardar".
    setMsg("");                                       // Clear previous messages before the attempt.
    setError("");
    try {
      const token = localStorage.getItem("token");    // The JWT; PATCH /users/me is a protected route.
      const updated = await api("/users/me", {        // Send only the editable fields (server whitelists them again).
        method: "PATCH",                              // PATCH = partial update of the existing record.
        token,                                        // Attach the Bearer token so the server knows who to update.
        body: form,                                   // The form values (now including the two private phone fields).
      });
      setMsg("Perfil guardado.");                     // Confirm to the user (Spanish-first).
      onSaved?.(updated);                             // Let the parent refresh its copy of the user (optional callback).
    } catch (e) {
      setError(e.message);                            // Show the backend's message (e.g. "Invalid field value").
    }
  }                                                   // End save.

  return (
    <div className="card">
      {/* ---------------- PHOTO BLOCK (new) ---------------- */}
      <div className="photo-row">                      {/* Flex row: avatar on the left, button + hint on the right (styled in tokens.css). */}
        <img
          src={mediaUrl(preview || photoUrl, `${import.meta.env.BASE_URL}logo.png`)} // Prefer the instant preview, then the saved photo, then the brand logo as a placeholder.
          alt="Foto de perfil"                         // Meaningful alt text: this image carries information, unlike the decorative card avatars.
          className="avatar avatar-lg"                 // Same circular treatment as the map cards, one size larger.
        />
        <div className="photo-actions">                {/* Column holding the button and the format hint. */}
          <button
            className="btn btn-secondary"              // Secondary action: changing the picture is not the page's main "Guardar".
            onClick={() => fileRef.current?.click()}   // Programmatically open the hidden file input (browsers can't style the native one).
            disabled={busy}                            // Prevent a second upload while one is running.
          >
            {busy ? "Subiendo…" : "Cambiar foto"}      {/* Label doubles as the progress indicator. */}
          </button>
          <p className="muted">JPG o PNG, máximo 5 MB.</p> {/* States the exact limits the backend enforces, so a rejection is never a surprise. */}
        </div>
      </div>

      <input
        ref={fileRef}                                  // Referenced by the button above.
        type="file"                                    // Native file picker.
        accept="image/jpeg,image/png"                  // Pre-filters the OS dialog to the allowed types.
        onChange={onPickPhoto}                         // Validate + upload as soon as a file is chosen (no extra "upload" click).
        style={{ display: "none" }}                    // Hidden: the styled button above is the real control.
      />

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

      {/* ---------------- PRIVATE CONTACT BLOCK (new) ---------------- */}
      <h4 className="section-title">Contacto privado</h4>      {/* Heading marks where public profile ends and private data begins. */}
      <p className="muted">
        Tu teléfono no aparece en el mapa ni en el panel de estudiantes. Solo tú y el equipo administrador pueden verlo. {/* Sets the privacy expectation in plain language; it matches what GET /users actually returns. */}
      </p>
      <div className="phone-row">                              {/* Two fields on one line: short code + long number. */}
        <input
          className="phone-code"                               // Narrow column (styled in tokens.css).
          placeholder="+52"                                    // Mexico's dialing code as the example, since the platform is Mexico-first.
          maxLength={8}                                        // Matches users.phone_country_code VARCHAR(8) so the DB can never reject the value.
          value={form.phone_country_code}
          onChange={set("phone_country_code")}                 // Writes to phone_country_code (whitelisted in users.routes.js EDITABLE).
        />
        <input
          className="phone-number"                             // Wide column.
          placeholder="Número de teléfono"                     // Spanish-first label.
          maxLength={30}                                       // Matches users.phone_number VARCHAR(30).
          value={form.phone_number}
          onChange={set("phone_number")}                       // Writes to phone_number (also whitelisted server-side).
        />
      </div>

      <button className="btn btn-primary" onClick={save}>Guardar</button> {/* Primary action -> save(). */}
      {msg && <p style={{ color: "green" }}>{msg}</p>}         {/* Success feedback. */}
      {error && <p style={{ color: "crimson" }}>{error}</p>}   {/* Failure feedback. */}
    </div>
  );                                                           // End JSX.
}                                                              // End Profile component.
