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

async function main() {
  const connection = await imaps.connect({
    imap: { user, password, host, port, tls, authTimeout: 10000, tlsOptions: { rejectUnauthorized: false } },
  });

  try {
    const mailboxes = flatten(await connection.getBoxes(), '', '/', []);
    const found = [];
    for (const mailbox of mailboxes) {
      await connection.openBox(mailbox.path);
      const results = await connection.search([['HEADER', 'MESSAGE-ID', messageId]], {
        bodies: ['HEADER'],
        struct: false,
      });
      if (results.length > 0) found.push(mailbox.path);
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
