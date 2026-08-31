// src/middleware/rateLimit.js
// PURPOSE: Reusable rate limiters that cap how often a client may hit sensitive
// endpoints, blunting spam and brute-force attempts.
// INTENDED OUTPUT LINK: chatLimiter protects the chat endpoint (and therefore the
// email relay behind it) from being used to flood someone's inbox; loginLimiter
// makes password guessing impractical. Both return HTTP 429 when tripped.

import rateLimit from "express-rate-limit"; // Middleware that counts requests per client and blocks over-limit ones.

// Applied to POST /chat. Each send also fires an email, so an unlimited endpoint
// would double as an email-flooding tool aimed at another user's inbox.
export const chatLimiter = rateLimit({
  windowMs: 60 * 1000,                              // Rolling window length: 60,000 ms = 1 minute.
  max: 20,                                          // Allow at most 20 messages per window per client.
  standardHeaders: true,                            // Send RateLimit-* headers so the UI could show remaining quota.
  legacyHeaders: false,                             // Omit the deprecated X-RateLimit-* headers.
  message: { error: "Too many messages, slow down" },// JSON body returned with the 429 (matches our error shape elsewhere).
});

// Applied to the login endpoints (wired fully on Day 5's hardening pass).
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,                         // 15-minute window: long enough to make guessing slow.
  max: 10,                                          // 10 attempts per window, then lock out temporarily.
  standardHeaders: true,                            // Expose standard rate-limit headers.
  legacyHeaders: false,                             // No legacy headers.
  message: { error: "Too many login attempts, try again later" }, // Message shown once the limit trips.
});

// NOTE (production): these limiters key on IP by default. Behind a proxy
// (Render/Railway) every request appears to come from the proxy's IP unless you
// set `app.set("trust proxy", 1)` — otherwise ALL users share one bucket and get
// locked out together. That setting is applied in app.js. Per-user limits keyed on
// req.user.sub are the recommended second layer before launch.
