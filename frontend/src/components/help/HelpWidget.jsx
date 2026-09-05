// src/components/help/HelpWidget.jsx
// PURPOSE: The support surface behind the new "Ayuda" button in the header. It is
// a bottom overlay, like the chat widget, in which a student opens a ticket with
// the administration, follows its status, and continues the conversation.
// INTENDED OUTPUT LINK: talks to routes/tickets.routes.js. The tickets it creates
// appear in the "Solicitudes" tab of AdminPanel.jsx and are counted by the three
// new KPI widgets on the admin "Resumen" dashboard.
//
// WHY A TICKET AND NOT A MAILTO LINK: the category menu is fetched from
// GET /tickets/categories, and every option maps to something an administrator can
// actually perform in the panel (reset a password, correct a profile, fix a
// scholarship, moderate a conversation, delete an account). A ticket therefore
// arrives already routed to a real capability, and its lifecycle is measurable.

import { useEffect, useState } from "react";   // State for the view/data, plus loading on mount.
import { api } from "../../api/client";         // Shared fetch wrapper (adds the Bearer token).

// The three lifecycle states, with the Spanish labels and the badge class used to
// colour them. Kept in one object so the list and the thread header can never
// disagree about what "in_progress" is called.
const STATUS = {
  open:        { label: "Abierto",    cls: "badge-open" },      // Nobody has picked it up yet.
  in_progress: { label: "En proceso", cls: "badge-progress" },  // An admin has replied / is working on it.
  closed:      { label: "Cerrado",    cls: "badge-closed" },    // Resolved. Replying reopens it (server-side).
};

