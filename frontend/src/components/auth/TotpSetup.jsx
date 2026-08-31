// src/components/auth/TotpSetup.jsx
// PURPOSE: The optional 2FA setup screen. It asks the backend for a secret+QR,
// shows the QR for the user to scan in Google Authenticator, then verifies one
// code to turn 2FA on.
// INTENDED OUTPUT LINK: completing this flips users.totp_enabled = TRUE, which
// makes future logins require the 6-digit code (the second step in Login.jsx).

import { useState } from "react";          // React state for the QR image, code input, and messages.
import { api } from "../../api/client";     // Shared backend fetch wrapper.

export default function TotpSetup() {                           // No props: it acts on the currently logged-in user (via their token).
  const [qr, setQr] = useState("");                             // Data-URL of the QR image returned by the backend.
  const [manualKey, setManualKey] = useState("");               // Text secret shown as a fallback if the QR can't be scanned.
  const [code, setCode] = useState("");                         // The 6-digit code the user types from their app.
  const [enabled, setEnabled] = useState(false);                // True once verification succeeds and 2FA is on.
  const [error, setError] = useState("");                       // Error message (e.g. "Code did not match").

  const token = localStorage.getItem("token");                  // The JWT saved at login; required for these protected endpoints.

  async function startSetup() {                                 // Step A: request a secret + QR.
    setError("");                                               // Clear old errors.
    try {
      const res = await api("/auth/totp/setup", { method: "POST", token }); // Ask backend to generate + store a pending secret.
      setQr(res.qr);                                            // Save the QR data-URL so we can render it below.
      setManualKey(res.manual_key);                             // Save the manual key as a typing fallback.
    } catch (e) {
      setError(e.message);                                      // Show any failure (e.g. token expired -> re-login).
    }
  }                                                             // End startSetup.

  async function confirm() {                                    // Step B: verify a code to enable 2FA.
    setError("");
    try {
      await api("/auth/totp/verify", { method: "POST", token, body: { totp: code } }); // Send the typed code for verification.
      setEnabled(true);                                         // On success, show the "enabled" confirmation.
    } catch (e) {
      setError(e.message);                                      // Wrong code -> show "Code did not match" and let them retry.
    }
  }                                                             // End confirm.

  if (enabled) {                                                // Final state after success...
    return <p>2FA activado. La próxima vez te pediremos un código.</p>; // ...confirm to the user (Spanish-first).
  }

  return (                                                      // The setup UI.
    <div className="card">
      {!qr ? (                                                  // If we haven't fetched a QR yet...
        <button className="btn btn-primary" onClick={startSetup}>Activar 2FA</button> // ...show the button to begin setup.
      ) : (                                                     // Once we have a QR...
        <>                                                      {/* Fragment groups the QR + verification inputs. */}
          <p>Escanea con Google Authenticator:</p>              {/* Instruction. */}
          <img src={qr} alt="Código QR para 2FA" />             {/* Render the QR image from the data-URL. */}
          <p>O ingresa la clave manual: <code>{manualKey}</code></p> {/* Fallback secret for manual entry. */}
          <input                                                // Input for the 6-digit code.
            placeholder="Código de 6 dígitos"                   // Prompt text.
            value={code}                                        // Controlled value.
            onChange={(e) => setCode(e.target.value)}           // Update the code state.
          />
          <button className="btn btn-primary" onClick={confirm}>Confirmar</button> {/* Verify + enable. */}
        </>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}    {/* Conditional error message. */}
    </div>
  );                                                            // End returned JSX.
}                                                               // End TotpSetup component.
