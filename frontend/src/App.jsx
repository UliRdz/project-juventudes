// src/App.jsx
// PURPOSE: The root component. For Day 1 it is intentionally a minimal skeleton
// that also proves the frontend can reach the backend by calling GET /health.
// INTENDED OUTPUT LINK: later days replace the body here with the map, popups,
// chat, and routing. Today it renders a status line so you can SEE the two
// halves of the stack talking to each other — the Day 1 "it works" moment.

import { useEffect, useState } from "react"; // React hooks: state to store data, effect to run code after render.
import { api } from "./api/client.js";        // Our fetch wrapper that points at the backend base URL.

export default function App() {                        // Define and export the root component.
  const [status, setStatus] = useState("checking...");  // Holds the health-check result shown on screen; starts as "checking...".

  useEffect(() => {                                     // Run once after the first render (empty deps array below).
    api("/health")                                      // Call the backend's GET /health endpoint via the shared client.
      .then((res) => setStatus(res.status))             // On success, store the returned status ("ok") into state -> re-renders the UI.
      .catch(() => setStatus("backend unreachable"));   // On failure (server down / CORS), show a clear message instead of crashing.
  }, []);                                               // [] = run this effect only on mount, not on every render.

  return (                                              // JSX describing what appears on screen.
    <main style={{ fontFamily: "sans-serif", padding: "2rem" }}> {/* Simple centered container; real layout comes later. */}
      <h1 style={{ color: "var(--color-primary)" }}>Red de Becas</h1> {/* App title using the brand Deep Blue token from tokens.css. */}
      <p>Frontend is running.</p>                       {/* Confirms the React app itself mounted successfully. */}
      <p>                                               {/* Line that reports the backend connection result. */}
        Backend health: <strong>{status}</strong>       {/* Shows "ok" when the API responds, proving end-to-end connectivity. */}
      </p>                                              {/* End status line. */}
    </main>                                             // End container.
  );                                                    // End returned JSX.
}                                                       // End App component.
