# Thursday Workday Plan: Chat System, SMTP Relay and Scholarship CMS

## Objective

Deliver the two remaining core features: a **lightweight chat** (real-time via Socket.io with a polling fallback) that stores every message and **triggers an email notification** on send, plus the **Scholarship CMS** CRUD and the **24-hour cron job** that refreshes and expires scholarships automatically.

## Concepts to learn today

- Bi-directional real-time messaging with **WebSockets** vs. simple polling.
- Sending transactional email via **SMTP** (nodemailer) and building a message template.
- Scheduled background work with **node-cron**, and idempotent update/expire logic.
- Basic **rate limiting** to prevent chat spam.

## Deliverables covered

- `backend/src/routes/chat.routes.js` (history + send)
- Socket.io server wired into `server.js`
- `backend/src/services/mailer.js` (SMTP relay + template)
- `backend/src/routes/scholarships.routes.js` extended to full CRUD
- `backend/src/services/scheduler.js` (cron every 24h)
- `frontend/src/components/chat/ChatWidget.jsx`

## Workday outcome

By the end of Thursday, two users can exchange messages that persist in `chats`, each send fires an email to the recipient, an admin can create/update/delete scholarships, and a scheduled job refreshes scholarships and marks expired ones inactive without manual work.

## Step-by-step exercises

### 1. Install dependencies

```bash
cd backend
npm install socket.io nodemailer node-cron express-rate-limit
```

### 2. Chat storage endpoints

`backend/src/routes/chat.routes.js`:

```js
import { Router } from "express";
import { pool } from "../config/db.js";
import { requireAuth } from "../middleware/auth.js";
import { chatLimiter } from "../middleware/rateLimit.js"; // step 7
import { sendChatEmail } from "../services/mailer.js";

const router = Router();

// Conversation history between the caller and one other user.
router.get("/:otherId", requireAuth, async (req, res) => {
  const me = req.user.sub;
  const { rows } = await pool.query(
    `SELECT * FROM chats
     WHERE (sender_id = $1 AND receiver_id = $2)
        OR (sender_id = $2 AND receiver_id = $1)
     ORDER BY created_at ASC`,
    [me, req.params.otherId]
  );
  res.json(rows);
});

// Send a message: persist, email the recipient, return the row.
router.post("/", requireAuth, chatLimiter, async (req, res) => {
  const { receiver_id, message } = req.body;
  if (!message?.trim()) return res.status(400).json({ error: "Empty message" });

  const { rows } = await pool.query(
    `INSERT INTO chats (sender_id, receiver_id, message)
     VALUES ($1, $2, $3) RETURNING *`,
    [req.user.sub, receiver_id, message.trim()]
  );

  // Fire-and-forget email (do not block the response on SMTP).
  sendChatEmail({ senderId: req.user.sub, receiverId: receiver_id, message })
    .catch((e) => console.error("SMTP relay failed:", e.message));

  res.status(201).json(rows[0]);
});

export default router;
```

### 3. Real-time layer with Socket.io

Update `backend/server.js` to attach Socket.io to the same HTTP server:

```js
import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./src/app.js";

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: process.env.FRONTEND_ORIGIN?.split(",") || "*" },
});

// Authenticate the socket with the same JWT.
io.use((socket, next) => {
  try {
    socket.user = jwt.verify(socket.handshake.auth.token, process.env.JWT_SECRET);
    next();
  } catch {
    next(new Error("unauthorized"));
  }
});

io.on("connection", (socket) => {
  socket.join(socket.user.sub); // personal room = user id
  socket.on("dm", ({ to, message }) => {
    io.to(to).emit("dm", { from: socket.user.sub, message, at: Date.now() });
  });
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => console.log(`API + WS on :${PORT}`));
```

> **Polling fallback**: clients that cannot hold a socket open can instead re-`GET /chat/:otherId` every 5 seconds. Keep both paths writing through the same `POST /chat` endpoint so history and email relay behave identically.

### 4. SMTP email relay

`backend/src/services/mailer.js`:

