// server.js
// PURPOSE: This is the process entry point for the backend. Running `node server.js`
// (or `npm run dev`) starts the HTTP server that the React frontend calls.
// INTENDED OUTPUT LINK: without this file listening on a port, the frontend's
// api/client.js requests would have nothing to talk to, so no login, map data,
// scholarships, or chat could ever load.

import app from "./src/app.js"; // Import the configured Express app (routes + middleware live in src/app.js).

const PORT = process.env.PORT || 4000; // Read the port from the environment (hosts like Render set PORT); fall back to 4000 locally.

app.listen(PORT, () => {                 // Bind the Express app to the port and start accepting HTTP connections.
  console.log(`API running on :${PORT}`); // Log confirmation so the developer can see the server is up (and on which port).
}); // End of app.listen: from here on, GET /health and future routes respond to requests.
