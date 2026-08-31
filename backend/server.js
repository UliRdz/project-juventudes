// server.js
// PURPOSE: The process entry point. It creates the HTTP server, attaches the
// Socket.io real-time layer to that SAME server, starts the daily scheduler, and
// begins listening.
// INTENDED OUTPUT LINK: without this file nothing runs. Day 4 expands it from a
// plain HTTP listener into the real-time backbone: REST endpoints and WebSocket
// connections now share one port, and the scholarship refresh job is registered.

import http from "http";                     // Node's HTTP module: needed so Express and Socket.io can share one server.
import { Server } from "socket.io";          // The WebSocket server implementation.
import jwt from "jsonwebtoken";              // Verifies the same JWT used by the REST API, for socket authentication.
import app from "./src/app.js";              // The configured Express app (routes + middleware).
import { setIo } from "./src/realtime.js";   // Lets route handlers emit events (see src/realtime.js).
import { startScheduler } from "./src/services/scheduler.js"; // Registers the daily 03:00 scholarship refresh.

// Wrap the Express app in a raw HTTP server. Socket.io needs this handle to
// perform its upgrade handshake, so both HTTP and WebSocket traffic use one port.
const server = http.createServer(app);       // `app` handles normal requests; `io` below handles upgrades.

// Parse the CORS allow-list the same defensive way app.js does, so a missing
// FRONTEND_ORIGIN can never crash the socket server on boot.
const allowedOrigins = (process.env.FRONTEND_ORIGIN || "") // "" instead of undefined when unset.
  .split(",")                                              // Support multiple comma-separated origins.
  .map((o) => o.trim())                                    // Trim whitespace around each entry.
  .filter(Boolean);                                        // Drop empties.

const io = new Server(server, {              // Create the Socket.io server bound to our HTTP server.
  cors: {                                    // Browsers apply CORS to the WebSocket handshake too...
    origin: allowedOrigins.length > 0 ? allowedOrigins : "*", // ...so allow exactly what the REST API allows.
    credentials: true,                       // Permit credentialed handshakes from that origin.
  },
});

// ---- Socket authentication -------------------------------------------------
// Runs once per connection attempt, BEFORE the connection is established.
io.use((socket, next) => {                                     // Middleware for the handshake.
  try {
    const token = socket.handshake.auth?.token;                // The client passes its JWT in the auth payload.
    if (!token) throw new Error("no token");                   // No token -> reject (chat is never anonymous).
    socket.user = jwt.verify(token, process.env.JWT_SECRET);   // Verify the SAME way the REST API does; attach the payload.
    next();                                                    // Valid -> allow the connection.
  } catch {
    next(new Error("unauthorized"));                           // Invalid/expired -> refuse the handshake entirely.
  }
});

// ---- Connection handling ---------------------------------------------------
io.on("connection", (socket) => {                              // Fires once a socket is authenticated and connected.
  // Each user joins a private "room" named after their own user id. Sending to
  // that room reaches every tab/device that user has open, and nobody else.
  socket.join(String(socket.user.sub));                        // sub = the user id from the verified token.

  // NOTE: there is deliberately NO socket.on("dm") handler here. Messages are
  // sent over the REST endpoint POST /chat, which stores the row, then calls
  // emitToUser() to broadcast it. Accepting chat payloads directly over the
  // socket would let a client send a message that is never persisted (and never
  // emailed), and would make spoofing the sender easier.

  socket.on("disconnect", () => {                              // Fires when the tab closes or the network drops.
    // Socket.io removes the socket from its rooms automatically; nothing to clean up.
  });
});

setIo(io);                                   // Publish the instance so route handlers (chat.routes.js) can emit.

const PORT = process.env.PORT || 4000;       // Port from the environment (hosts set this); 4000 locally.

server.listen(PORT, () => {                              // Start accepting HTTP + WebSocket traffic.
  console.log(`API + WebSocket running on :${PORT}`);    // Confirm startup and the port in the logs.
  startScheduler();                                      // Register the daily job only once the server is actually up.
});
