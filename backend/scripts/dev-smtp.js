// scripts/dev-smtp.js
// PURPOSE: A throwaway local SMTP server that ACCEPTS mail and prints it to the
// terminal instead of delivering it anywhere.
// INTENDED OUTPUT LINK: the spec requires an email on every chat message, but you
// must never send real email from a development machine. Run this, point SMTP_HOST
// at it, and you can watch the notification arrive — the same role Mailtrap or
// MailHog play, with no signup.
//
// USAGE:
//   1) node scripts/dev-smtp.js            (leave running in its own terminal)
//   2) in .env set: SMTP_HOST=127.0.0.1  SMTP_PORT=2525  (leave SMTP_USER blank)
//   3) send a chat message and watch it print here.

import { SMTPServer } from "smtp-server"; // Minimal SMTP server implementation (a devDependency).

const PORT = Number(process.env.DEV_SMTP_PORT || 2525); // Port to listen on; 2525 avoids needing root (unlike 25).

const server = new SMTPServer({           // Configure the catcher.
  authOptional: true,                     // Accept mail without credentials, like MailHog does locally.
  disabledCommands: ["STARTTLS"],         // Skip TLS: this is local-only plaintext, which keeps setup simple.

  onData(stream, session, callback) {     // Called with the raw message body for every incoming email.
    let raw = "";                         // Accumulator for the message text.
    stream.on("data", (chunk) => (raw += chunk)); // Append each chunk as it arrives.
    stream.on("end", () => {              // Once the full message has been received...
      console.log("\n=============== EMAIL CAUGHT ==============="); // Visual separator in the terminal.
      console.log("From:", session.envelope.mailFrom?.address);      // Envelope sender (our SMTP_FROM).
      console.log("To:  ", session.envelope.rcptTo.map((r) => r.address).join(", ")); // Envelope recipient(s).
      console.log("--------------------------------------------");
      console.log(raw.trim());            // The full message: headers (Subject, Reply-To) plus the body.
      console.log("============================================\n");
      callback();                         // Tell the SMTP client we accepted the message (returns 250 OK).
    });
  },
});

server.listen(PORT, () => {                                        // Start listening.
  console.log(`Dev SMTP catcher listening on 127.0.0.1:${PORT}`);  // Confirm it's up.
  console.log("Set SMTP_HOST=127.0.0.1 and SMTP_PORT=" + PORT + " in your .env"); // Remind how to point the app at it.
});
