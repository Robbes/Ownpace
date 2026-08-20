// Copyright 2026 The Ownpace authors (Apache-2.0)

/**
 * The one test that proves this product can send an email (workplan 0043 T1).
 *
 * WHAT WAS MISSING. `smtp-transport.ts` is the only file in the workspace that
 * talks to a mail server, and until this file existed it was referenced by no
 * test anywhere. Roughly 120 unit tests cover the notification feature — the
 * empty-digest rule, the blind-spot rule, every queue filter, both collection
 * loops, cadence, preferences, EN/NL templates — and every one of them stops at
 * the `MailTransport` seam and asserts against a fake.
 *
 * Sharper than "untested": `smtpTransport()` returns a closure and nodemailer is
 * only reached inside a real send, so `createTransport` was never CONSTRUCTED by
 * the suite at all. If this code had never worked — wrong port, broken auth,
 * throwing on connect — every gate would have stayed green and the first person
 * to find out would have been an owner who never got told their migration needed
 * them.
 *
 * WHY IT ASSERTS ON THE BODY. Asserting that `send` resolved would recreate the
 * problem one layer out: a transport that connects and discards would pass. The
 * message is read back off the server and its CONTENTS checked, so the claim is
 * "the digest reached the mailbox", not "no exception was thrown".
 *
 * THE TLS SETTING. Stalwart binds TLS listeners only and presents a self-signed
 * certificate, so this needs `allowSelfSignedCertificate`. That switch is
 * refused outright in production by `readNotifierConfig` — see its comment on
 * `SmtpSettings`. It exists so this test can exist.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { ImapFlow } from 'imapflow';
import { smtpTransport } from './smtp-transport.ts';

const SMTP_HOST = process.env.STALWART_IMAP_HOST;
const SMTP_PORT = process.env.STALWART_SMTP_PORT;
const IMAP_PORT = process.env.STALWART_IMAP_PORT;
const USER = process.env.STALWART_JMAP_USERNAME ?? 'target@dev.local';
const PASSWORD = process.env.STALWART_JMAP_PASSWORD ?? 'target_password';

/**
 * A missing variable FAILS rather than skips.
 *
 * The integration tier degrades to green when its dependencies are absent, and
 * `harness-exports-what-tests-guard-on.unit.test.ts` exists because a suite that
 * skips itself is indistinguishable from one that passed. A delivery proof that
 * can vanish quietly is not a delivery proof, so this refuses instead — and the
 * variables it names are all exported by `vitest.global-setup.ts`, which that
 * guard verifies statically on every pull request.
 */
if (!SMTP_HOST || !SMTP_PORT || !IMAP_PORT) {
  throw new Error(
    'STALWART_IMAP_HOST / STALWART_SMTP_PORT / STALWART_IMAP_PORT are not set. ' +
      'The integration harness exports all three (vitest.global-setup.ts). Run ' +
      '`pnpm test:integration`; do not skip this test — it is the only proof that ' +
      'this product can send an email at all.',
  );
}

const SUBJECT = `openmig digest proof ${process.pid}-${Date.now()}`;
const MARKER = `deletions-waiting-${process.pid}`;

async function readBackBySubject(subject: string): Promise<string | undefined> {
  const client = new ImapFlow({
    host: SMTP_HOST!,
    port: Number(IMAP_PORT),
    secure: true,
    auth: { user: USER, pass: PASSWORD },
    // Self-signed, same as every other IMAP client in this harness.
    tls: { rejectUnauthorized: false },
    logger: false,
  });

  await client.connect();
  try {
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Delivery is not instantaneous. Poll rather than sleep once and hope:
      // a fixed sleep either flakes on a slow box or wastes time on a fast one.
      for (let attempt = 0; attempt < 20; attempt += 1) {
        const uids = await client.search({ header: { subject } });
        if (uids && uids.length > 0) {
          const message = await client.fetchOne(String(uids[uids.length - 1]), {
            source: true,
          });
          if (message && message.source) return message.source.toString();
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
  return undefined;
}

describe('smtpTransport against a real mail server', () => {
  let delivered: string | undefined;

  beforeAll(async () => {
    const send = smtpTransport({
      host: SMTP_HOST!,
      port: Number(SMTP_PORT),
      secure: true,
      user: USER,
      password: PASSWORD,
      allowSelfSignedCertificate: true,
    });

    await send({
      from: USER,
      to: [USER],
      subject: SUBJECT,
      body: [
        'Open Migrate summary',
        '',
        'Migration: inbox',
        `  - 3 ${MARKER}`,
        '',
      ].join('\n'),
    });

    delivered = await readBackBySubject(SUBJECT);
  }, 120_000);

  it('delivers the message to the mailbox', () => {
    // The claim the whole feature rests on, and the one nothing checked before.
    expect(delivered, 'the digest never arrived').toBeDefined();
  });

  it('delivers the BODY, not merely an envelope', () => {
    // The counts are the reason an owner opens the email. A transport that
    // connected, authenticated and dropped the body would satisfy a
    // "send resolved" assertion and fail this one.
    expect(delivered).toContain(MARKER);
    expect(delivered).toContain('Migration: inbox');
  });

  it('delivers the subject the caller asked for', () => {
    expect(delivered).toContain(SUBJECT);
  });
});
