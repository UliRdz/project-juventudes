// src/components/chat/ChatWidget.jsx
// PURPOSE: The bottom-overlay chat window. Loads the conversation history, sends
// new messages, and receives incoming ones live over a WebSocket — falling back to
// polling if the socket can't connect.
// INTENDED OUTPUT LINK: this is what the "Chat" button on a Day 3 user card opens.
// Every send goes through POST /chat, which stores the message AND triggers the
// mandatory notification email, so the two delivery paths never diverge.

import { useEffect, useRef, useState } from "react"; // Hooks: state, a DOM ref for autoscroll, and lifecycle effects.
import { io } from "socket.io-client";                // WebSocket client that pairs with the Socket.io server.
import { api } from "../../api/client";                // Shared REST wrapper (adds base URL + Bearer token).

// Where the socket connects. Same origin as the REST API, since server.js serves
// both HTTP and WebSocket traffic on one port.
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000"; // Backend origin from the Vite env.

export default function ChatWidget({ peer, me, onClose }) { // peer = who we're talking to; me = the logged-in user.
  const [messages, setMessages] = useState([]);   // The conversation, oldest first.
  const [text, setText] = useState("");           // The composer's current input value.
  const [error, setError] = useState("");         // Any send/load error to show the user.
  const [live, setLive] = useState(false);        // True when the WebSocket is connected (drives the status dot).
  const bottomRef = useRef(null);                 // Points at an empty div after the last message, used to autoscroll.

  const token = localStorage.getItem("token");    // The JWT: required by both the REST calls and the socket handshake.

  // ---- Load history + open the realtime connection -------------------------
  useEffect(() => {
    let cancelled = false;                        // Guard so a slow response can't update state after unmount.

    api(`/chat/${peer.id}`, { token })            // GET the full thread with this person (also marks it read).
      .then((rows) => { if (!cancelled) setMessages(rows); }) // Store it, unless we've already unmounted.
      .catch((e) => { if (!cancelled) setError(e.message); }); // Show load failures (e.g. expired token).

    const socket = io(API_URL, {                  // Open the WebSocket.
      auth: { token },                            // The server verifies this JWT during the handshake (server.js).
      transports: ["websocket", "polling"],       // Prefer a real socket; allow long-polling where sockets are blocked.
    });

    socket.on("connect", () => setLive(true));    // Handshake succeeded -> show the "en vivo" indicator.
    socket.on("disconnect", () => setLive(false));// Dropped -> hide it (the polling fallback below takes over).
    socket.on("connect_error", () => setLive(false)); // Auth failure or server down -> not live.

    socket.on("dm", (msg) => {                    // A message pushed by the server (emitted after it was stored).
      // Only append messages belonging to THIS conversation; the same socket also
      // receives messages from other people, which belong in their own threads.
      if (msg.sender_id !== peer.id) return;      // Ignore anything from someone else.
      setMessages((prev) =>
        prev.some((m) => m.id === msg.id) ? prev : [...prev, msg] // Skip duplicates (id already present).
      );
    });

    // ---- Polling fallback --------------------------------------------------
    // If the socket isn't connected, re-fetch the thread every 5 seconds so chat
    // still works on restrictive networks (the plan's documented fallback).
    const poll = setInterval(() => {
      if (socket.connected) return;               // Socket is live -> polling is unnecessary, skip this tick.
      api(`/chat/${peer.id}`, { token })          // Otherwise re-read the conversation...
        .then((rows) => { if (!cancelled) setMessages(rows); }) // ...and replace what we have.
        .catch(() => {});                         // Ignore transient polling errors; the next tick retries.
    }, 5000);                                     // Every 5,000 ms.

    return () => {                                // Cleanup when the widget closes or the peer changes:
      cancelled = true;                           // Block any late state updates.
      clearInterval(poll);                        // Stop the polling timer (otherwise it leaks).
      socket.disconnect();                        // Close the WebSocket so the server frees the room membership.
    };
  }, [peer.id]);                                  // Re-run whenever we switch to a different conversation partner.

  // ---- Keep the newest message in view -------------------------------------
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" }); // Scroll the anchor div into view after each update.
  }, [messages]);                                              // Runs whenever the message list changes.

  // ---- Send ----------------------------------------------------------------
  async function send() {
    const body = text.trim();                     // Trim so whitespace-only sends are ignored.
    if (!body) return;                            // Nothing to send.
    setError("");                                 // Clear any previous error.
    try {
      const saved = await api("/chat", {          // POST persists the message, emails the recipient, and pushes it live.
        method: "POST",
        token,                                    // Auth: the server derives the sender from this token.
        body: { receiver_id: peer.id, message: body }, // Who it's for and the text.
      });
      setMessages((prev) => [...prev, saved]);    // Optimistically append the stored row (the server won't echo it back to us).
      setText("");                                // Clear the composer for the next message.
    } catch (e) {
      setError(e.message);                        // Show "Too many messages, slow down" (429) or any other failure.
    }
  }

  function onKeyDown(e) {                         // Keyboard shortcut in the composer.
    if (e.key === "Enter" && !e.shiftKey) {       // Enter sends; Shift+Enter is left free for newlines.
      e.preventDefault();                         // Stop the default newline insertion.
      send();                                     // Send the message.
    }
  }

  return (
    <div className="chat-widget">                                  {/* Fixed bottom-right overlay (styled in tokens.css). */}
      <header className="chat-header">                             {/* Title bar: who you're talking to + status + close. */}
        <span>
          {peer.first_name} {peer.last_name}                       {/* The other person's name. */}
          <span className={live ? "dot-live" : "dot-off"} title={live ? "En vivo" : "Sin conexión en vivo"} /> {/* Green/gray status dot. */}
        </span>
        <button onClick={onClose} aria-label="Cerrar">×</button>    {/* Closes the widget. */}
      </header>

      <div className="chat-messages">                              {/* Scrollable message list. */}
        {messages.length === 0 && (                                // Empty conversation...
          <p className="muted">Aún no hay mensajes. ¡Saluda!</p>   // ...invite the user to start it.
        )}
        {messages.map((m) => (                                     // Render each message.
          <div
            key={m.id}                                             // Stable database id as the React key.
            className={m.sender_id === me?.id ? "msg msg-mine" : "msg msg-theirs"} // Right-align mine, left-align theirs.
          >
            {m.message}                                            {/* The message text. */}
          </div>
        ))}
        <div ref={bottomRef} />                                    {/* Invisible anchor used by the autoscroll effect. */}
      </div>

      {error && <p style={{ color: "crimson", margin: "0 8px" }}>{error}</p>} {/* Send/load error line. */}

      <div className="chat-composer">                              {/* Input row at the bottom. */}
        <input
          value={text}                                             // Controlled input.
          onChange={(e) => setText(e.target.value)}                // Track typing.
          onKeyDown={onKeyDown}                                    // Enter-to-send.
          placeholder="Escribe un mensaje…"                        // Spanish-first placeholder.
        />
        <button className="btn btn-primary" onClick={send}>Enviar</button> {/* Explicit send button. */}
      </div>
    </div>
  );
}
