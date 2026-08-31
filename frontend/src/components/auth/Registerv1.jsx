// src/components/auth/Register.jsx
// PURPOSE: The account-creation form. Collects the minimum fields to create a
// user, then (on success) logs them straight in for a smooth first experience.
// INTENDED OUTPUT LINK: this writes a row into the users table via POST
// /auth/register; that row is what later powers the user's profile and their
// appearance on the map's per-country list (Day 3).

import { useState } from "react";          // React state hook for the form and messages.
import { api } from "../../api/client";     // Shared backend fetch wrapper.

export default function Register({ onRegistered }) {            // onRegistered lets the parent react after a successful signup.
  const [form, setForm] = useState({                            // Controlled form state for all fields.
    email: "",                                                  // Login email.
    password: "",                                               // Password (min 8 chars, enforced by the backend).
    first_name: "",                                             // Shown on profile / user card.
    last_name: "",                                              // Shown on profile / user card.
  });
  const [error, setError] = useState("");                       // Error message (e.g. "Email already registered").
  const [ok, setOk] = useState(false);                          // Success flag to show a confirmation message.

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value }); // Helper: make an onChange updater for a given field.

  async function submit() {                                     // Runs on "Crear cuenta".
    setError("");                                               // Reset error before the attempt.
    try {                                                       // api() throws on error responses.
      const user = await api("/auth/register", { method: "POST", body: form }); // Create the account on the backend.
      setOk(true);                                              // Show success UI.
      onRegistered?.(user);                                     // Notify the parent (optional chaining in case it wasn't passed).
    } catch (e) {                                               // Duplicate email / weak password / network...
      setError(e.message);                                      // ...surface the backend's message to the user.
    }
  }                                                             // End submit.

  if (ok) {                                                     // After a successful registration...
    return <p>¡Cuenta creada! Ya puedes iniciar sesión.</p>;    // ...show a simple confirmation (Spanish-first).
  }

  return (                                                      // The registration form UI.
    <div className="card">
      <input placeholder="Nombre" value={form.first_name} onChange={set("first_name")} />   {/* first_name field. */}
      <input placeholder="Apellido" value={form.last_name} onChange={set("last_name")} />    {/* last_name field. */}
      <input placeholder="Correo" value={form.email} onChange={set("email")} />              {/* email field. */}
      <input type="password" placeholder="Contraseña (mín. 8)" value={form.password} onChange={set("password")} /> {/* password field. */}
      <button className="btn btn-primary" onClick={submit}>Crear cuenta</button>             {/* Primary action -> submit(). */}
      {error && <p style={{ color: "crimson" }}>{error}</p>}                                  {/* Conditional error line. */}
    </div>
  );                                                            // End returned JSX.
}                                                               // End Register component.
