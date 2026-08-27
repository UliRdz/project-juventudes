# Tuesday Workday Plan: Authentication, User Model and 2FA

## Objective

Implement the full authentication layer: registration, login, password hashing, JWT sessions, optional **TOTP 2FA** (Google Authenticator compatible), profile photo upload, and the frontend auth pages. After today a user can register, secure their account, and log in.

## Concepts to learn today

- **Hashing vs. encryption**: why passwords are hashed with bcrypt/argon2 and never stored or "decrypted".
- **JWT structure** (header.payload.signature) and why the payload is signed, not secret.
- **TOTP / RFC 6238**: how a shared secret + current time produces the 6-digit code, and why the secret must be stored encrypted.
- Middleware-based route protection.

## Deliverables covered

- `backend/src/routes/auth.routes.js` (register, login, TOTP setup/verify)
- `backend/src/middleware/auth.js` (JWT guard)
- `backend/src/services/photos.js` (upload validation)
- `frontend/src/components/auth/` (Login, Register, TotpSetup)
- Working end-to-end register → login → protected request

## Workday outcome

By the end of Tuesday, a user can register with email + password, optionally enable TOTP via a QR code, and log in (with the second factor when enabled). A valid session returns a JWT that unlocks protected endpoints.

## Step-by-step exercises

### 1. Install auth dependencies

```bash
cd backend
npm install bcrypt jsonwebtoken speakeasy qrcode multer
```

- `bcrypt` – password hashing
- `jsonwebtoken` – JWT signing/verification
- `speakeasy` – TOTP secret generation + verification (RFC 6238)
- `qrcode` – render the TOTP secret as a scannable QR
- `multer` – handle multipart photo uploads

### 2. Registration with password hashing

In `backend/src/routes/auth.routes.js`:

```js
import { Router } from "express";
import bcrypt from "bcrypt";
import { pool } from "../config/db.js";

const router = Router();
const SALT_ROUNDS = 12;

router.post("/register", async (req, res) => {
  const { email, password, first_name, last_name } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "Email and 8+ char password required" });
  }
  const hash = await bcrypt.hash(password, SALT_ROUNDS);
  try {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, first_name, last_name)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, first_name, last_name`,
      [email.toLowerCase(), hash, first_name, last_name]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(409).json({ error: "Email already registered" });
    res.status(500).json({ error: "Registration failed" });
  }
});

export default router;
```

Mount it in `app.js`:

```js
import authRoutes from "./routes/auth.routes.js";
app.use("/auth", authRoutes);
```

### 3. Login and JWT issuance

Add to `auth.routes.js`:

```js
import jwt from "jsonwebtoken";

router.post("/login", async (req, res) => {
  const { email, password, totp } = req.body;
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE email = $1 AND is_active = TRUE",
    [email.toLowerCase()]
  );
  const user = rows[0];

  // Constant message on failure to avoid leaking which field was wrong.
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    await logAttempt(req, email, "login_fail");
    return res.status(401).json({ error: "Invalid credentials" });
  }

  if (user.totp_enabled) {
    if (!totp) return res.status(206).json({ mfa_required: true });
    const ok = verifyTotp(user.totp_secret, totp); // see step 4
    if (!ok) return res.status(401).json({ error: "Invalid 2FA code" });
  }

  const token = jwt.sign(
    { sub: user.id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: "2h" }
  );
  await logAttempt(req, email, "login_success");
  res.json({ token, user: publicUser(user) });
});

function publicUser(u) {
  const { password_hash, totp_secret, ...safe } = u;
  return safe;
}

async function logAttempt(req, email, action) {
  await pool.query(
    "INSERT INTO audit_logs (actor, action, ip) VALUES ($1, $2, $3)",
    [email, action, req.ip]
  );
}
```

### 4. TOTP setup and verification

Generate a secret + QR when the user opts in, then confirm they scanned it:

```js
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import { requireAuth } from "../middleware/auth.js"; // step 6

// Step A: user requests 2FA setup
router.post("/totp/setup", requireAuth, async (req, res) => {
  const secret = speakeasy.generateSecret({
    name: `ScholarshipNet (${req.user.email})`,
  });
  // Store temporarily (not yet enabled) until the user confirms a code.
  await pool.query("UPDATE users SET totp_secret = $1 WHERE id = $2", [
    secret.base32,
    req.user.sub,
  ]);
  const qr = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ qr, manual_key: secret.base32 });
});