export default function HelpWidget({ onClose }) {  // onClose unmounts the widget from App.jsx.
  const [view, setView] = useState("list");        // Which screen is showing: "list", "new", or "thread".
  const [tickets, setTickets] = useState([]);      // The caller's own tickets (summaries).
  const [categories, setCategories] = useState({});// The option menu, fetched from the server.
  const [active, setActive] = useState(null);      // The ticket currently open in "thread" view (header + messages).
  const [error, setError] = useState("");          // Any error to display.
  const [busy, setBusy] = useState(false);         // True while a request is in flight (disables buttons).

  // Draft state for the "new ticket" form. Category defaults to "" so the user has
  // to make a deliberate choice — a pre-selected category would silently mis-route
  // tickets from anyone who skipped the field.
  const [form, setForm] = useState({ category: "", subject: "", message: "" });
  const [reply, setReply] = useState("");          // The reply box in "thread" view.

  const token = localStorage.getItem("token");     // Every /tickets route is behind requireAuth.

  // ---- Load the menu and the ticket list once, when the widget opens ----------
  useEffect(() => {
    let cancelled = false;                         // Guard against state updates after unmount.

    Promise.all([
      api("/tickets/categories", { token }),       // The option menu (server-owned, so the UI can't drift from it).
      api("/tickets", { token }),                  // My tickets, newest activity first.
    ])
      .then(([cats, list]) => {
        if (cancelled) return;                     // Widget already closed; drop the result.
        setCategories(cats);                       // Populate the <select>.
        setTickets(list);                          // Populate the list.
      })
      .catch((e) => { if (!cancelled) setError(e.message); }); // Show load failures (e.g. expired token).

    return () => { cancelled = true; };            // Cleanup on unmount.
  }, []);                                          // Empty deps: run once on open.

  function reload() {                              // Refresh just the list (after create/reply).
    api("/tickets", { token }).then(setTickets).catch((e) => setError(e.message));
  }

  // ---- Create a ticket --------------------------------------------------------
  async function createTicket() {
    setError("");                                  // Clear the previous failure.
    if (!form.category) return setError("Selecciona un tema.");            // Client-side guard mirroring the server's validation.
    if (!form.subject.trim()) return setError("Escribe un asunto breve."); // Same for the subject...
    if (!form.message.trim()) return setError("Describe tu solicitud.");    // ...and the body.

    setBusy(true);                                 // Lock the button so a double click can't create two tickets.
    try {
      const created = await api("/tickets", { method: "POST", token, body: form }); // Creates the ticket AND its first message in one transaction.
      setForm({ category: "", subject: "", message: "" });                  // Reset the draft.
      reload();                                                             // Refresh the list behind us.
      await openTicket(created.id);                                         // Jump straight into the new thread — the user expects to see what they just sent.
    } catch (e) {
      setError(e.message);                                                  // Show the server's reason.
    } finally {
      setBusy(false);                                                       // Unlock either way.
    }
  }

  // ---- Open one thread --------------------------------------------------------
  async function openTicket(id) {
    setError("");
    try {
      const full = await api(`/tickets/${id}`, { token }); // Header + full message thread in one request.
      setActive(full);                                     // Store it...
      setView("thread");                                   // ...and switch screens.
    } catch (e) {
      setError(e.message);                                 // 404 if the ticket isn't the caller's.
    }
  }

  // ---- Reply inside a thread --------------------------------------------------
  async function sendReply() {
    const body = reply.trim();                     // Trim so whitespace-only replies are ignored.
    if (!body || !active) return;                  // Nothing to send, or no thread open.

    setBusy(true);
    try {
      const saved = await api(`/tickets/${active.id}/messages`, { method: "POST", token, body: { message: body } }); // Store the reply.
      setActive({ ...active, messages: [...active.messages, saved] }); // Append locally so it appears instantly.
      setReply("");                                                    // Clear the box.
      reload();                                                        // The server may have reopened a closed ticket; refresh the list to reflect it.
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="help-widget">                                       {/* Bottom overlay, styled in tokens.css. */}
      <header className="help-header">                                  {/* Title bar: contextual back button + title + close. */}
        {view === "list" ? (                                            // On the list screen there is nowhere to go back to...
          <strong>Ayuda y soporte</strong>                              // ...so just show the title.
        ) : (
          <button className="help-back" onClick={() => { setView("list"); setError(""); }}> {/* Back to the list; clears any stale error. */}
            ← Mis solicitudes
          </button>
        )}
        <button onClick={onClose} aria-label="Cerrar">×</button>        {/* Closes the whole widget. */}
      </header>

      <div className="help-body">                                       {/* Scrollable content area. */}
        {error && <p style={{ color: "crimson" }}>{error}</p>}          {/* Error line, shown on every screen. */}

        {/* ---------------- LIST VIEW ---------------- */}
        {view === "list" && (
          <>
            <p className="muted">
              ¿Necesitas apoyo del equipo administrador? Abre una solicitud y te responderemos aquí mismo. {/* Sets the expectation: the answer arrives in this widget, not by email. */}
            </p>
            <button className="btn btn-primary" onClick={() => { setView("new"); setError(""); }}>
              Nueva solicitud                                            {/* Primary action on this screen. */}
            </button>

            {tickets.length === 0 && (                                   // Empty state...
              <p className="muted" style={{ marginTop: 12 }}>Aún no has abierto ninguna solicitud.</p> // ...so the blank area is explained.
            )}

            {tickets.map((t) => (                                        // One row per ticket.
              <div className="help-ticket" key={t.id} onClick={() => openTicket(t.id)}> {/* The whole row is clickable — a bigger target than a link. */}
                <div className="help-ticket-top">
                  <strong>{t.subject}</strong>                            {/* What it's about. */}
                  <span className={STATUS[t.status]?.cls}>{STATUS[t.status]?.label}</span> {/* Colour-coded state. */}
                </div>
                <p className="muted">
                  {categories[t.category] || t.category} ·                {/* Human-readable category (falls back to the raw key if the menu changed). */}
                  {" "}{t.message_count} mensaje{t.message_count === 1 ? "" : "s"} · {/* Thread length, correctly pluralized. */}
                  {" "}{new Date(t.updated_at).toLocaleDateString()}      {/* Last activity date. */}
                </p>
              </div>
            ))}
          </>
        )}

        {/* ---------------- NEW TICKET VIEW ---------------- */}
        {view === "new" && (
          <>
            <label className="muted">Tema</label>                        {/* Explicit label: this choice routes the ticket. */}
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              <option value="">Selecciona un tema…</option>              {/* Forces a deliberate choice. */}
              {Object.entries(categories).map(([key, label]) => (        // Options come from the server, so they always match what it accepts.
                <option key={key} value={key}>{label}</option>
              ))}
            </select>

            <label className="muted">Asunto</label>
            <input
              placeholder="Resume tu solicitud en una línea"             // Guides the user toward what the admin list actually shows.
              maxLength={200}                                            // Mirrors tickets.subject VARCHAR(200).
              value={form.subject}
              onChange={(e) => setForm({ ...form, subject: e.target.value })}
            />

            <label className="muted">Detalle</label>
            <textarea
              rows={5}                                                    // Tall enough to invite a real description.
              placeholder="Cuéntanos qué necesitas con el mayor detalle posible."
              value={form.message}
              onChange={(e) => setForm({ ...form, message: e.target.value })}
            />

            <div className="row-actions">
              <button className="btn btn-primary" onClick={createTicket} disabled={busy}>
                {busy ? "Enviando…" : "Enviar solicitud"}                {/* Label doubles as the progress indicator. */}
              </button>
              <button className="btn btn-secondary" onClick={() => setView("list")}>Cancelar</button>
            </div>
          </>
        )}

        {/* ---------------- THREAD VIEW ---------------- */}
        {view === "thread" && active && (
          <>
            <div className="help-ticket-top">
              <strong>{active.subject}</strong>                            {/* The ticket's subject as the heading. */}
              <span className={STATUS[active.status]?.cls}>{STATUS[active.status]?.label}</span> {/* Current state. */}
            </div>
            <p className="muted">{categories[active.category] || active.category}</p> {/* Category, for context. */}

            <div className="help-messages">                               {/* The conversation. */}
              {active.messages.map((m) => (
                <div
                  key={m.id}
                  // author_admin_id set = written by the administration; author_user_id
                  // set = written by me. That is the whole alignment rule, and it comes
                  // straight from which column the server populated.
                  className={m.author_admin_id ? "msg msg-admin" : "msg msg-mine"}
                >
                  {m.author_admin_id && <span className="msg-label">Administración</span>} {/* Label only on admin replies, so the source is unambiguous. */}
                  {m.message}
                </div>
              ))}
            </div>

            {active.status === "closed" && (                              // A closed ticket can still be replied to...
              <p className="muted">
                Esta solicitud está cerrada. Si respondes, se reabrirá automáticamente. {/* ...and the server reopens it; say so rather than surprising the user. */}
              </p>
            )}

            <div className="help-composer">
              <textarea
                rows={3}
                placeholder="Escribe tu respuesta…"
                value={reply}
                onChange={(e) => setReply(e.target.value)}
              />
              <button className="btn btn-primary" onClick={sendReply} disabled={busy}>
                {busy ? "Enviando…" : "Responder"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
