// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Seed the SOURCE mailbox for the self-host restart-resume e2e (workplan 0010 T5).
// The restart-resume gate is only meaningful against a non-zero source, so this
// APPENDs N known messages to the source account's INBOX over IMAP — using
// imapflow, the same client the app's IMAP connector uses (workplan 0032).
//
// Config via env (all have dev defaults matching test/e2e/fixtures/…mapping.json
// and deploy/compose provisioning: source@dev.local / source_password):
//   SEED_IMAP_HOST      (default 127.0.0.1)
//   SEED_IMAP_PORT      (default 143)
//   SEED_IMAP_TLS       (default false; set "true" for 993)
//   SEED_IMAP_USER      (default source@dev.local)
//   SEED_IMAP_PASSWORD  (default source_password)
//   SEED_COUNT          (default 5) — number of messages to append
//
// Idempotent-ish: it appends SEED_COUNT messages with stable Message-IDs, so a
// re-run against a fresh mailbox produces the same corpus. Exits non-zero on any
// failure so the workflow stops before running the (now-meaningless) gate.

import { ImapFlow } from 'imapflow';

const host = process.env.SEED_IMAP_HOST || '127.0.0.1';
const port = Number(process.env.SEED_IMAP_PORT || '143');
const tls = (process.env.SEED_IMAP_TLS || 'false') === 'true';
const user = process.env.SEED_IMAP_USER || 'source@dev.local';
const password = process.env.SEED_IMAP_PASSWORD || 'source_password';
const count = Number(process.env.SEED_COUNT || '5');
/**
 * Number the messages from `SEED_OFFSET + 1` instead of 1.
 *
 * Natural keys here are `<seed-N@dev.local>`, deliberately stable so a re-seed
 * of a fresh mailbox reproduces the same corpus. That also means re-running the
 * script adds NOTHING to an already-seeded account — every key is already in
 * the ledger, which is the correct idempotent behaviour and useless for testing
 * whether new mail is picked up.
 *
 * The offset is how the e2e drips genuinely new items into a source that is
 * already being shadow-synced.
 */
const offset = Number(process.env.SEED_OFFSET || '0');

function buildMessage(i) {
  // Stable, valid RFC 822 message. Fixed Message-ID + Date so repeated seeds of a
  // fresh mailbox yield the same natural keys (the ledger keys on Message-ID).
  const messageId = `<seed-${i}@dev.local>`;
  const date = new Date(Date.UTC(2026, 0, 1, 0, i, 0)).toUTCString();
  return [
    `From: source@dev.local`,
    `To: source@dev.local`,
    `Subject: Restart-resume seed message ${i}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    `Seed message ${i} for the self-host restart-resume idempotency gate (0010 T5).`,
    ``,
  ].join('\r\n');
}

async function main() {
  console.log(`[seed] connecting to imap://${user}@${host}:${port} (tls=${tls})`);
  const client = new ImapFlow({
    host,
    port,
    secure: tls,
    // rejectUnauthorized: false — the dev/e2e Stalwart serves a self-signed cert, so accept it,
    // exactly like the app's own ImapFlowSource connector and docs/testing.md ("connects to 993
    // with rejectUnauthorized: false for the self-signed test certificate"). This is a throwaway
    // test source, never a real credential path.
    tls: { rejectUnauthorized: false },
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();

  try {
    for (let n = 1; n <= count; n++) {
      const i = offset + n;
      // `\\Seen` so the seeded corpus does not change the account's unread count,
      // which the §11.2 screens display.
      await client.append('INBOX', Buffer.from(buildMessage(i)), ['\\Seen']);
      console.log(`[seed] appended message ${n}/${count} (seed-${i})`);
    }
    console.log(
      `[seed] done — ${count} messages in ${user} INBOX` +
        (offset ? ` (numbered ${offset + 1}..${offset + count})` : ''),
    );
  } finally {
    await client.logout().catch(() => client.close());
  }
}

main().catch((err) => {
  console.error('[seed] FAILED:', err?.message || err);
  process.exit(1);
});
