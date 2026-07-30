// Copyright 2026 The Open Migration Stack authors (Apache-2.0)
//
// Print, as JSON on stdout, every mailbox in an IMAP account that currently holds a
// message with the given Message-ID.
//
// A standalone script rather than something imported directly, so that
// selfhost-apply-deletion.e2e.test.ts stays free of anything but vitest and node
// builtins — test/e2e/no-workspace-imports.unit.test.ts enforces exactly that for
// every root-level `.e2e.test.ts` file, on the theory that these are black-box
// tests of a DEPLOYED appliance and should not partly become tests of this
// checkout. `imap-simple` lives here instead, the same way it already does in
// seed-imap-source.mjs and trash-imap-source.mjs.
//
// Used to verify, independently of the appliance's own JMAP view, where a message
// actually sits on the TARGET account after `apply` — a real mailbox listing, not a
// re-read through the same API the appliance itself called.
//
// Config via env:
//   IMAP_HOST, IMAP_PORT, IMAP_TLS, IMAP_USER, IMAP_PASSWORD — connection details
//   MESSAGE_ID — the Message-ID to search for (with or without angle brackets)

import imaps from 'imap-simple';

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

/** Every mailbox in the account, flattened, with its LIST attributes. Matches trash-imap-source.mjs. */
function flatten(boxes, prefix, delimiter, out) {
  for (const [name, box] of Object.entries(boxes ?? {})) {
    const path = prefix ? `${prefix}${delimiter}${name}` : name;
    out.push({ path, attribs: box.attribs ?? [] });
    if (box.children) flatten(box.children, path, box.delimiter ?? delimiter, out);
  }
  return out;
}

/** Trim + strip one surrounding pair of angle brackets, so `<foo>` and `foo` compare equal. */
function normalizeMessageId(id) {
  return id.trim().replace(/^<(.*)>$/, '$1').trim();
}

/**
 * Whether the CURRENTLY OPEN mailbox holds a message with this Message-ID.
 *
 * `SEARCH ALL` + a client-side header match, not `SEARCH HEADER MESSAGE-ID`. The
 * latter came back empty against a real Stalwart for a message that unambiguously
 * existed (run #63 of the self-host e2e; see trash-imap-source.mjs for the same
 * fix and the full account of why). `ALL` plus a `HEADER.FIELDS (...)` fetch are
 * baseline IMAP4rev1 operations; a HEADER search criterion evidently is not one to
 * lean on here.
 */
async function mailboxHasMessage(connection, wanted) {
  const messages = await connection.search(['ALL'], {
    bodies: ['HEADER.FIELDS (MESSAGE-ID)'],
    struct: false,
  });
  for (const message of messages) {
    const headerPart = message.parts.find((p) => String(p.which).toUpperCase().startsWith('HEADER'));
    const values = headerPart?.body?.['message-id'];
    const value = Array.isArray(values) ? values[0] : values;
    if (value && normalizeMessageId(value) === wanted) return true;
  }
  return false;
}

async function main() {
  const connection = await imaps.connect({
    imap: { user, password, host, port, tls, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false } },
  });

  try {
    const wanted = normalizeMessageId(messageId);
    const mailboxes = flatten(await connection.getBoxes(), '', '/', []);
    const found = [];
    for (const mailbox of mailboxes) {
      await connection.openBox(mailbox.path);
      if (await mailboxHasMessage(connection, wanted)) found.push(mailbox.path);
    }
    process.stdout.write(JSON.stringify(found));
  } finally {
    connection.end();
  }
}

main().catch((err) => {
  console.error(`[imap-message-locations] failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
