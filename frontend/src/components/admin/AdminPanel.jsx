// src/components/admin/AdminPanel.jsx
// PURPOSE: The whole administrator interface: its own login screen, then tabs for
// the dashboard, user management, scholarship CMS, chat moderation, and settings.
// INTENDED OUTPUT LINK: this is the "separate admin system" from the spec. It uses
// its OWN token (stored under a different localStorage key), so being logged in as
// a student grants nothing here, and logging out of the admin panel doesn't touch
// the student session.
//
// CHANGE (photo release), the missing management controls:
//   1. Usuarios — an inline EDIT form (name, email, origin, current location,
//      status, institution and the private country code + phone) backed by the new
//      PATCH /admin/users/:id, plus a permanent DELETE backed by DELETE
//      /admin/users/:id. Previously an admin could only ban, mute or reset 2FA;
//      there was no way to correct or erase a profile at all.
//   2. Becas — an EDIT button that loads the row back into ScholarshipForm, which
//      then issues PUT /scholarships/:id. The backend route already existed but no
//      button ever called it, so scholarships could only be created or deleted.
//   3. Each user row now shows the avatar, resolved with mediaUrl() so the
//      "/uploads/..." path points at the backend rather than at GitHub Pages.

import { useEffect, useState } from "react";       // State + data loading on mount/tab change.
import { api, mediaUrl, API_BASE_URL } from "../../api/client"; // Fetch wrapper, avatar URL resolver, and the one backend origin (used by the CSV download).
import ScholarshipForm from "./ScholarshipForm.jsx";// The manual scholarship entry form (now also the EDIT form).
import { COUNTRIES } from "../../data/countries";   // Generated from world.geojson: the ONLY valid country strings, shared with the map and the student profile.

// Deliberately a DIFFERENT key from the user token ("token"). Keeping them apart
// means a student session can never be mistaken for an admin session in the UI.
const ADMIN_TOKEN_KEY = "admin_token";              // localStorage key for the admin JWT.

