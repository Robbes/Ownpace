// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Print, as JSON on stdout, every mailbox in an IMAP account that currently holds a
// message with the given Message-ID — each as `{ path, attribs }`.
//
// THE ATTRIBS ARE THE POINT, not decoration. A caller must be able to ask "is this
// the bin?" by RFC 6154 FLAG rather than by name: Stalwart calls its
// `\Trash`-flagged mailbox "Deleted Items", and other servers say Trash, Deleted
// Messages or [Gmail]/Trash. An earlier version of this script returned bare path
// strings, and the e2e that consumed it matched /trash/i against them — so a
// correct removal into "Deleted Items" was reported as a failure. That is the same
// name-vs-flag trap trash-imap-source.mjs warns about at length, reintroduced one
// file over.
//
// A standalone script rather than something imported directly, so that
// selfhost-apply-deletion.e2e.test.ts stays free of anything but vitest and node
// builtins — test/e2e/no-workspace-imports.unit.test.ts enforces exactly that for
// every root-level `.e2e.test.ts` file, on the theory that these are black-box
// tests of a DEPLOYED appliance and should not partly become tests of this
// checkout. The IMAP client lives here instead, the same way it already does in
// seed-imap-source.mjs and trash-imap-source.mjs.
//
// Used to verify, independently of the appliance's own JMAP view, where a message
// actually sits on the TARGET account after `apply` — a real mailbox listing, not a
// re-read through the same API the appliance itself called.
//
// Config via env:
//   IMAP_HOST, IMAP_PORT, IMAP_TLS, IMAP_USER, IMAP_PASSWORD — connection details
//   MESSAGE_ID — the Message-ID to search for (with or without angle brackets)

import { ImapFlow } from 'imapflow';

const host = process.env.IMAP_HOST || '127.0.0.1';
const port = Number(process.env.IMAP_PORT || '993');
const tls = (process.env.IMAP_TLS || 'true') === 'true';
const user = process.env.IMAP_USER;
const password = process.env.IMAP_PASSWORD;
const messageId = process.env.MESSAGE_ID;

if (!user || !password || !messageId) {
  console.error('[imap-message-locations] IMAP_USER, IMAP_PASSWORD and MESSAGE_ID are required');
  process.exit(1);
}

/** Trim + strip one surrounding pair of angle brackets, so `<foo>` and `foo` compare equal. */
function normalizeMessageId(id) {
  return id.trim().replace(/^<(.*)>$/, '$1').trim();
}

/**
 * Whether `mailbox` holds a message with this Message-ID.
 *
 * A full UID-range `HEADER.FIELDS (MESSAGE-ID)` fetch + a client-side match, not
 * `SEARCH HEADER MESSAGE-ID`. The latter came back empty against a real Stalwart
 * for a message that unambiguously existed (run #63 of the self-host e2e; see
 * trash-imap-source.mjs for the same fix and the full account of why). A UID
 * range plus a `HEADER.FIELDS (...)` fetch are baseline IMAP4rev1 operations; a
 * HEADER search criterion evidently is not one to lean on here. The finding
 * predates the imap-simple -> imapflow swap (workplan 0032) and was never about
 * the client.
 */
async function mailboxHasMessage(client, mailbox, wanted) {
  const lock = await client.getMailboxLock(mailbox);
  try {
    for await (const message of client.fetch(
      '1:*',
      { uid: true, headers: ['message-id'] },
      { uid: true },
    )) {
      const raw = message.headers ? message.headers.toString('utf-8') : '';
      const match = raw.match(/^message-id:\s*(.+)$/im);
      if (match && normalizeMessageId(match[1]) === wanted) return true;
    }
    return false;
  } finally {
    lock.release();
  }
}

async function main() {
  const client = new ImapFlow({
    host,
    port,
    secure: tls,
    tls: { rejectUnauthorized: false },
    auth: { user, pass: password },
    logger: false,
  });
  await client.connect();

  try {
    const wanted = normalizeMessageId(messageId);
    const found = [];
    for (const mailbox of await client.list()) {
      // `attribs` is kept as the output key: callers of this script parse that
      // name, and renaming it to imapflow's `flags` would be an unrelated
      // interface change riding along with a client swap.
      if (await mailboxHasMessage(client, mailbox.path, wanted)) {
        found.push({ path: mailbox.path, attribs: [...(mailbox.flags ?? [])] });
      }
    }
    process.stdout.write(JSON.stringify(found));
  } finally {
    await client.logout().catch(() => client.close());
  }
}

main().catch((err) => {
  console.error(`[imap-message-locations] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