// Step B: confirm and enable
router.post("/totp/verify", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT totp_secret FROM users WHERE id = $1", [
    req.user.sub,
  ]);
  const ok = verifyTotp(rows[0].totp_secret, req.body.totp);
  if (!ok) return res.status(400).json({ error: "Code did not match" });
  await pool.query("UPDATE users SET totp_enabled = TRUE WHERE id = $1", [req.user.sub]);
  res.json({ totp_enabled: true });
});

export function verifyTotp(secret, token) {
  return speakeasy.totp.verify({ secret, encoding: "base32", token, window: 1 });
}
```

> Note: `speakeasy` produces standard `otpauth://` URIs, so **Google Authenticator, Authy, and 1Password all work**. The `window: 1` tolerance accepts codes one 30-second step early/late for clock drift.

### 5. Profile photo upload (5MB, JPG/PNG)

Create `backend/src/services/photos.js`:

```js
import multer from "multer";

const ALLOWED = ["image/jpeg", "image/png"];

export const uploadPhoto = multer({
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.includes(file.mimetype)) {
      return cb(new Error("Only JPG/PNG allowed"));
    }
    cb(null, true);
  },
  storage: multer.memoryStorage(), // then push to object storage / disk
});
```

Wire an endpoint:

```js
import { uploadPhoto } from "../services/photos.js";
router.post("/me/photo", requireAuth, uploadPhoto.single("photo"), async (req, res) => {
  // Upload req.file.buffer to your storage, get a URL, then:
  const url = await storeAndGetUrl(req.file); // implement per host
  await pool.query("UPDATE users SET profile_photo_url = $1 WHERE id = $2", [
    url,
    req.user.sub,
  ]);
  res.json({ profile_photo_url: url });
});
```

### 6. JWT guard middleware

Create `backend/src/middleware/auth.js`:

```js
import jwt from "jsonwebtoken";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
```

### 7. Frontend auth pages

Create `frontend/src/components/auth/Login.jsx` (handles the two-step MFA flow):

```jsx
import { useState } from "react";
import { api } from "../../api/client";

export default function Login({ onLoggedIn }) {
  const [form, setForm] = useState({ email: "", password: "", totp: "" });
  const [mfa, setMfa] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    try {
      const res = await api("/auth/login", { method: "POST", body: form });
      if (res.mfa_required) return setMfa(true); // ask for the 6-digit code
      localStorage.setItem("token", res.token);
      onLoggedIn(res.user);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div className="card">
      <input placeholder="Correo" onChange={(e) => setForm({ ...form, email: e.target.value })} />
      <input type="password" placeholder="Contraseña"
             onChange={(e) => setForm({ ...form, password: e.target.value })} />
      {mfa && (
        <input placeholder="Código 2FA"
               onChange={(e) => setForm({ ...form, totp: e.target.value })} />
      )}
      <button className="btn btn-primary" onClick={submit}>Entrar</button>
      {error && <p style={{ color: "crimson" }}>{error}</p>}
    </div>
  );
}
```

Build `Register.jsx` and `TotpSetup.jsx` similarly: `TotpSetup` calls `/auth/totp/setup`, shows the returned QR `<img src={qr} />`, then submits a test code to `/auth/totp/verify`.

## Validation checklist

- [ ] Registering twice with the same email returns `409`, not a crash.
- [ ] Passwords are stored only as bcrypt hashes (verify by inspecting the table).
- [ ] Login returns a JWT; the token unlocks a protected route via `requireAuth`.
- [ ] Enabling TOTP produces a QR that Google Authenticator can scan.
- [ ] A wrong 2FA code is rejected; a correct one logs in.
- [ ] Uploading a >5MB or non-JPG/PNG file is rejected.
- [ ] Every login attempt (success and fail) writes an `audit_logs` row.

## Security and reproducibility notes

- Use **≥12 bcrypt salt rounds**; never log or return `password_hash` or `totp_secret`.
- Return the **same error message** for "unknown email" and "wrong password" to avoid user enumeration.
- Store `totp_secret` encrypted at rest in production (envelope encryption or a KMS), not plaintext.
- Keep `JWT_SECRET` long and random; rotate it on suspected compromise (this invalidates all sessions).
- Rate limiting on `/auth/login` is added on Day 4/5 to blunt brute-force attempts.