export default function AdminPanel() {
  const [token, setToken] = useState(localStorage.getItem(ADMIN_TOKEN_KEY) || ""); // Restore an existing admin session.
  const [tab, setTab] = useState("dashboard");      // Which tab is open.

  function logout() {                               // End the admin session.
    localStorage.removeItem(ADMIN_TOKEN_KEY);       // Drop the admin token only (the student token is untouched).
    setToken("");                                   // Return to the admin login screen.
  }

  if (!token) {                                     // No admin session yet...
    return <AdminLogin onLoggedIn={(t) => {         // ...show the isolated login form.
      localStorage.setItem(ADMIN_TOKEN_KEY, t);     // Persist the admin token so a refresh keeps the session.
      setToken(t);                                  // Switch to the panel.
    }} />;
  }

  return (
    <div>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ color: "var(--color-primary)" }}>Panel de administración</h2> {/* Title. */}
        <button className="btn btn-secondary" onClick={logout}>Salir</button>       {/* Admin logout. */}
      </header>

      <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}> {/* Tab bar. */}
        {[                                                   // Tab definitions: internal key + Spanish label.
          ["dashboard", "Resumen"],
          ["users", "Usuarios"],
          ["scholarships", "Becas"],
          ["tickets", "Solicitudes"],   // NEW tab: the "Chat requests" queue — support tickets opened from the student "Ayuda" button.
          ["chats", "Moderación"],
          ["settings", "Sistema"],
        ].map(([key, label]) => (
          <button
            key={key}                                        // React key.
            className={tab === key ? "btn btn-primary" : "btn btn-secondary"} // Highlight the active tab.
            onClick={() => setTab(key)}                      // Switch tabs.
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Render only the active tab so each one fetches its data on open. */}
      {tab === "dashboard" && <Dashboard token={token} />}
      {tab === "users" && <UsersTab token={token} />}
      {tab === "scholarships" && <ScholarshipsTab token={token} />}
      {tab === "tickets" && <TicketsTab token={token} />}
      {tab === "chats" && <ChatsTab token={token} />}
      {tab === "settings" && <SettingsTab token={token} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Isolated admin login (separate credentials from the student login).
// ---------------------------------------------------------------------------
function AdminLogin({ onLoggedIn }) {
  const [form, setForm] = useState({ email: "", password: "", totp: "" }); // Admin credentials + optional 2FA.
  const [error, setError] = useState("");                                  // Error message.

  async function submit() {
    setError("");
    try {
      const res = await api("/admin/login", { method: "POST", body: form }); // Hits the ADMIN login, not /auth/login.
      onLoggedIn(res.token);                                                 // Hand the admin token up to be stored.
    } catch (e) {
      setError(e.message);                                                   // "Invalid credentials" / "Invalid 2FA code".
    }
  }

  return (
    <div className="card" style={{ maxWidth: 380, margin: "2rem auto" }}>
      <h2>Acceso administrador</h2>                                          {/* Clearly a different door. */}
      <input placeholder="Correo" onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input type="password" placeholder="Contraseña" onChange={(e) => setForm({ ...form, password: e.target.value })} />
      <input placeholder="Código 2FA (si aplica)" onChange={(e) => setForm({ ...form, totp: e.target.value })} /> {/* Optional. */}
      <button className="btn btn-primary" onClick={submit}>Entrar</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard widgets.
// ---------------------------------------------------------------------------
function Dashboard({ token }) {
  const [d, setD] = useState(null);        // The aggregate counts.
  const [error, setError] = useState("");  // Load error.

  useEffect(() => {                                        // Load once when the tab opens.
    api("/admin/dashboard", { token }).then(setD).catch((e) => setError(e.message));
  }, []);

  if (error) return <p style={{ color: "crimson" }}>{error}</p>; // Show failures (e.g. expired admin token).
  if (!d) return <p>Cargando…</p>;                               // Loading state.

  const widgets = [                                        // Map the API response to the five spec'd widgets.
    ["Usuarios totales", d.users],                         // Active registered students.
    ["Becas activas", d.scholarships],                     // Currently visible scholarships.
    ["Países con usuarios", d.countries],                  // Distinct countries represented.
    ["Chats pendientes", d.pending_chats],                 // Unread messages platform-wide.
    ["Última actualización", d.last_api_update ? new Date(d.last_api_update).toLocaleString() : "—"], // Last scholarship change.
    // NEW (this patch): the three support-ticket KPIs. They are the throughput
    // measure for the "Ayuda" channel — "abiertas" is the backlog an admin has to
    // clear, "en proceso" is current load, "cerradas" is cumulative resolution.
    ["Solicitudes abiertas", d.tickets_open ?? 0],          // ?? 0 so an older backend that doesn't send the field renders 0, not "undefined".
    ["Solicitudes en proceso", d.tickets_in_progress ?? 0], // Being worked on right now.
    ["Solicitudes cerradas", d.tickets_closed ?? 0],        // Resolved to date.
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}> {/* Responsive grid. */}
      {widgets.map(([label, value]) => (
        <div className="card" key={label} style={{ textAlign: "center" }}>   {/* One card per metric. */}
          <p className="muted" style={{ margin: 0 }}>{label}</p>             {/* Metric name. */}
          <strong style={{ fontSize: "1.6rem", color: "var(--color-primary)" }}>{value}</strong> {/* The number. */}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// User management: search, EDIT, DELETE, ban/unban, mute, reset 2FA, CSV export.
// ---------------------------------------------------------------------------
function UsersTab({ token }) {
  const [users, setUsers] = useState([]);  // The user rows.
  const [q, setQ] = useState("");          // Search term.
  const [error, setError] = useState("");  // Error message.
  const [editingId, setEditingId] = useState(null); // NEW: which row has its edit form open (null = none). Only one at a time keeps the table readable.
  const [tempPassword, setTempPassword] = useState(null); // NEW (this patch): { email, password } shown once after a reset; null hides the notice.

  function load() {                                                     // (Re)load the list with the current search.
    api(`/admin/users?q=${encodeURIComponent(q)}`, { token })           // encodeURIComponent keeps odd terms URL-safe.
      .then(setUsers)
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);                                     // Initial load when the tab opens.

  async function act(id, path, body) {                                  // Shared helper for the row action buttons.
    try {
      await api(`/admin/users/${id}/${path}`, { method: "PATCH", token, body }); // Perform the action...
      load();                                                            // ...then refresh so the table shows the new state.
    } catch (e) {
      setError(e.message);
    }
  }

  // NEW (this patch): reset a forgotten password. The admin never types a
  // password: the server generates a random one, stores only its bcrypt hash, and
  // returns the plaintext EXACTLY ONCE in this response. It is held in component
  // state (not persisted anywhere) and disappears when the admin dismisses it or
  // navigates away — so it cannot be recovered from the UI later.
  async function resetPassword(u) {
    const ok = confirm(                                                 // Confirm: this immediately invalidates their current password.
      `¿Reiniciar la contraseña de ${u.first_name} ${u.last_name} (${u.email})?\n\n` +
      "Se generará una contraseña temporal que deberás entregarle por un canal seguro.\n" + // Tells the admin what they will have to do next.
      "Su contraseña actual dejará de funcionar de inmediato."          // States the consequence for the user.
    );
    if (!ok) return;                                                     // Cancelled.

    try {
      const res = await api(`/admin/users/${u.id}/reset-password`, { method: "POST", token }); // Generates + stores the hash, returns the plaintext once.
      setTempPassword({ email: res.email, password: res.temporary_password }); // Surface it for copying.
    } catch (e) {
      setError(e.message);
    }
  }

  // NEW: permanently erase a profile. Two-step confirmation because, unlike
  // "Desactivar", this cannot be undone and it cascades to the person's messages.
  async function removeUser(u) {                                        // u = the whole row, so the prompt can name the person.
    const ok = confirm(                                                 // Native confirm keeps the dependency footprint at zero.
      `¿Eliminar definitivamente a ${u.first_name} ${u.last_name} (${u.email})?\n\n` +
      "Se borrarán también sus mensajes de chat. Esta acción no se puede deshacer.\n" + // States the cascade explicitly (chats.sender_id is ON DELETE CASCADE).
      "Si solo quieres impedirle el acceso, usa \"Desactivar\"."         // Points at the reversible alternative first.
    );
    if (!ok) return;                                                     // Cancelled -> do nothing.
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE", token });     // DELETE /admin/users/:id -> 204 No Content.
      setEditingId(null);                                                // Close the editor if it happened to be open on this row.
      load();                                                            // Refresh the list without the deleted person.
    } catch (e) {
      setError(e.message);
    }
  }

  // CSV export needs a raw fetch (not api()) because the response is a file, not
  // JSON, and the browser must be told to download it.
  async function exportCsv() {
    const base = API_BASE_URL;                                           // Backend origin, imported from api/client.js so it is defined in one place only.
    const res = await fetch(`${base}/admin/users/export`, {              // Request the CSV...
      headers: { Authorization: `Bearer ${token}` },                     // ...with the admin token.
    });
    const blob = await res.blob();                                       // Read the response as binary data.
    const url = URL.createObjectURL(blob);                               // Create a temporary in-memory URL for it.
    const a = document.createElement("a");                               // Build an invisible link...
    a.href = url;                                                        // ...pointing at the blob...
    a.download = "users.csv";                                            // ...with the desired filename...
    a.click();                                                           // ...and click it to trigger the download.
    URL.revokeObjectURL(url);                                            // Release the memory once done.
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input placeholder="Buscar nombre, correo, país…" value={q} onChange={(e) => setQ(e.target.value)} /> {/* Search box. */}
        <button className="btn btn-secondary" onClick={load}>Buscar</button>       {/* Run the search. */}
        <button className="btn btn-secondary" onClick={exportCsv}>Exportar CSV</button> {/* Download the list. */}
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {tempPassword && (                                                  // Shown only right after a reset.
        <div className="temp-password">                                   {/* Highlighted panel so it can't be missed or skimmed past. */}
          <strong>Contraseña temporal generada</strong>
          <p className="muted">
            Para <strong>{tempPassword.email}</strong>. Se muestra una sola vez: cópiala ahora
            y entrégala por un canal seguro. No queda registrada en ningún lado. {/* Sets the expectation before they click away and lose it. */}
          </p>
          <code className="temp-password-value">{tempPassword.password}</code> {/* Monospace so ambiguous characters (l/1, O/0) are readable. */}
          <div className="row-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigator.clipboard?.writeText(tempPassword.password)} // Optional chaining: the Clipboard API is unavailable on insecure origins.
            >
              Copiar
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => setTempPassword(null)}>
              Ya la entregué                                             {/* Dismissing it is the admin confirming they no longer need it on screen. */}
            </button>
          </div>
        </div>
      )}

      {users.map((u) => (
        <div className="card" key={u.id}>                                 {/* One card per user. */}
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}> {/* Row header: avatar beside the identity block. */}
            <img
              src={mediaUrl(u.profile_photo_url, `${import.meta.env.BASE_URL}favicon.svg`)} // Same resolver as the map cards, so admins see exactly the photo students see.
              alt=""                                                       // Decorative: the name is spelled out next to it.
              className="avatar avatar-sm"                                 // Small circular variant.
            />
            <div style={{ flex: 1 }}>                                      {/* Text block absorbs the leftover width. */}
              <strong>{u.first_name} {u.last_name}</strong>                {/* Name. */}
              <p className="muted">{u.email} · {u.current_country || "sin país"}</p> {/* Email + country (or a hint if unset). */}
              <p className="muted">
                {u.is_active ? "Activo" : "Desactivado"} ·                 {/* Ban state. */}
                {u.chat_disabled ? " Chat bloqueado" : " Chat habilitado"} ·  {/* Mute state. */}
                {u.totp_enabled ? " 2FA on" : " 2FA off"} ·                {/* 2FA state. */}
                {/* The private phone, shown here because this surface is admin-only.
                    It is never present in the GET /users payload students receive. */}
                {u.phone_number ? ` ${u.phone_country_code || ""} ${u.phone_number}` : " sin teléfono"}
              </p>
            </div>
          </div>

          <div className="row-actions">                                    {/* Button strip (wraps on narrow screens). */}
            <button
              className="btn btn-secondary btn-sm"                         // Opens/closes the inline editor below.
              onClick={() => setEditingId(editingId === u.id ? null : u.id)} // Toggle: clicking the open row's button closes it.
            >
              {editingId === u.id ? "Cancelar" : "Editar"}                 {/* Label reflects what the click will do. */}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => act(u.id, u.is_active ? "deactivate" : "activate")}>
              {u.is_active ? "Desactivar" : "Reactivar"}                  {/* Toggle the ban (reversible). */}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => act(u.id, "mute", { chat_disabled: !u.chat_disabled })}>
              {u.chat_disabled ? "Permitir chat" : "Bloquear chat"}       {/* Toggle the mute. */}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={() => act(u.id, "reset-2fa")}>Reiniciar 2FA</button> {/* Unlock a user. */}
            {/* NEW: password reset. Kept SEPARATE from "Reiniciar 2FA" on purpose —
                a forgotten password and a lost phone are different problems, and
                each is audited independently. */}
            <button className="btn btn-secondary btn-sm" onClick={() => resetPassword(u)}>Reiniciar contraseña</button>
            <button className="btn btn-danger btn-sm" onClick={() => removeUser(u)}>Eliminar</button> {/* NEW: permanent delete, styled red so it never looks routine. */}
          </div>

          {editingId === u.id && (                                         // Only the selected row renders its editor.
            <UserEditForm
              token={token}                                                // Admin token for the PATCH.
              user={u}                                                     // Pre-fills every field from the row already in memory (no extra request).
              onCancel={() => setEditingId(null)}                          // Close without saving.
              onSaved={() => { setEditingId(null); load(); }}              // Close AND refresh so the summary above shows the new values.
            />
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// UserEditForm (NEW): the inline profile editor behind PATCH /admin/users/:id.
// ---------------------------------------------------------------------------
// Every field here is on the server's ADMIN_EDITABLE whitelist. Security state
// (ban, mute, 2FA) is intentionally absent — those keep their own dedicated
// buttons above so each remains a single, separately audited action.
function UserEditForm({ token, user, onCancel, onSaved }) {
  const [f, setF] = useState({                       // Local copy of the row, so typing never mutates the list until we save.
    first_name: user.first_name || "",               // Display name.
    last_name: user.last_name || "",                 // Display name.
    email: user.email || "",                         // Login identifier — admin-only field.
    current_country: user.current_country || "",     // KEY FIELD: which country panel the student appears in.
    current_city: user.current_city || "",           // Shown on their card.
    city_origin: user.city_origin || "",             // Hometown city.
    state_origin: user.state_origin || "",           // Home state.
    status: user.status || "studying",               // 'studying' | 'working' (DB CHECK constraint).
    institution_company: user.institution_company || "", // Where they study/work.
    phone_country_code: user.phone_country_code || "",   // PRIVATE: dialing code.
    phone_number: user.phone_number || "",               // PRIVATE: phone digits.
  });
  const [error, setError] = useState("");            // Server-side rejection (duplicate email, bad status…).
  const [busy, setBusy] = useState(false);           // Disables the save button while the request runs.

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value }); // Helper: build an onChange updater for field k.

  async function save() {                            // Runs on "Guardar cambios".
    setError("");                                    // Clear the previous failure.
    setBusy(true);                                   // Lock the button (prevents a double submit).
    try {
      await api(`/admin/users/${user.id}`, { method: "PATCH", token, body: f }); // Whitelisted partial update; writes a 'user_edit' row to audit_logs.
      onSaved();                                     // Close the form and reload the list.
    } catch (e) {
      setError(e.message);                           // e.g. "Email already registered" (409) or "Invalid field value" (400).
    } finally {
      setBusy(false);                                // Unlock either way.
    }
  }

  return (
    <div className="admin-edit">                     {/* Dashed separator marks this as an editor for the row above. */}
      <div className="grid-2">                       {/* Two columns on desktop, one on mobile. */}
        <div>
          <label>Nombre</label>                      {/* Explicit labels: an admin correcting data needs to know which field is which. */}
          <input value={f.first_name} onChange={set("first_name")} />
        </div>
        <div>
          <label>Apellido</label>
          <input value={f.last_name} onChange={set("last_name")} />
        </div>
        <div>
          <label>Correo (identificador de acceso)</label> {/* Warns that this changes how the person signs in. */}
          <input value={f.email} onChange={set("email")} />
        </div>
        <div>
          <label>Institución / Empresa</label>
          <input value={f.institution_company} onChange={set("institution_company")} />
        </div>
        <div>
          <label>País actual</label>                 {/* A dropdown, never free text — see the note below the grid. */}
          <select value={f.current_country} onChange={set("current_country")}>
            <option value="">Sin país</option>       {/* Explicit "unset" option: clearing it removes the person from every panel. */}
            {COUNTRIES.map((c) => (                  // Same generated list the map and the student profile use...
              <option key={c} value={c}>{c}</option> // ...so an admin edit can never introduce a name the map won't match.
            ))}
          </select>
        </div>
        <div>
          <label>Ciudad actual</label>
          <input value={f.current_city} onChange={set("current_city")} />
        </div>
        <div>
          <label>Ciudad de origen</label>
          <input value={f.city_origin} onChange={set("city_origin")} />
        </div>
        <div>
          <label>Estado de origen</label>
          <input value={f.state_origin} onChange={set("state_origin")} />
        </div>
        <div>
          <label>Situación</label>
          <select value={f.status} onChange={set("status")}> {/* Constrained to the two DB-allowed values so the CHECK can't fail. */}
            <option value="studying">Estudiando</option>     {/* -> status = 'studying'. */}
            <option value="working">Trabajando</option>      {/* -> status = 'working'. */}
          </select>
        </div>
        <div>
          <label>Código de país</label>              {/* PRIVATE field, admin-visible. */}
          <input maxLength={8} placeholder="+52" value={f.phone_country_code} onChange={set("phone_country_code")} /> {/* maxLength mirrors VARCHAR(8). */}
        </div>
        <div>
          <label>Teléfono</label>                    {/* PRIVATE field, admin-visible. */}
          <input maxLength={30} value={f.phone_number} onChange={set("phone_number")} /> {/* maxLength mirrors VARCHAR(30). */}
        </div>
      </div>

      <p className="muted">
        El país se elige de la lista del mapa. El filtro del panel por país es una
        coincidencia exacta con el nombre del GeoJSON, así que escribirlo a mano
        dejaría a la persona fuera de todos los paneles. {/* Explains why this is a dropdown and not a text field. */}
      </p>

      <div className="row-actions">
        <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}> {/* Primary action: commit the edit. */}
          {busy ? "Guardando…" : "Guardar cambios"}                                 {/* Label doubles as the progress indicator. */}
        </button>
        <button className="btn btn-secondary btn-sm" onClick={onCancel}>Cancelar</button> {/* Discard and close. */}
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}                          {/* Server-side rejection message. */}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scholarship CMS: manual entry form + list with source badges, EDIT and delete.
// ---------------------------------------------------------------------------
// Scholarship CMS: list with source badges, a DETAIL/EDIT page, and delete.
// ---------------------------------------------------------------------------
// CHANGE (this patch) — THE EMPTY-LIST BUG FIX:
// This tab used to call GET /scholarships, which is guarded by requireAuth and
// therefore verifies the token against JWT_SECRET. The admin panel holds an ADMIN
// token signed with ADMIN_JWT_SECRET, and render.yaml generates those two secrets
// independently — so in production they differ, the request came back 401, and the
// list rendered empty. It now calls GET /admin/scholarships (requireAdmin), which
// is the RIGHT token for this surface and additionally returns INACTIVE rows, so an
// administrator can see and re-activate what they previously hid.
//
// The editor is also no longer an inline strip: "Editar" now opens a full detail
// page that replaces the list, which is what makes a long form usable.
function ScholarshipsTab({ token }) {
  const [list, setList] = useState([]);      // All scholarships, active and inactive.
  const [error, setError] = useState("");    // Error message.
  const [q, setQ] = useState("");            // Free-text search across institution and country.
  const [editing, setEditing] = useState(null); // The row open in the detail page (null = showing the list).
  const [creating, setCreating] = useState(false); // True when the detail page is in "new entry" mode.

  function load() {                                                        // (Re)load the catalogue with the current search.
    api(`/admin/scholarships?q=${encodeURIComponent(q)}`, { token })       // THE FIX: the admin endpoint, with the admin token.
      .then(setList)
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);                                        // Load on open.

  async function remove(s) {                                               // Delete a scholarship.
    const ok = confirm(                                                    // Name the row so the admin cannot delete the wrong one by mistake.
      `¿Eliminar la beca "${s.institution_name}" (${s.country})?\n\n` +
      "Esta acción no se puede deshacer.\n" +
      "Si solo quieres ocultarla a los estudiantes, edítala y ponla como \"Inactiva\"." // Points at the reversible alternative first.
    );
    if (!ok) return;                                                       // Cancelled.

    try {
      await api(`/scholarships/${s.id}`, { method: "DELETE", token });      // DELETE is already requireAdmin, so this route was never broken.
      if (editing?.id === s.id) setEditing(null);                           // If the deleted row was open, return to the list.
      load();                                                              // Refresh.
    } catch (e) {
      setError(e.message);
    }
  }

  // ---- DETAIL PAGE: replaces the list entirely while open ----
  // Rendering one view OR the other (rather than the form above the list) means the
  // admin's attention is on a single record, and the page cannot scroll them away
  // from the form they are filling in.
  if (editing || creating) {
    return (
      <div>
        <div className="row-actions" style={{ marginBottom: 12 }}>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => { setEditing(null); setCreating(false); }}       // Leave the detail page without saving.
          >
            ← Volver al listado
          </button>
        </div>

        <ScholarshipForm
          key={editing?.id || "new"}                                        // Remount on selection change so the fields repopulate.
          token={token}                                                     // Admin token; a student token would get 403.
          initial={editing}                                                 // null = blank create form; a row = pre-filled edit form.
          onSaved={() => { setEditing(null); setCreating(false); load(); }}  // Return to the refreshed list after saving.
          onCancelEdit={() => { setEditing(null); setCreating(false); }}     // Same for an explicit cancel.
        />

        {editing && (                                                       // Metadata that is read-only, so it belongs outside the form.
          <div className="card">
            <h4 className="section-title">Detalles del registro</h4>
            <p className="muted">
              Origen: <strong>{editing.source === "manual" ? "Manual" : "API"}</strong>
              {editing.created_by_email && <> · Creada por {editing.created_by_email}</>} {/* Only manual rows have an author. */}
              {editing.updated_at && <> · Última edición {new Date(editing.updated_at).toLocaleString()}</>}
            </p>
            {editing.source === "api" && (                                   // Important warning, not decoration...
              <p className="muted">
                Esta beca proviene de la importación automática. La actualización diaria
                puede sobrescribir estos cambios. {/* ...because scheduler.js upserts api rows on a 24h cycle. */}
              </p>
            )}
            <div className="row-actions">
              <button className="btn btn-danger btn-sm" onClick={() => remove(editing)}>Eliminar esta beca</button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ---- LIST VIEW ----
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <input placeholder="Buscar institución o país…" value={q} onChange={(e) => setQ(e.target.value)} /> {/* Search box. */}
        <button className="btn btn-secondary" onClick={load}>Buscar</button>                                 {/* Run the search. */}
        <button className="btn btn-primary" onClick={() => setCreating(true)}>Agregar beca</button>          {/* Opens the detail page in create mode. */}
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h3>Becas registradas ({list.length})</h3>                            {/* Count now reflects ALL rows, including inactive ones. */}
      {list.length === 0 && (                                               // Empty state...
        <p className="muted">
          No hay becas registradas. Usa “Agregar beca” para crear la primera. {/* ...which is now a real empty catalogue rather than a silent 401. */}
        </p>
      )}

      {list.map((s) => (
        <div className="card" key={s.id}>
          <strong>{s.institution_name}</strong>                             {/* Institution. */}
          {/* Provenance badge: an admin can instantly see which rows they own and
              may safely edit, versus imported rows the refresh may overwrite. */}
          <span className={s.source === "manual" ? "badge-active" : "badge-inactive"} style={{ marginLeft: 8 }}>
            {s.source === "manual" ? "Manual" : "API"}
          </span>
          {/* Visibility badge — NEW, and only meaningful now that inactive rows
              actually reach this list. */}
          <span className={s.status === "active" ? "badge-active" : "badge-inactive"} style={{ marginLeft: 6 }}>
            {s.status === "active" ? "Activa" : "Inactiva"}
          </span>
          <p className="muted">
            {s.country} · {s.category === "high_school" ? "Preparatoria" : "Universidad"} {/* Where / what level. */}
            {s.end_date && <> · cierra {String(s.end_date).slice(0, 10)}</>}                {/* Closing date, trimmed of the timestamp. */}
          </p>
          <div className="row-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setEditing(s)}>Editar detalles</button> {/* Opens the detail page. */}
            <button className="btn btn-danger btn-sm" onClick={() => remove(s)}>Eliminar</button>              {/* Permanent delete. */}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TicketsTab (NEW): the "Chat requests" queue.
// ---------------------------------------------------------------------------
// Support tickets opened from the student "Ayuda" button, organised by the three
// lifecycle states the dashboard KPIs count. Selecting a ticket opens its thread,
// where the admin replies and moves it through the lifecycle.
function TicketsTab({ token }) {
  const [status, setStatus] = useState("open"); // Which queue is showing; "open" first because that is the backlog.
  const [list, setList] = useState([]);         // Ticket summaries for the selected queue.
  const [activeId, setActiveId] = useState(null); // Which ticket is open in the thread view (null = list).
  const [error, setError] = useState("");       // Error message.

  function load(s = status) {                                              // (Re)load the queue.
    api(`/admin/tickets?status=${encodeURIComponent(s)}`, { token })       // '' would mean "all"; the tabs always pass one state.
      .then(setList)
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(status); }, [status]);                             // Reload whenever the queue changes.

  // A ticket open in the thread view delegates entirely to TicketThread.
  if (activeId) {
    return (
      <TicketThread
        token={token}                                                       // Admin token.
        ticketId={activeId}                                                 // Which ticket to load.
        onBack={() => { setActiveId(null); load(status); }}                  // Returning refreshes the queue, since replying may have changed the status.
      />
    );
  }

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        {[                                                                  // The three queues, in lifecycle order.
          ["open", "Abiertas"],                                             // Nobody has replied yet.
          ["in_progress", "En proceso"],                                    // An admin has replied.
          ["closed", "Cerradas"],                                           // Resolved.
        ].map(([key, label]) => (
          <button
            key={key}
            className={status === key ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} // Highlight the active queue.
            onClick={() => setStatus(key)}                                  // Switch queue -> the effect above reloads.
          >
            {label}
          </button>
        ))}
        <button className="btn btn-secondary btn-sm" onClick={() => load(status)}>Actualizar</button> {/* Manual refresh. */}
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      {list.length === 0 && <p className="muted">No hay solicitudes en esta bandeja.</p>} {/* Empty state per queue. */}

      {list.map((t) => (
        <div className="card" key={t.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <img
              src={mediaUrl(t.profile_photo_url, `${import.meta.env.BASE_URL}favicon.svg`)} // The requester's avatar, resolved through the same helper as everywhere else.
              alt=""                                                        // Decorative: the name is next to it.
              className="avatar avatar-sm"
              onError={(e) => { e.currentTarget.src = `${import.meta.env.BASE_URL}favicon.svg`; }} // Degrade to the placeholder on 404.
            />
            <div style={{ flex: 1 }}>
              <strong>{t.subject}</strong>                                  {/* What the ticket is about. */}
              <p className="muted">
                {t.first_name} {t.last_name} · {t.email}                    {/* Who opened it. */}
                {t.current_country && <> · {t.current_country}</>}          {/* Where they are, which often matters for the answer. */}
              </p>
              <p className="muted">
                {t.message_count} mensaje{t.message_count === 1 ? "" : "s"} · {/* Thread length. */}
                {" "}{new Date(t.updated_at).toLocaleString()}              {/* Last activity. */}
                {/* An open ticket with no admin reply is the one that needs action
                    most urgently, so it is called out explicitly rather than left
                    for the admin to infer from the message count. */}
                {!t.last_admin_reply && <strong> · sin respuesta</strong>}
              </p>
            </div>
          </div>
          <div className="row-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => setActiveId(t.id)}>Abrir solicitud</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TicketThread (NEW): read one ticket, reply, and move it through the lifecycle.
// ---------------------------------------------------------------------------
function TicketThread({ token, ticketId, onBack }) {
  const [t, setT] = useState(null);       // The ticket: header, requester context, and messages.
  const [reply, setReply] = useState(""); // The reply box.
  const [error, setError] = useState(""); // Error message.
  const [busy, setBusy] = useState(false);// True while a request is in flight.

  function load() {                                                        // (Re)load the ticket.
    api(`/admin/tickets/${ticketId}`, { token }).then(setT).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [ticketId]);                                // Load on open / when switching tickets.

  async function send() {                                                  // Reply as the administration.
    const body = reply.trim();                                             // Trim so whitespace-only replies are ignored.
    if (!body) return;                                                     // Nothing to send.

    setBusy(true);
    try {
      await api(`/admin/tickets/${ticketId}/messages`, { method: "POST", token, body: { message: body } }); // Stores the reply AND auto-advances 'open' -> 'in_progress'.
      setReply("");                                                        // Clear the box.
      load();                                                              // Reload so both the new message and the new status show.
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function setStatus(status) {                                       // Move the ticket through the lifecycle.
    try {
      await api(`/admin/tickets/${ticketId}`, { method: "PATCH", token, body: { status } }); // Validated server-side against the CHECK constraint.
      load();                                                              // Reflect the new state.
    } catch (e) {
      setError(e.message);
    }
  }

  async function remove() {                                                // Delete the whole ticket (spam / duplicates / erasure request).
    if (!confirm("¿Eliminar esta solicitud y todos sus mensajes? No se puede deshacer.")) return;
    try {
      await api(`/admin/tickets/${ticketId}`, { method: "DELETE", token }); // ticket_messages cascade away with it.
      onBack();                                                            // Return to the queue, which reloads without it.
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;            // Load failure.
  if (!t) return <p>Cargando…</p>;                                         // Loading state.

  return (
    <div>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Volver a solicitudes</button>
      </div>

      <div className="card">
        <h3 style={{ margin: 0 }}>{t.subject}</h3>                          {/* The subject as the page heading. */}
        <p className="muted">
          {t.category} · abierta el {new Date(t.created_at).toLocaleString()} {/* Category key + when it was opened. */}
        </p>

        {/* Requester context. Having it on the same screen as the thread is the
            point: most tickets are resolved by acting on this person's account,
            and the admin should not have to go hunting in the Usuarios tab. */}
        <h4 className="section-title">Solicitante</h4>
        <p className="muted">
          <strong>{t.first_name} {t.last_name}</strong> · {t.email}<br />
          {t.current_city ? `${t.current_city}, ` : ""}{t.current_country || "sin país"}
          {t.institution_company && <> · {t.institution_company}</>}<br />
          {t.phone_number ? `${t.phone_country_code || ""} ${t.phone_number}` : "sin teléfono"} {/* Private field, admin-only surface. */}
          <br />
          {t.is_active ? "Cuenta activa" : "Cuenta desactivada"} ·          {/* The three states most access tickets turn out to be about. */}
          {t.chat_disabled ? " chat bloqueado" : " chat habilitado"} ·
          {t.totp_enabled ? " 2FA activo" : " 2FA inactivo"}
        </p>

        <h4 className="section-title">Estado</h4>
        <div className="row-actions">
          {[                                                                // Explicit buttons rather than a dropdown: one click per transition.
            ["open", "Abierta"],
            ["in_progress", "En proceso"],
            ["closed", "Cerrada"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={t.status === key ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"} // The current state is highlighted.
              onClick={() => setStatus(key)}
            >
              {label}
            </button>
          ))}
          <button className="btn btn-danger btn-sm" onClick={remove}>Eliminar solicitud</button>
        </div>
      </div>

      <div className="card">
        <div className="help-messages">                                     {/* Same bubble styling as the student's Help widget, so both sides look consistent. */}
          {t.messages.map((m) => (
            <div
              key={m.id}
              // Mirror of the student view: here the ADMIN's messages are "mine".
              // The alignment comes from which author column the server populated.
              className={m.author_admin_id ? "msg msg-mine" : "msg msg-theirs"}
            >
              {!m.author_admin_id && <span className="msg-label">{t.first_name}</span>} {/* Label the student's side so a long thread stays readable. */}
              {m.message}
            </div>
          ))}
        </div>

        <div className="help-composer">
          <textarea
            rows={3}
            placeholder="Escribe la respuesta de la administración…"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
          />
          <button className="btn btn-primary" onClick={send} disabled={busy}>
            {busy ? "Enviando…" : "Responder"}
          </button>
        </div>
        <p className="muted">
          Al responder, una solicitud “Abierta” pasa automáticamente a “En proceso”. {/* Explains the automatic transition so the status change isn't a surprise. */}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat moderation: CONVERSATIONS (rewritten in this patch).
// ---------------------------------------------------------------------------
// BEFORE: this tab listed the newest N individual messages. A moderator saw single
// lines torn out of context, could delete one, and had no way to read a thread or
// to intervene in it.
// NOW: it lists CONVERSATIONS. Each row has "Revisar" (opens the full thread, where
// the admin can read it and post an intervention note) and "Eliminar" (removes the
// entire conversation).
function ChatsTab({ token }) {
  const [conversations, setConversations] = useState([]); // One row per conversation.
  const [error, setError] = useState("");                 // Error message.
  const [reviewing, setReviewing] = useState(null);       // { a, b } of the conversation open for review (null = list).

  function load() {                                                        // (Re)load the conversation list.
    api("/admin/chats/conversations?limit=100", { token })                 // Grouped server-side; see admin.routes.js.
      .then(setConversations)
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);                                        // Load on open.

  async function removeConversation(c) {                                   // Delete an entire thread.
    const ok = confirm(
      `¿Eliminar toda la conversación entre ${c.a_first} ${c.a_last} y ${c.b_first} ${c.b_last}?\n\n` +
      `Se borrarán ${c.message_count} mensaje(s) en ambos sentidos. No se puede deshacer.\n` + // States the true blast radius.
      "Si solo un mensaje es problemático, usa \"Revisar\" y elimínalo desde ahí."             // Points at the narrower tool.
    );
    if (!ok) return;

    try {
      await api(`/admin/chats/conversation?a=${c.pair_low}&b=${c.pair_high}`, { method: "DELETE", token }); // One indexed delete on the pair key.
      load();                                                              // Refresh without it.
    } catch (e) {
      setError(e.message);
    }
  }

  // The review page delegates to its own component, which loads the full thread.
  if (reviewing) {
    return (
      <AdminConversation
        token={token}                                                       // Admin token.
        a={reviewing.a}                                                     // Participant A.
        b={reviewing.b}                                                     // Participant B.
        onBack={() => { setReviewing(null); load(); }}                       // Returning refreshes counts (an intervention adds a message).
      />
    );
  }

  return (
    <div>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={load}>Actualizar</button> {/* Manual refresh. */}
      </div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h3>Conversaciones ({conversations.length})</h3>
      {conversations.length === 0 && <p className="muted">No hay conversaciones.</p>} {/* Empty state. */}

      {conversations.map((c) => (
        <div className="card" key={`${c.pair_low}-${c.pair_high}`}>          {/* The pair IS the conversation's identity, so it makes a stable key. */}
          <div className="conv-row">
            <img
              src={mediaUrl(c.a_photo, `${import.meta.env.BASE_URL}favicon.svg`)} // Participant A's avatar.
              alt=""
              className="avatar avatar-sm"
              onError={(e) => { e.currentTarget.src = `${import.meta.env.BASE_URL}favicon.svg`; }}
            />
            <img
              src={mediaUrl(c.b_photo, `${import.meta.env.BASE_URL}favicon.svg`)} // Participant B's avatar.
              alt=""
              className="avatar avatar-sm"
              onError={(e) => { e.currentTarget.src = `${import.meta.env.BASE_URL}favicon.svg`; }}
            />
            <div style={{ flex: 1, minWidth: 0 }}>                           {/* minWidth:0 lets the preview below truncate instead of stretching the row. */}
              <strong>
                {c.a_first} {c.a_last} ↔ {c.b_first} {c.b_last}              {/* The two participants; the arrow signals a two-way thread. */}
              </strong>
              <p className="muted">{c.a_email} · {c.b_email}</p>             {/* Emails, for identification. */}
              <p className="muted conv-preview">{c.last_message}</p>          {/* The newest line: enough to triage without opening it. */}
              <p className="muted">
                {c.message_count} mensaje{c.message_count === 1 ? "" : "s"} · {/* Thread length. */}
                {" "}{new Date(c.last_at).toLocaleString()}                   {/* Last activity. */}
                {c.unread_count > 0 && <> · {c.unread_count} sin leer</>}     {/* Unread count, useful for spotting one-sided contact. */}
                {c.admin_notes > 0 && <strong> · ya intervenida</strong>}     {/* Flags threads that have already been moderated, so two admins don't duplicate work. */}
              </p>
            </div>
          </div>
          <div className="row-actions">
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => setReviewing({ a: c.pair_low, b: c.pair_high })} // Open the review page for this pair.
            >
              Revisar conversación
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => removeConversation(c)}>Eliminar</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AdminConversation (NEW): the conversation review page.
// ---------------------------------------------------------------------------
// Read the full thread, delete an individual message, or post an intervention note
// that BOTH participants see attributed to the administration. The note is stored
// with admin_id set and sender_id/receiver_id NULL — it belongs to the conversation
// but to neither side of it, which is why migration 004 made those columns nullable.
function AdminConversation({ token, a, b, onBack }) {
  const [data, setData] = useState(null);   // { participants, messages }.
  const [note, setNote] = useState("");     // The intervention box.
  const [error, setError] = useState("");   // Error message.
  const [busy, setBusy] = useState(false);  // True while a request is in flight.

  function load() {                                                        // (Re)load the thread.
    api(`/admin/chats/conversation?a=${a}&b=${b}`, { token })              // Also writes a 'conversation_review' audit entry server-side.
      .then(setData)
      .catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, [a, b]);                                    // Load on open / when the pair changes.

  async function intervene() {                                            // Post a moderation note into the thread.
    const body = note.trim();
    if (!body) return;                                                     // Nothing to say.

    setBusy(true);
    try {
      await api("/admin/chats/conversation/message", { method: "POST", token, body: { a, b, message: body } }); // Pushed live to BOTH participants.
      setNote("");                                                         // Clear the box.
      load();                                                              // Reload so the note appears in the thread.
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeMessage(id) {                                       // Delete ONE message.
    if (!confirm("¿Eliminar este mensaje? No se puede deshacer.")) return;
    try {
      await api(`/admin/chats/${id}`, { method: "DELETE", token });          // The narrow tool: keeps the rest of the exchange intact.
      load();                                                              // Refresh.
    } catch (e) {
      setError(e.message);
    }
  }

  if (error) return <p style={{ color: "crimson" }}>{error}</p>;            // Load failure.
  if (!data) return <p>Cargando…</p>;                                      // Loading state.

  // The API returns the two participants as an unordered array, so identify them
  // by id rather than by position — array order from Postgres is not guaranteed.
  const pa = data.participants.find((p) => p.id === a) || data.participants[0]; // Participant A.
  const pb = data.participants.find((p) => p.id === b) || data.participants[1]; // Participant B.

  return (
    <div>
      <div className="row-actions" style={{ marginBottom: 12 }}>
        <button className="btn btn-secondary btn-sm" onClick={onBack}>← Volver a moderación</button>
      </div>

      <div className="card">
        <h3 style={{ margin: 0 }}>
          {pa?.first_name} {pa?.last_name} ↔ {pb?.first_name} {pb?.last_name} {/* The two people under review. */}
        </h3>
        <p className="muted">
          {pa?.email} ({pa?.current_country || "sin país"}) ·                {/* Context for each side... */}
          {" "}{pb?.email} ({pb?.current_country || "sin país"})             {/* ...on one line. */}
        </p>
        <p className="muted">
          {/* Moderation state of each account, so the admin can see at a glance
              whether a mute has already been applied to either party. */}
          {pa?.first_name}: {pa?.chat_disabled ? "chat bloqueado" : "chat habilitado"} ·
          {" "}{pb?.first_name}: {pb?.chat_disabled ? "chat bloqueado" : "chat habilitado"}
        </p>
      </div>

      <div className="card">
        <h4 className="section-title">Conversación ({data.messages.length} mensajes)</h4>
        <div className="conv-thread">                                        {/* Scrollable transcript. */}
          {data.messages.map((m) => (
            <div
              key={m.id}
              // Three cases: an administration note, participant A, or participant B.
              // A moderator is a third party, so neither side is "mine" here — the
              // two participants are distinguished from each other instead.
              className={
                m.admin_id ? "msg msg-system"
                  : m.sender_id === pa?.id ? "msg msg-theirs"                // Participant A on the left.
                  : "msg msg-mine"                                           // Participant B on the right.
              }
            >
              <span className="msg-label">
                {m.admin_id
                  ? "Administración"                                          // A note posted by an admin.
                  : m.sender_id === pa?.id
                  ? pa?.first_name                                            // Who said it...
                  : pb?.first_name}
                {" · "}{new Date(m.created_at).toLocaleString()}              {/* ...and when. Timestamps matter in a moderation review. */}
              </span>
              {m.message}
              <button
                className="conv-del"                                          // Small inline control, so per-message deletion doesn't dominate the transcript.
                onClick={() => removeMessage(m.id)}
                title="Eliminar este mensaje"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h4 className="section-title">Intervenir en la conversación</h4>
        <p className="muted">
          Tu mensaje aparecerá para ambas personas, identificado como
          “Administración”. Úsalo para advertencias, aclaraciones o para cerrar un
          intercambio inapropiado. {/* States exactly who will see it, before they send it. */}
        </p>
        <textarea
          rows={3}
          placeholder="Escribe la intervención…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="row-actions">
          <button className="btn btn-primary btn-sm" onClick={intervene} disabled={busy}>
            {busy ? "Enviando…" : "Enviar intervención"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ---------------------------------------------------------------------------
function SettingsTab({ token }) {
  const [settings, setSettings] = useState({}); // key -> value map.
  const [msg, setMsg] = useState("");           // Success/status message.
  const [error, setError] = useState("");       // Error message.

  useEffect(() => {                                                      // Load settings on open.
    api("/admin/settings", { token }).then(setSettings).catch((e) => setError(e.message));
  }, []);

  async function saveSetting(key, value) {                               // Persist one changed setting.
    try {
      await api(`/admin/settings/${key}`, { method: "PUT", token, body: { value } }); // Upsert it.
      setSettings((s) => ({ ...s, [key]: value }));                      // Update local state so the input reflects it.
      setMsg(`Guardado: ${key}`);                                        // Confirm.
    } catch (e) {
      setError(e.message);
    }
  }

  async function testSmtp() {                                            // Verify SMTP without sending a chat message.
    const to = prompt("¿A qué correo enviamos la prueba?");              // Ask for a destination.
    if (!to) return;                                                     // Cancelled.
    try {
      await api("/admin/smtp/test", { method: "POST", token, body: { to } }); // Trigger the test email.
      setMsg("Correo de prueba enviado.");                               // Confirm.
    } catch (e) {
      setError(e.message);                                               // e.g. "SMTP not configured".
    }
  }

  async function refreshScholarships() {                                 // Run the cron job on demand.
    try {
      const r = await api("/admin/scholarships/refresh", { method: "POST", token }); // Same job the scheduler runs.
      setMsg(`Actualizadas: ${r.inserted}, expiradas: ${r.expired}`);    // Report the counts.
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <h3>Configuración del sistema</h3>
      {Object.entries(settings).map(([k, v]) => (                        // One editable row per setting.
        <div key={k} style={{ marginBottom: 8 }}>
          <label className="muted">{k}</label>                           {/* The setting's key name. */}
          <input
            defaultValue={v}                                             // Start from the stored value.
            onBlur={(e) => saveSetting(k, e.target.value)}               // Save when the field loses focus (no extra button).
          />
        </div>
      ))}
      <button className="btn btn-secondary" onClick={testSmtp}>Probar SMTP</button>                    {/* SMTP check. */}
      <button className="btn btn-secondary" onClick={refreshScholarships} style={{ marginLeft: 8 }}>  {/* Manual refresh. */}
        Actualizar becas ahora
      </button>
      {msg && <p style={{ color: "green" }}>{msg}</p>}
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
