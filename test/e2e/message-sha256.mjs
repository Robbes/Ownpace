// Copyright 2026 The Ownpace authors (Apache-2.0)
//
// Print, as JSON on stdout, every copy of one message in an IMAP account, each as
// `{ path, sha256, bytes }`: the mailbox it sits in and the SHA-256 of its raw
// RFC 822 bytes, exactly as the server hands them out (`BODY[]`).
//
// WHY BYTES AND NOT A HEADER (workplan 0168 T8; ADR-0055 decision 4). A new
// address is never applied to mail, in any byte. The gate proves that by hashing
// the source's message and every copy the target holds after a pass that ran
// with a confirmed address change naming the message's own `From`: one copy, and
// the same hash. A rewritten header would differ; a second copy, made because a
// rewrite changed the generated Message-ID's key material, would be counted.
//
// A standalone script, as `imap-message-locations.mjs` is, so the gates that call
// it stay free of this checkout's packages (`no-workspace-imports`). The lookup is
// the same full UID-range header fetch and client-side match that file explains:
// `SEARCH HEADER MESSAGE-ID` came back empty against a real Stalwart.
//
// Config via env:
//   IMAP_HOST, IMAP_PORT, IMAP_TLS, IMAP_USER, IMAP_PASSWORD — connection details
//   MESSAGE_ID — the Message-ID to find (with or without angle brackets)
import { createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';

const host = process.env.IMAP_HOST || '127.0.0.1';
const port = Number(process.env.IMAP_PORT || '993');
const tls = (process.env.IMAP_TLS || 'true') === 'true';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;
const messageId = process.env.MESSAGE_ID;

if (!user || !password || !messageId) {
  console.error('[message-sha256] IMAP_USER, IMAP_PASSWORD and MESSAGE_ID are required');
  process.exit(1);
}

/** Trim + strip one surrounding pair of angle brackets, so `<foo>` and `foo` compare equal. */
function normalizeMessageId(id) {
  return id.trim().replace(/^<(.*)>$/, '$1').trim();
}

/** The UIDs in `mailbox` whose Message-ID is `wanted`. */
async function uidsOf(client, wanted) {
  const uids = [];
  for await (const message of client.fetch('1:*', { uid: true, headers: ['message-id'] }, { uid: true })) {
    const raw = message.headers ? message.headers.toString('utf-8') : '';
    const match = raw.match(/^message-id:\s*(.+)$/im);
    if (match && normalizeMessageId(match[1]) === wanted) uids.push(message.uid);
  }
  return uids;
}

async function main() {
  const client = new ImapFlow({
    host,
    port,
    secure: tls,
    // The demo Stalwart serves a self-signed certificate, as every helper here accepts.
    tls: { rejectUnauthorized: false },
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();
  try {
    const wanted = normalizeMessageId(messageId);
    const found = [];
    for (const mailbox of await client.list()) {
      const lock = await client.getMailboxLock(mailbox.path);
      try {
        for (const uid of await uidsOf(client, wanted)) {
          const one = await client.fetchOne(String(uid), { source: true }, { uid: true });
          if (!one || !one.source) throw new Error(`${mailbox.path} UID ${uid}: the server returned no bytes`);
          found.push({
            path: mailbox.path,
            sha256: createHash('sha256').update(one.source).digest('hex'),
            bytes: one.source.length,
          });
        }
      } finally {
        lock.release();
      }
    }
    process.stdout.write(JSON.stringify(found));
  } finally {
    await client.logout().catch(() => client.close());
  }
}

main().catch((err) => {
  console.error(`[message-sha256] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