```js
import nodemailer from "nodemailer";
import { pool } from "../config/db.js";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 587),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

export async function sendChatEmail({ senderId, receiverId, message }) {
  const { rows } = await pool.query(
    `SELECT
       s.first_name AS sender_name, s.email AS sender_email,
       r.email AS receiver_email
     FROM users s, users r WHERE s.id = $1 AND r.id = $2`,
    [senderId, receiverId]
  );
  const { sender_name, sender_email, receiver_email } = rows[0];

  await transporter.sendMail({
    from: process.env.SMTP_FROM, // juventudes@gtoxmundo.com
    to: receiver_email,
    subject: `Nuevo mensaje de ${sender_name}`,
    text:
      `Has recibido un nuevo mensaje:\n\n` +
      `De: ${sender_name}\n` +
      `Correo: ${sender_email}\n` +
      `Mensaje: ${message}\n` +
      `Hora: ${new Date().toISOString()}\n\n` +
      `Responde aquí: ${process.env.FRONTEND_ORIGIN}`,
  });
}
```

> For local testing use **Mailtrap** or **MailHog** so you never send real email during development. Switch `SMTP_*` to the production relay only at deploy time.

### 5. Scholarship CMS (full CRUD)

Extend `scholarships.routes.js` with admin-guarded write operations (admin auth middleware is built on Day 5; use `requireAuth` as a placeholder today):

```js
// Minimal server-side validation — a human is typing now, not a trusted feed.
function validateScholarship(f) {
  if (!f.institution_name?.trim()) return "institution_name is required";
  if (!f.country?.trim()) return "country is required";
  if (!["high_school", "university"].includes(f.category)) return "invalid category";
  if (f.start_date && f.end_date && f.start_date > f.end_date)
    return "start_date must be before end_date";
  return null;
}

router.post("/", requireAuth, async (req, res) => {
  const f = req.body;
  const err = validateScholarship(f);
  if (err) return res.status(400).json({ error: err });

  // Manual entries are always source='manual' and record who created them,
  // so the 24h refresh can leave them untouched and admins can remove them later.
  const { rows } = await pool.query(
    `INSERT INTO scholarships
       (institution_name, country, category, areas, start_date, end_date,
        link, description, status, source, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9,'active'),'manual',$10)
     RETURNING *`,
    [f.institution_name, f.country, f.category, f.areas, f.start_date,
     f.end_date, f.link, f.description, f.status, req.admin?.sub ?? null]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireAuth, async (req, res) => {
  const f = req.body;
  const { rows } = await pool.query(
    `UPDATE scholarships SET
       institution_name=$1, country=$2, category=$3, areas=$4,
       start_date=$5, end_date=$6, link=$7, description=$8, status=$9,
       updated_at=now()
     WHERE id=$10 RETURNING *`,
    [f.institution_name, f.country, f.category, f.areas, f.start_date,
     f.end_date, f.link, f.description, f.status, req.params.id]
  );
  res.json(rows[0]);
});

router.delete("/:id", requireAuth, async (req, res) => {
  await pool.query("DELETE FROM scholarships WHERE id = $1", [req.params.id]);
  res.status(204).end();
});
```

### 6. The 24-hour scheduler

`backend/src/services/scheduler.js`:

