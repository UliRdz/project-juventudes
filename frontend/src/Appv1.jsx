// src/App.jsx
// PURPOSE: The root component. For Day 3 it becomes the real product shell: logged
// out -> register/login; logged in -> the interactive world map, the dual popup for
// the selected country, and a profile panel for setting your location.
// INTENDED OUTPUT LINK: this file connects every piece built so far — auth (Day 2)
// gates the map, a map click sets the country, and the country drives the two API
// calls that fill the popup. The onChat handler is the seam Day 4 plugs into.

import { useEffect, useState } from "react";              // Hooks: app state + the health check on mount.
import { api } from "./api/client.js";                    // Shared backend fetch wrapper.
import Login from "./components/auth/Login.jsx";           // Login form (handles the 2FA second step).
import Register from "./components/auth/Register.jsx";     // Registration form.
import TotpSetup from "./components/auth/TotpSetup.jsx";    // Optional 2FA setup (QR + verify).
import Profile from "./components/auth/Profile.jsx";        // Sets current_country so the user appears on the map.
import WorldMap from "./components/map/WorldMap.jsx";       // The interactive GeoJSON map.
import DualPopup from "./components/popups/DualPopup.jsx";  // Scholarships (left) + students (right).
import ChatWidget from "./components/chat/ChatWidget.jsx";   // Day 4: bottom-overlay chat with the selected student.
import AdminPanel from "./components/admin/AdminPanel.jsx";  // Day 5: the isolated administrator interface.

export default function App() {                            // Root component.
  const [status, setStatus] = useState("checking...");     // Backend health indicator (kept from Day 1).
  const [user, setUser] = useState(null);                  // The logged-in user, or null when logged out.
  const [country, setCountry] = useState(null);            // The country selected on the map (null = popup closed).
  const [showProfile, setShowProfile] = useState(false);   // Toggles the profile/settings panel.
  const [chatPeer, setChatPeer] = useState(null);          // Day 4: who we are chatting with (null = widget closed).
  // Day 5: HASH-based routing for the admin panel (#admin). GitHub Pages serves
  // static files with no server-side rewrites, so a path like /admin would 404 on
  // refresh. A hash is handled entirely in the browser and always works.
  const [isAdminRoute, setIsAdminRoute] = useState(window.location.hash === "#admin"); // Current route flag.

  useEffect(() => {                                        // On first render...
    api("/health")                                         // ...ping the backend...
      .then((res) => setStatus(res.status))                // ...store "ok" on success...
      .catch(() => setStatus("backend unreachable"));      // ...or a clear message on failure.
  }, []);                                                  // Run once on mount.

  useEffect(() => {                                                  // Keep the admin flag in sync with the URL.
    const onHash = () => setIsAdminRoute(window.location.hash === "#admin"); // Re-read the hash on every change.
    window.addEventListener("hashchange", onHash);                   // Fires on back/forward and manual edits.
    return () => window.removeEventListener("hashchange", onHash);   // Clean up the listener on unmount.
  }, []);                                                            // Register once.

  function logout() {                                      // Log the user out.
    localStorage.removeItem("token");                      // Drop the JWT so protected calls stop working.
    setUser(null);                                         // Back to the logged-out view.
    setCountry(null);                                      // Close any open popup so stale data isn't shown.
    setChatPeer(null);                                     // Close the chat widget so it can't keep polling without a token.
  }

  function handleChat(target) {                            // Called when a Chat button on a user card is clicked.
    setChatPeer(target);                                   // Store the target user -> mounts ChatWidget for that conversation.
  }

  // The admin panel is a completely separate surface: it does NOT render the map,
  // the student header, or the chat widget, and it uses its own token.
  if (isAdminRoute) {                                      // URL is #admin...
    return (
      <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 900, margin: "0 auto" }}>
        <AdminPanel />                                     {/* ...render only the admin interface. */}
        <p className="muted" style={{ marginTop: 24 }}>
          <a href="#">← Volver al sitio</a>                {/* Link back to the student-facing app. */}
        </p>
      </main>
    );
  }

  return (                                                 // Student-facing app UI.
    <main style={{ fontFamily: "sans-serif", padding: "1.5rem", maxWidth: 1100, margin: "0 auto" }}> {/* Wider shell to fit the map. */}
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}> {/* Title left, actions right. */}
        <h1 style={{ color: "var(--color-primary)", margin: 0 }}>Red de Becas</h1> {/* Brand title in Deep Blue. */}
        {user && (                                          // Only show account actions when logged in.
          <div>
            <button className="btn btn-secondary" onClick={() => setShowProfile((v) => !v)}>Mi perfil</button> {/* Toggle profile panel. */}
            <button className="btn btn-secondary" onClick={logout} style={{ marginLeft: 8 }}>Cerrar sesión</button> {/* Log out. */}
          </div>
        )}
      </header>

      <p className="muted">Backend health: <strong>{status}</strong></p> {/* Connectivity proof (kept from Day 1). */}

      {!user ? (                                            // ---------- LOGGED-OUT VIEW ----------
        <>
          <h2>Crear cuenta</h2>
          <Register />                                       {/* Registration form (writes to the users table). */}
          <h2>Iniciar sesión</h2>
          <Login onLoggedIn={setUser} />                     {/* On success -> switches to the logged-in view. */}
        </>
      ) : (                                                  // ---------- LOGGED-IN VIEW ----------
        <>
          {showProfile && (                                  // Profile panel is collapsible to keep the map prominent.
            <>
              <h2>Mi perfil</h2>
              <Profile user={user} onSaved={(u) => setUser({ ...user, ...u })} /> {/* Merge saved fields into local state. */}
              <h2>Seguridad (2FA)</h2>
              <TotpSetup />                                   {/* Optional TOTP setup for this user. */}
            </>
          )}

          <h2>Explora por país</h2>                          {/* Heading for the map section. */}
          <WorldMap
            isLoggedIn={!!user}                              // Enables clicking (server also enforces auth independently).
            onSelectCountry={setCountry}                     // A click stores the country -> renders the popup below.
          />

          {country && (                                      // Only mount the popup once a country is selected.
            <DualPopup
              country={country}                              // Which country's data to load.
              onClose={() => setCountry(null)}               // Closing clears the selection.
              onChat={handleChat}                            // Chat button hand-off -> opens the widget below.
            />
          )}

          {chatPeer && (                                     // Day 4: mount the chat overlay once a peer is chosen.
            <ChatWidget
              peer={chatPeer}                                // Who we're messaging (drives history + receiver_id).
              me={user}                                      // Used to right-align our own message bubbles.
              onClose={() => setChatPeer(null)}              // Closing unmounts it, which disconnects the socket.
            />
          )}
        </>
      )}
    </main>
  );                                                          // End JSX.
}                                                             // End App component.
