// src/components/auth/Login.jsx
// PURPOSE: The login form. Handles the two-step flow: normal email+password, and
// if the account has 2FA on, a second step that asks for the 6-digit code.
// INTENDED OUTPUT LINK: on success it stores the JWT in the browser and calls
// onLoggedIn(user), which is how the rest of the app (map, chat) knows a user is
// authenticated and gets a token to attach to protected API calls.

import { useState } from "react";          // React state hook for form fields and UI flags.
import { api } from "../../api/client";     // Shared fetch wrapper that talks to the backend.

export default function Login({ onLoggedIn }) {                 // Component; parent passes onLoggedIn to receive the logged-in user.
  const [form, setForm] = useState({ email: "", password: "", totp: "" }); // Controlled form values (incl. the 2FA code).
  const [mfa, setMfa] = useState(false);                        // When true, we show the 2FA code input (server asked for it).
  const [error, setError] = useState("");                       // Holds any error message to show under the form.

  async function submit() {                                     // Runs when the user clicks "Entrar".
    setError("");                                               // Clear any previous error before trying again.
    try {                                                       // api() throws on non-2xx, so wrap in try/catch.
      const res = await api("/auth/login", { method: "POST", body: form }); // Send credentials (+ totp if present) to the backend.
      if (res.mfa_required) {                                   // Backend returned 206 => this account needs a 2FA code...
        setMfa(true);                                           // ...reveal the 2FA input and let the user submit again.
        return;                                                 // Stop here; wait for the second submit with the code.
      }
      localStorage.setItem("token", res.token);                 // Store the JWT so future requests can send it as a Bearer token.
      onLoggedIn(res.user);                                     // Tell the parent who logged in (updates the app's UI/state).
    } catch (e) {                                               // Bad credentials / wrong 2FA / network error...
      setError(e.message);                                      // ...show the server's message ("Invalid credentials", etc.).
    }
  }                                                             // End submit.

  return (                                                      // The form UI.
    <div className="card">                                      {/* Card styling comes from the brand tokens (Day 1). */}
      <input                                                    // Email field.
        placeholder="Correo"                                    // Spanish-first label (product requirement).
        value={form.email}                                      // Controlled input bound to state.
        onChange={(e) => setForm({ ...form, email: e.target.value })} // Update only the email key on each keystroke.
      />
      <input                                                    // Password field.
        type="password"                                         // Masks the characters as the user types.
        placeholder="Contraseña"                                // Spanish label.
        value={form.password}                                   // Controlled value.
        onChange={(e) => setForm({ ...form, password: e.target.value })} // Update the password key.
      />
      {mfa && (                                                 // Only render this input once the server has asked for 2FA...
        <input                                                  // 2FA code field.
          placeholder="Código 2FA"                              // Prompt for the 6-digit authenticator code.
          value={form.totp}                                     // Controlled value.
          onChange={(e) => setForm({ ...form, totp: e.target.value })} // Update the totp key.
        />
      )}
      <button className="btn btn-primary" onClick={submit}>Entrar</button> {/* Deep-Blue primary action triggers submit(). */}
      {error && <p style={{ color: "crimson" }}>{error}</p>}    {/* Show the error message only when one exists. */}
    </div>
  );                                                            // End returned JSX.
}                                                               // End Login component.