```js
import cron from "node-cron";
import { pool } from "../config/db.js";

async function refreshFromSource() {
  if (!process.env.SCHOLARSHIP_API_URL) return;
  const res = await fetch(process.env.SCHOLARSHIP_API_URL);
  const items = await res.json(); // shape defined by API.md

  for (const it of items) {
    // Insert as source='api'. The ON CONFLICT target names the partial index
    // predicate (WHERE source='api'), so this only ever matches other API rows —
    // manual entries with the same institution/country/category are never touched.
    await pool.query(
      `INSERT INTO scholarships
         (institution_name, country, category, areas, start_date, end_date, link, description, status, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active','api')
       ON CONFLICT (institution_name, country, category) WHERE source = 'api'
       DO UPDATE SET areas=EXCLUDED.areas, start_date=EXCLUDED.start_date,
                     end_date=EXCLUDED.end_date, link=EXCLUDED.link,
                     description=EXCLUDED.description, updated_at=now()`,
      [it.institution_name, it.country, it.category, it.areas,
       it.start_date, it.end_date, it.link, it.description]
    );
  }
}

async function expirePast() {
  await pool.query(
    "UPDATE scholarships SET status='inactive', updated_at=now() WHERE end_date < CURRENT_DATE"
  );
}

export function startScheduler() {
  // Every day at 03:00 server time.
  cron.schedule("0 3 * * *", async () => {
    try { await refreshFromSource(); await expirePast(); }
    catch (e) { console.error("Scheduler error:", e.message); }
  });
}
```

> The `ON CONFLICT ... WHERE source = 'api'` clause is inferred from the
> **partial unique index `uq_scholarship_api`** defined in the Day 1 schema. Do
> not use a plain full `UNIQUE` constraint here — that would force manual entries
> to be unique too and could reject legitimate internal scholarships. Also call
> `startScheduler()` from `server.js` after the server starts.

### 7. Rate limit the chat endpoint

`backend/src/middleware/rateLimit.js`:

```js
import rateLimit from "express-rate-limit";

export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 20,              // 20 messages/min per IP
  message: { error: "Too many messages, slow down" },
});
```

### 8. Chat widget (frontend)

`frontend/src/components/chat/ChatWidget.jsx` — bottom overlay that combines history + live socket events:

```jsx
import { useEffect, useState } from "react";
import { io } from "socket.io-client";
import { api } from "../../api/client";

export default function ChatWidget({ peer, onClose }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const token = localStorage.getItem("token");

  useEffect(() => {
    api(`/chat/${peer.id}`, { token }).then(setMessages);
    const socket = io(import.meta.env.VITE_API_URL, { auth: { token } });
    socket.on("dm", (m) => setMessages((prev) => [...prev, m]));
    return () => socket.disconnect();
  }, [peer.id]);

  async function send() {
    if (!text.trim()) return;
    const saved = await api("/chat", { method: "POST", token,
      body: { receiver_id: peer.id, message: text } });
    setMessages((prev) => [...prev, saved]);
    setText("");
  }

  return (
    <div className="chat-widget">
      <header>{peer.first_name} <button onClick={onClose}>×</button></header>
      <div className="messages">
        {messages.map((m, i) => <p key={i}>{m.message}</p>)}
      </div>
      <div className="composer">
        <input value={text} onChange={(e) => setText(e.target.value)}
               placeholder="Escribe un mensaje…" />
        <button className="btn btn-primary" onClick={send}>Enviar</button>
      </div>
    </div>
  );
}

// npm install socket.io-client in the frontend.
```

## Validation checklist

- [ ] Sending a message inserts one `chats` row and returns it.
- [ ] The recipient receives an email (verify in Mailtrap/MailHog).
- [ ] Two browser sessions see each other's messages in real time via Socket.io.
- [ ] Socket connections without a valid JWT are rejected.
- [ ] Admin can create, edit, and delete a scholarship.
- [ ] The cron job upserts from the source and flips past-`end_date` rows to inactive.
- [ ] A manual entry (`source='manual'`) is left untouched after a refresh run, even if it shares institution/country/category with an API row.
- [ ] Exceeding 20 messages/min returns `429`.

## Security and reproducibility notes

- Email must **always** trigger on chat (a key constraint) — but send it fire-and-forget so SMTP latency/failures never block message delivery, and log failures.
- Never send real email from a dev environment; use a sandbox SMTP (Mailtrap/MailHog).
- Keep the scheduler idempotent (upsert + date-based expiry) so repeated runs never duplicate rows.
- Authenticate the WebSocket with the same JWT as the REST API; do not trust `from` values sent by the client — derive the sender from the verified token.
- Rate limiting here is a first layer; combine with per-user (not just per-IP) limits before launch.
