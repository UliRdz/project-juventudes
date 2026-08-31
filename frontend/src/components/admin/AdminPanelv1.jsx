// src/components/admin/AdminPanel.jsx
// PURPOSE: The whole administrator interface: its own login screen, then tabs for
// the dashboard, user management, scholarship CMS, chat moderation, and settings.
// INTENDED OUTPUT LINK: this is the "separate admin system" from the spec. It uses
// its OWN token (stored under a different localStorage key), so being logged in as
// a student grants nothing here, and logging out of the admin panel doesn't touch
// the student session.

import { useEffect, useState } from "react";       // State + data loading on mount/tab change.
import { api } from "../../api/client";             // Shared fetch wrapper.
import ScholarshipForm from "./ScholarshipForm.jsx";// The manual scholarship entry form.

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
// User management: search, ban/unban, mute, reset 2FA, CSV export.
// ---------------------------------------------------------------------------
function UsersTab({ token }) {
  const [users, setUsers] = useState([]);  // The user rows.
  const [q, setQ] = useState("");          // Search term.
  const [error, setError] = useState("");  // Error message.

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

  // CSV export needs a raw fetch (not api()) because the response is a file, not
  // JSON, and the browser must be told to download it.
  async function exportCsv() {
    const base = import.meta.env.VITE_API_URL || "http://localhost:4000"; // Backend origin.
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
          <strong>{u.first_name} {u.last_name}</strong>                   {/* Name. */}
          <p className="muted">{u.email} · {u.current_country || "sin país"}</p> {/* Email + country (or a hint if unset). */}
          <p className="muted">
            {u.is_active ? "Activo" : "Desactivado"} ·                    {/* Ban state. */}
            {u.chat_disabled ? " Chat bloqueado" : " Chat habilitado"} ·  {/* Mute state. */}
            {u.totp_enabled ? " 2FA on" : " 2FA off"}                     {/* 2FA state. */}
          </p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button className="btn btn-secondary" onClick={() => act(u.id, u.is_active ? "deactivate" : "activate")}>
              {u.is_active ? "Desactivar" : "Reactivar"}                  {/* Toggle the ban. */}
            </button>
            <button className="btn btn-secondary" onClick={() => act(u.id, "mute", { chat_disabled: !u.chat_disabled })}>
              {u.chat_disabled ? "Permitir chat" : "Bloquear chat"}       {/* Toggle the mute. */}
            </button>
            <button className="btn btn-secondary" onClick={() => act(u.id, "reset-2fa")}>Reiniciar 2FA</button> {/* Unlock a user. */}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scholarship CMS: manual entry form + list with source badges and delete.
// ---------------------------------------------------------------------------
function ScholarshipsTab({ token }) {
  const [list, setList] = useState([]);      // All scholarships shown to the admin.
  const [error, setError] = useState("");    // Error message.

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
      load();                                                              // Refresh the list.
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <ScholarshipForm token={token} onSaved={load} />                      {/* Adding one refreshes the list below. */}
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
          <button className="btn btn-secondary" onClick={() => remove(s.id)}>Eliminar</button> {/* Delete action. */}
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
          <button className="btn btn-secondary" onClick={() => remove(c.id)}>Eliminar</button> {/* Moderate. */}
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
