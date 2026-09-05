// src/components/chat/ChatWidget.jsx
// PURPOSE: The bottom-overlay chat window. Loads the conversation history, sends
// new messages, and receives incoming ones live over a WebSocket — falling back to
// polling if the socket can't connect.
// INTENDED OUTPUT LINK: this is what the "Chat" button on a Day 3 user card opens.
// Every send goes through POST /chat, which stores the message AND triggers the
// mandatory notification email, so the two delivery paths never diverge.
//
// CHANGE (photo release): the header now shows the other person's avatar, resolved
// through mediaUrl(). DualPopup already hands the whole user object to onChat(), so
// the photo arrives with the peer and needs no extra request. The socket origin is
// now imported from api/client.js instead of re-reading the env var, so the REST
// calls, the avatar URLs and the WebSocket can never point at different backends.

import { useEffect, useRef, useState } from "react"; // Hooks: state, a DOM ref for autoscroll, and lifecycle effects.
import { io } from "socket.io-client";                // WebSocket client that pairs with the Socket.io server.
import { api, mediaUrl, BASE_URL } from "../../api/client"; // Shared REST wrapper + avatar URL resolver + the single backend origin.

// Where the socket connects. Same origin as the REST API, since server.js serves
// both HTTP and WebSocket traffic on one port.
const API_URL = BASE_URL;                             // Re-exported from api/client.js: ONE definition of the backend origin for the whole app.

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
      //
      // CHANGE (this patch): an admin intervention note has sender_id NULL and
      // admin_id set, so the old sender check would have discarded it. It is
      // matched on the conversation key (pair_low/pair_high) instead, which is the
      // only identifier such a note carries.
      const isAdminNote = Boolean(msg.admin_id);  // Written by the administration, not by a participant.
      if (isAdminNote) {                          // For a note, check it belongs to THIS thread...
        const inThread =                          // ...by comparing the sorted participant pair.
          (msg.pair_low === peer.id || msg.pair_high === peer.id) &&
          (msg.pair_low === me?.id || msg.pair_high === me?.id);
        if (!inThread) return;                    // A note about someone else's conversation: ignore.
      } else if (msg.sender_id !== peer.id) {     // Normal message from somebody other than the person we have open...
        return;                                   // ...ignore it here; it belongs to a different thread.
      }
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
        <span className="chat-peer">                               {/* Wrapper so the avatar and name align on one baseline. */}
          <img
            src={mediaUrl(peer.profile_photo_url, `${import.meta.env.BASE_URL}favicon.svg`)} // The same uploaded photo shown on the map card, resolved to the backend origin.
            alt=""                                                 // Decorative: the name sits right next to it.
            className="avatar avatar-xs"                           // Extra-small circular variant sized for the header bar.
            onError={(e) => {                                      // CHANGE (this patch): if the image 404s (a legacy /uploads path, or a photo since removed)...
              e.currentTarget.src = `${import.meta.env.BASE_URL}favicon.svg`; // ...degrade to the placeholder instead of showing a broken-image icon.
            }}
          />
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
            // CHANGE (this patch): three cases now, not two. An admin note is
            // centred and labelled so neither participant can mistake it for the
            // other person speaking — which is the entire point of an intervention.
            className={
              m.admin_id
                ? "msg msg-system"                                 // Administration note: centred, distinct styling.
                : m.sender_id === me?.id
                ? "msg msg-mine"                                   // Mine: right-aligned.
                : "msg msg-theirs"                                 // Theirs: left-aligned.
            }
          >
            {m.admin_id && <span className="msg-label">Administración</span>} {/* Attribution label, only on notes. */}
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
