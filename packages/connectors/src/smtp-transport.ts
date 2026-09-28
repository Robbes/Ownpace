// Copyright 2026 The Ownpace authors (Apache-2.0)

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
 *
 * A problem report goes out through here too (workplan 0130, the owner's
 * choice for the alpha of 2026-09-28), with the same TLS rules as every other
 * message: plain text, a Reply-To naming the reporter, and at most their
 * screenshot attached.
 */

import { createTransport, type Transporter } from 'nodemailer';
import type { MailTransport, SmtpSettings } from '@openmig/shared';

/**
 * How long a send may wait on the relay, in milliseconds, at each of
 * nodemailer's three waits: the TCP connection, the server's greeting, and
 * any silence after that. Left out, nodemailer's own defaults hold (two
 * minutes, thirty seconds and ten minutes), which suits a digest a job sends
 * and nobody watches. A person who pressed Send stops waiting sooner.
 */
export interface SmtpTimeouts {
  readonly connectionMs: number;
  readonly greetingMs: number;
  readonly socketMs: number;
}

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
 *
 * `timeouts` only for a send somebody is waiting on: a problem report
 * (workplan 0130), whose web client gives up after thirty seconds.
 */
export function smtpTransport(smtp: SmtpSettings, timeouts?: SmtpTimeouts): MailTransport {
  let transporter: Transporter | undefined;

  const connect = (): Transporter => {
    transporter ??= createTransport({
      host: smtp.host,
      port: smtp.port,
      ...(timeouts
        ? {
            connectionTimeout: timeouts.connectionMs,
            greetingTimeout: timeouts.greetingMs,
            socketTimeout: timeouts.socketMs,
          }
        : {}),
      // Implicit TLS on 465; STARTTLS is negotiated automatically otherwise.
      secure: smtp.secure,
      // A LOGIN IS NEVER SENT IN THE CLEAR (workplan 0133 T2, item 5). Without
      // this, nodemailer upgrades to STARTTLS when the relay offers it and
      // sends the login over plain SMTP when it does not. With a login and no
      // implicit TLS, the connection must upgrade or the send fails. A catcher
      // with no login is untouched.
      ...(smtp.user && !smtp.secure ? { requireTLS: true } : {}),
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
      // A problem report's (workplan 0130): the reporter, so a reply reaches
      // them, and the screenshot they chose. Nothing else sets either.
      ...(message.replyTo ? { replyTo: message.replyTo } : {}),
      ...(message.attachments && message.attachments.length > 0
        ? {
            attachments: message.attachments.map((file) => ({
              filename: file.filename,
              content: file.base64,
              encoding: 'base64',
              contentType: file.contentType,
            })),
          }
        : {}),
    });
  };
}
