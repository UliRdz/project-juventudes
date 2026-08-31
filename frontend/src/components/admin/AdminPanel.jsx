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
function ScholarshipsTab({ token }) {
  const [list, setList] = useState([]);      // All scholarships shown to the admin.
  const [error, setError] = useState("");    // Error message.
  const [editing, setEditing] = useState(null); // NEW: the scholarship row currently being edited (null = the form is in "create" mode).

  function load() {                                                        // Load the scholarship list.
    // Reads use the STUDENT token route, so the admin panel reuses the same
    // GET /scholarships endpoint (reads stay on requireAuth by design).
    api("/scholarships", { token }).then(setList).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);                                        // Load on open.

  async function remove(id) {                                              // Delete a scholarship.
    if (!confirm("¿Eliminar esta beca?")) return;                          // Confirm first: deletion is permanent.
    try {
      await api(`/scholarships/${id}`, { method: "DELETE", token });        // Admin-only route.
      if (editing?.id === id) setEditing(null);                             // If the deleted row was open in the form, reset it to create mode.
      load();                                                              // Refresh the list.
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {/* One form serves both jobs. Passing `initial` switches it to edit mode and
          makes it issue PUT /scholarships/:id instead of POST /scholarships. The
          `key` forces React to remount it when the selection changes, which is what
          reloads the fields with the newly chosen row. */}
      <ScholarshipForm
        key={editing?.id || "new"}                                           // Remount on selection change -> fields repopulate.
        token={token}                                                        // Admin token; a student token would get 403.
        initial={editing}                                                    // null = blank create form; a row = pre-filled edit form.
        onSaved={() => { setEditing(null); load(); }}                        // After saving, return to create mode and refresh the list.
        onCancelEdit={() => setEditing(null)}                                // "Cancelar edición" returns to create mode without saving.
      />
      {error && <p style={{ color: "crimson" }}>{error}</p>}

      <h3>Becas registradas ({list.length})</h3>                            {/* Count for quick reference. */}
      {list.map((s) => (
        <div className="card" key={s.id}>
          <strong>{s.institution_name}</strong>                             {/* Institution. */}
          {/* The source badge is why the manual/API split is useful in practice:
              an admin can instantly see which rows they own and may delete. */}
          <span className={s.source === "manual" ? "badge-active" : "badge-inactive"} style={{ marginLeft: 8 }}>
            {s.source === "manual" ? "Manual" : "API"}                      {/* Provenance badge. */}
          </span>
          <p className="muted">{s.country} · {s.category === "high_school" ? "Preparatoria" : "Universidad"}</p> {/* Where/what. */}
          <div className="row-actions">                                     {/* Button strip for this row. */}
            <button
              className="btn btn-secondary btn-sm"                          // NEW: loads this row into the form at the top of the tab.
              onClick={() => {
                setEditing(s);                                              // Select the row -> the form remounts pre-filled.
                window.scrollTo({ top: 0, behavior: "smooth" });            // Scroll back up so the admin can see the form they just filled.
              }}
            >
              Editar
            </button>
            <button className="btn btn-danger btn-sm" onClick={() => remove(s.id)}>Eliminar</button> {/* Delete action (now red, matching the users tab). */}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chat moderation: browse recent messages and delete abusive ones.
// ---------------------------------------------------------------------------
function ChatsTab({ token }) {
  const [chats, setChats] = useState([]);   // Recent messages.
  const [error, setError] = useState("");   // Error message.

  function load() {                                                      // Load the moderation log.
    api("/admin/chats?limit=50", { token }).then(setChats).catch((e) => setError(e.message));
  }

  useEffect(() => { load(); }, []);                                      // Load on open.

  async function remove(id) {                                            // Delete an abusive message.
    if (!confirm("¿Eliminar este mensaje?")) return;                     // Confirm: irreversible.
    try {
      await api(`/admin/chats/${id}`, { method: "DELETE", token });       // Admin-only deletion.
      load();                                                            // Refresh.
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
      <h3>Mensajes recientes</h3>
      {chats.length === 0 && <p className="muted">No hay mensajes.</p>}   {/* Empty state. */}
      {chats.map((c) => (
        <div className="card" key={c.id}>
          <p className="muted">{c.sender_email} → {c.receiver_email}</p>  {/* Who talked to whom. */}
          <p>{c.message}</p>                                              {/* The message content under review. */}
          <p className="muted">{new Date(c.created_at).toLocaleString()}</p> {/* When it was sent. */}
          <button className="btn btn-danger btn-sm" onClick={() => remove(c.id)}>Eliminar</button> {/* Moderate (red, consistent with the other destructive actions). */}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// System settings: edit config values, test SMTP, trigger a scholarship refresh.
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
