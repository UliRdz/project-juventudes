// src/realtime.js
// PURPOSE: A tiny holder for the Socket.io server instance so that HTTP route
// handlers (which run inside app.js) can push real-time events, even though the
// socket server is created in server.js.
// INTENDED OUTPUT LINK: this is what makes the chat actually live. The REST
// endpoint POST /chat saves a message, then calls emitToUser() here to push it to
// the recipient's open browser instantly instead of waiting for them to refresh.
//
// WHY SERVER-SIDE EMIT (and not the client emitting a "dm" event):
//   1. Security — the sender is taken from the JWT the server already verified,
//      so a malicious client cannot forge a message "from" someone else.
//   2. Correctness — the message is broadcast only AFTER it is safely stored, so
//      what the recipient sees always matches what is in the database.

let io = null; // Module-level reference to the Socket.io server; null until server.js sets it.

export function setIo(instance) { // Called once from server.js right after the socket server is created.
  io = instance;                  // Store the instance so emitToUser() below can use it later.
}

export function emitToUser(userId, event, payload) { // Push an event to one specific user's browser(s).
  if (!io) return;                                   // Safety: if sockets aren't running (e.g. tests), do nothing rather than crash.
  io.to(String(userId)).emit(event, payload);        // Each user joins a "room" named after their id, so this targets only them.
}                                                    // NOTE: a user with two tabs open has two sockets in the same room; both get it.
