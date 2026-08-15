// Copyright 2026 The Open Migration Stack authors (Apache-2.0)

/**
 * The SMTP binding for the notification channel (workplan 0030 T1).
 *
 * This file is the ONLY place nodemailer is imported, and that is the point
 * of `MailTransport` being a function type in `@openmig/shared`: shared is
 * imported by the browser bundle (`apps/web`), so a mail library must not
 * live there. Everything above this line — what to say, in which language,
 * and whether to send at all — is pure and tested without a server; this is
 * the twenty lines that need a protocol.
 *
 * WHY NODEMAILER. Node has no SMTP client, the alternative is hand-rolling
 * SMTP + STARTTLS + AUTH (a protocol with a long history of subtle security
 * bugs), and nodemailer is the standard, MIT, pure-JavaScript choice with no
 * native build step — which keeps ADR-0019's portability property intact
 * (the runtime stays binary-free, arm64 included).
 *
 * Plain text only, deliberately: these messages are short, they carry the
 * server's own words, and an HTML body would invite formatting the one thing
 * that must not be reformatted — a verbatim diagnostic.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { MailTransport, SmtpSettings } from '@openmig/shared';

/**
 * Build a transport from resolved settings.
 *
 * The transporter is created ONCE and reused: nodemailer pools nothing by
 * default, but re-creating it per message re-does TLS on every send, which
 * for a digest that goes to several recipients is pure latency.
 *
 * Failures are not caught here. A send that fails must reach the caller —
 * `createNotifier` documents why — and the natural place to decide what a
 * failed notification means is the job that asked for it, not this file.
 */
export function smtpTransport(smtp: SmtpSettings): MailTransport {
  let transporter: Transporter | undefined;

  const connect = (): Transporter => {
    transporter ??= createTransport({
      host: smtp.host,
      port: smtp.port,
      // Implicit TLS on 465; STARTTLS is negotiated automatically otherwise.
      secure: smtp.secure,
      // Only ever reaches nodemailer when the setting survived
      // `readNotifierConfig`, which refuses it outright in production.
      ...(smtp.allowSelfSignedCertificate ? { tls: { rejectUnauthorized: false } } : {}),
      ...(smtp.user
        ? { auth: { user: smtp.user, ...(smtp.password ? { pass: smtp.password } : {}) } }
        : {}),
    });
    return transporter;
  };

  return async (message) => {
    await connect().sendMail({
      from: message.from,
      to: [...message.to],
      subject: message.subject,
      text: message.body,
    });
  };
}
